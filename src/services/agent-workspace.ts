/**
 * Agent Workspace
 *
 * Maintains a fixed `/<workspacePath>/` folder at the vault root with three
 * zones (Index.md, Resources/, Agent_Output/YYYY-MM-DD/) and ships
 * structured XML preludes to the agent on a seed-then-delta cadence.
 *
 * Design ref: docs/design/agent-workspace.md
 */

import {
	TFile,
	TFolder,
	type App,
	type EventRef,
	type TAbstractFile,
} from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { ISettingsAccess } from "./settings-service";
import { getLogger, Logger } from "../utils/logger";
import { convertWindowsPathToWsl } from "../utils/platform";
import { buildFileUri } from "../utils/paths";
import { formatLinkedNotesPrelude } from "../utils/wikilink-formatter";
import type { IWikilinkResolver } from "../utils/wikilink-resolver";
import type { WorkspaceSnapshot } from "../types/session";

export type { WorkspaceSnapshot } from "../types/session";

// ============================================================================
// Types
// ============================================================================

export interface BuildPreludeOptions {
	vaultBasePath: string;
	convertToWsl: boolean;
	wikilinkResolver?: IWikilinkResolver | null;
	expandWikilinkContext: boolean;
}

/**
 * One workspace XML payload paired with the `uri` callers should use when
 * wrapping it as an ACP `type: "resource"` block. Text-fallback callers can
 * ignore `uri` and concatenate the `xml` strings.
 */
export interface WorkspaceXmlBlock {
	uri: string;
	xml: string;
}

export interface BuildPreludeResult {
	/** Workspace state (`<obsidian_workspace>` seed or `<obsidian_workspace_update>` delta). null when delta has no changes or bootstrap failed. */
	state: WorkspaceXmlBlock | null;
	/** Static protocol/instructions block, emitted only on seed when `emitInstructions=true`. */
	instructions: WorkspaceXmlBlock | null;
	/** Snapshot to commit after a successful turn. */
	pendingSnapshot: WorkspaceSnapshot;
}

export interface IAgentWorkspace {
	ensureBootstrapped(): Promise<void>;
	isEnabled(): boolean;
	buildPrelude(
		snapshot: WorkspaceSnapshot | null,
		options: BuildPreludeOptions,
	): Promise<BuildPreludeResult>;
	postTurnSnapshot(): Promise<WorkspaceSnapshot>;
	destroy(): void;
}

/** Synthetic URI for the instructions Resource — no real file behind it. */
const WORKSPACE_INSTRUCTIONS_URI = "obsidian://agent-workspace/instructions";

// ============================================================================
// Internal types
// ============================================================================

interface ResourceEntry {
	vaultPath: string;
	size: number;
	mtimeMs: number;
	extension: string;
}

interface ResourcesManifest {
	entries: ResourceEntry[];
	truncated: number;
}

// ============================================================================
// Hashing
// ============================================================================

/** cyrb53 hash — fast, sufficient for change detection (not cryptographic). */
function cyrb53(str: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const high = (4294967296 * (2097151 & h2) + (h1 >>> 0))
		.toString(16)
		.padStart(13, "0");
	return high;
}

// ============================================================================
// XML escape
// ============================================================================

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// ============================================================================
// Path helpers
// ============================================================================

function joinVaultPath(...segments: string[]): string {
	return segments
		.map((s) => s.replace(/^\/+|\/+$/g, ""))
		.filter((s) => s.length > 0)
		.join("/");
}

function resolveAbsolute(
	vaultRelativePath: string,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const abs = vaultBasePath
		? `${vaultBasePath}/${vaultRelativePath}`
		: vaultRelativePath;
	return convertToWsl ? convertWindowsPathToWsl(abs) : abs;
}

function todayDateString(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

// ============================================================================
// Implementation
// ============================================================================

const INDEX_FILENAME = "Index.md";
const LEGACY_INDEX_FILENAME = "Focus_Context.md";
const RESOURCES_DIRNAME = "Resources";
const AGENT_OUTPUT_DIRNAME = "Agent_Output";

const INDEX_SEED = `# Index

This is your curated index of existing notes. Each line below should be a
\`[[wikilink]]\` to a note already in your vault, followed by a one-line
summary of why it matters for the work you do with the agent. Keep it lean —
this file is sent to the agent on every session start.

## Notes

-

`;

export class AgentWorkspace implements IAgentWorkspace {
	private plugin: AgentClientPlugin;
	private settingsAccess: ISettingsAccess;
	private logger: Logger;
	private app: App;

	private bootstrapped = false;
	private bootstrapFailed = false;

	private vaultEventRefs: EventRef[] = [];
	private manifest: ResourcesManifest = { entries: [], truncated: 0 };
	private manifestDirty = true;

	constructor(plugin: AgentClientPlugin, settingsAccess: ISettingsAccess) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.settingsAccess = settingsAccess;
		this.logger = getLogger();
	}

	isEnabled(): boolean {
		return this.settingsAccess.getSnapshot().agentWorkspace.enabled;
	}

	// ========================================================================
	// Bootstrap
	// ========================================================================

	async ensureBootstrapped(): Promise<void> {
		if (!this.isEnabled()) return;
		if (this.bootstrapped) return;

		const settings = this.settingsAccess.getSnapshot().agentWorkspace;
		const root = settings.path;
		const adapter = this.app.vault.adapter;

		try {
			await this.ensureFolder(root);
			await this.ensureFolder(joinVaultPath(root, RESOURCES_DIRNAME));
			await this.ensureFolder(joinVaultPath(root, AGENT_OUTPUT_DIRNAME));

			const indexPath = joinVaultPath(root, INDEX_FILENAME);
			const legacyPath = joinVaultPath(root, LEGACY_INDEX_FILENAME);
			// One-time migration: a previous version of this plugin called the
			// curated index `Focus_Context.md`. If the legacy file exists and
			// the new one does not, rename it so the user's curated content
			// carries over instead of being overwritten by an empty seed.
			if (
				(await adapter.exists(legacyPath)) &&
				!(await adapter.exists(indexPath))
			) {
				try {
					await adapter.rename(legacyPath, indexPath);
					this.logger.log(
						`[AgentWorkspace] Migrated ${LEGACY_INDEX_FILENAME} → ${INDEX_FILENAME}`,
					);
				} catch (error) {
					this.logger.error(
						`[AgentWorkspace] Failed to migrate ${LEGACY_INDEX_FILENAME}; leaving it in place:`,
						error,
					);
				}
			}
			if (!(await adapter.exists(indexPath))) {
				await adapter.write(indexPath, INDEX_SEED);
			}

			this.subscribeVaultEvents();
			this.manifestDirty = true;
			this.bootstrapped = true;
			this.logger.log(
				`[AgentWorkspace] Bootstrapped at /${root}/`,
			);
		} catch (error) {
			this.bootstrapFailed = true;
			this.logger.error(
				"[AgentWorkspace] Bootstrap failed:",
				error,
			);
		}
	}

	private async ensureFolder(path: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(path)) {
			const stat = await adapter.stat(path);
			if (stat?.type === "folder") return;
			throw new Error(
				`[AgentWorkspace] Path exists but is not a folder: ${path}`,
			);
		}
		await adapter.mkdir(path);
	}

	// ========================================================================
	// Vault events
	// ========================================================================

	private subscribeVaultEvents(): void {
		const root = this.settingsAccess.getSnapshot().agentWorkspace.path;
		const resourcesPrefix = `${joinVaultPath(root, RESOURCES_DIRNAME)}/`;

		const matchesResources = (file: TAbstractFile): boolean => {
			return file.path.startsWith(resourcesPrefix);
		};

		const markDirty = (file: TAbstractFile, oldPath?: string) => {
			if (
				matchesResources(file) ||
				(oldPath && oldPath.startsWith(resourcesPrefix))
			) {
				this.manifestDirty = true;
			}
		};

		this.vaultEventRefs.push(
			this.app.vault.on("create", (file) => markDirty(file)),
		);
		this.vaultEventRefs.push(
			this.app.vault.on("modify", (file) => markDirty(file)),
		);
		this.vaultEventRefs.push(
			this.app.vault.on("delete", (file) => markDirty(file)),
		);
		this.vaultEventRefs.push(
			this.app.vault.on("rename", (file, oldPath) =>
				markDirty(file, oldPath),
			),
		);
	}

	// ========================================================================
	// Manifest
	// ========================================================================

	private rebuildManifestIfDirty(): void {
		if (!this.manifestDirty) return;
		this.manifest = this.buildResourcesManifest();
		this.manifestDirty = false;
	}

	private buildResourcesManifest(): ResourcesManifest {
		const settings = this.settingsAccess.getSnapshot().agentWorkspace;
		const resourcesPath = joinVaultPath(
			settings.path,
			RESOURCES_DIRNAME,
		);
		const folder = this.app.vault.getAbstractFileByPath(resourcesPath);

		if (!(folder instanceof TFolder)) {
			return { entries: [], truncated: 0 };
		}

		const collected: ResourceEntry[] = [];
		this.walkFolder(folder, 0, settings.resourcesMaxDepth, collected);

		// Sort by mtime desc — most recently modified surfaces first
		collected.sort((a, b) => b.mtimeMs - a.mtimeMs);

		const cap = settings.resourcesMaxEntries;
		const truncated =
			collected.length > cap ? collected.length - cap : 0;
		const entries = collected.slice(0, cap);

		return { entries, truncated };
	}

	private walkFolder(
		folder: TFolder,
		depth: number,
		maxDepth: number,
		out: ResourceEntry[],
	): void {
		for (const child of folder.children) {
			if (child.name.startsWith(".")) continue;

			if (child instanceof TFile) {
				out.push({
					vaultPath: child.path,
					size: child.stat.size ?? 0,
					mtimeMs: child.stat.mtime ?? 0,
					extension: child.extension,
				});
			} else if (child instanceof TFolder) {
				if (depth + 1 <= maxDepth) {
					this.walkFolder(child, depth + 1, maxDepth, out);
				}
			}
		}
	}

	// ========================================================================
	// Hashing
	// ========================================================================

	private hashManifest(manifest: ResourcesManifest): string {
		const canonical = JSON.stringify({
			truncated: manifest.truncated,
			entries: manifest.entries.map((e) => ({
				p: e.vaultPath,
				s: e.size,
				m: e.mtimeMs,
				x: e.extension,
			})),
		});
		return cyrb53(canonical);
	}

	private hashContent(content: string): string {
		return cyrb53(content);
	}

	// ========================================================================
	// Snapshot
	// ========================================================================

	private async readIndex(): Promise<string> {
		const settings = this.settingsAccess.getSnapshot().agentWorkspace;
		const indexPath = joinVaultPath(settings.path, INDEX_FILENAME);
		const file = this.app.vault.getAbstractFileByPath(indexPath);
		if (file instanceof TFile) {
			try {
				return await this.app.vault.read(file);
			} catch (error) {
				this.logger.warn(
					`[AgentWorkspace] Failed to read ${INDEX_FILENAME}:`,
					error,
				);
				return "";
			}
		}
		return "";
	}

	private computeSnapshotFromState(
		indexContent: string,
		manifest: ResourcesManifest,
		hasSeed: boolean,
	): WorkspaceSnapshot {
		return {
			indexHash: this.hashContent(indexContent),
			resourcesManifestHash: this.hashManifest(manifest),
			outputDateString: todayDateString(),
			hasSeed,
		};
	}

	async postTurnSnapshot(): Promise<WorkspaceSnapshot> {
		await this.ensureBootstrapped();
		this.rebuildManifestIfDirty();
		const indexContent = await this.readIndex();
		return this.computeSnapshotFromState(indexContent, this.manifest, true);
	}

	// ========================================================================
	// Prelude
	// ========================================================================

	async buildPrelude(
		snapshot: WorkspaceSnapshot | null,
		options: BuildPreludeOptions,
	): Promise<BuildPreludeResult> {
		await this.ensureBootstrapped();

		if (!this.bootstrapped || this.bootstrapFailed) {
			// Feature disabled at runtime due to bootstrap failure — emit nothing.
			const fallback: WorkspaceSnapshot = {
				indexHash: "",
				resourcesManifestHash: "",
				outputDateString: todayDateString(),
				hasSeed: snapshot?.hasSeed ?? false,
			};
			return {
				state: null,
				instructions: null,
				pendingSnapshot: fallback,
			};
		}

		this.rebuildManifestIfDirty();

		const settings = this.settingsAccess.getSnapshot().agentWorkspace;
		const indexContent = await this.readIndex();
		const today = todayDateString();
		const pendingSnapshot = this.computeSnapshotFromState(
			indexContent,
			this.manifest,
			true,
		);

		const stateUri = this.buildWorkspaceFolderUri(settings.path, options);
		const isSeed = !snapshot || !snapshot.hasSeed;

		if (isSeed) {
			const xml = this.buildSeedStateXml(
				indexContent,
				this.manifest,
				today,
				settings,
				options,
			);
			const state: WorkspaceXmlBlock = { uri: stateUri, xml };
			const instructions: WorkspaceXmlBlock | null =
				settings.emitInstructions
					? {
							uri: WORKSPACE_INSTRUCTIONS_URI,
							xml: this.formatInstructionsXml(
								settings.agentAssistedFocusUpdate,
							),
						}
					: null;
			return { state, instructions, pendingSnapshot };
		}

		const xml = this.buildDeltaStateXml(
			snapshot,
			pendingSnapshot,
			indexContent,
			this.manifest,
			today,
			settings,
			options,
		);
		const state: WorkspaceXmlBlock | null =
			xml.length > 0 ? { uri: stateUri, xml } : null;
		return { state, instructions: null, pendingSnapshot };
	}

	private buildWorkspaceFolderUri(
		workspacePath: string,
		options: BuildPreludeOptions,
	): string {
		const abs = resolveAbsolute(
			workspacePath,
			options.vaultBasePath,
			options.convertToWsl,
		);
		// Trailing slash signals folder intent.
		const withSlash = abs.endsWith("/") ? abs : `${abs}/`;
		return buildFileUri(withSlash);
	}

	private buildSeedStateXml(
		indexContent: string,
		manifest: ResourcesManifest,
		today: string,
		settings: ReturnType<
			ISettingsAccess["getSnapshot"]
		>["agentWorkspace"],
		options: BuildPreludeOptions,
	): string {
		const indexBlock = this.formatIndexBlock(
			indexContent,
			settings.path,
			options,
		);
		const resourcesBlock = this.formatResourcesBlock(
			manifest,
			settings,
			options,
			"seed",
		);
		const outputBlock = this.formatOutputDirectoryBlock(
			today,
			settings.path,
			options,
		);

		return [
			"<obsidian_workspace>",
			indexBlock,
			resourcesBlock,
			outputBlock,
			"</obsidian_workspace>",
		].join("\n");
	}

	private buildDeltaStateXml(
		prev: WorkspaceSnapshot,
		next: WorkspaceSnapshot,
		indexContent: string,
		manifest: ResourcesManifest,
		today: string,
		settings: ReturnType<
			ISettingsAccess["getSnapshot"]
		>["agentWorkspace"],
		options: BuildPreludeOptions,
	): string {
		const indexChanged =
			prev.indexHash !== next.indexHash;
		const manifestChanged =
			prev.resourcesManifestHash !== next.resourcesManifestHash;
		const dateChanged = prev.outputDateString !== next.outputDateString;

		if (!indexChanged && !manifestChanged && !dateChanged) {
			return "";
		}

		const parts: string[] = ["<obsidian_workspace_update>"];

		if (indexChanged) {
			parts.push(
				this.formatIndexBlock(
					indexContent,
					settings.path,
					options,
				),
			);
		}

		if (manifestChanged) {
			parts.push(
				this.formatResourcesBlock(
					manifest,
					settings,
					options,
					"delta",
				),
			);
		}

		if (dateChanged) {
			parts.push(
				this.formatOutputDirectoryBlock(
					today,
					settings.path,
					options,
				),
			);
		}

		parts.push("</obsidian_workspace_update>");
		return parts.join("\n");
	}

	// ========================================================================
	// XML formatters
	// ========================================================================

	private formatIndexBlock(
		content: string,
		workspacePath: string,
		options: BuildPreludeOptions,
	): string {
		const indexVaultPath = joinVaultPath(
			workspacePath,
			INDEX_FILENAME,
		);
		const absolutePath = resolveAbsolute(
			indexVaultPath,
			options.vaultBasePath,
			options.convertToWsl,
		);

		const description =
			"This file is the user's curated index of existing knowledge. Each line is a `[[link]]` to an existing note plus a one-line summary of why it matters. Treat these as pointers — read the linked notes only when relevant to the current task.";

		const decoratedContent = this.decorateIndexWithLinks(
			content,
			indexVaultPath,
			options,
		);

		return `  <index path="${escapeXml(absolutePath)}">
    ${description}

${decoratedContent}
  </index>`;
	}

	private decorateIndexWithLinks(
		content: string,
		sourceVaultPath: string,
		options: BuildPreludeOptions,
	): string {
		if (
			!options.expandWikilinkContext ||
			!options.wikilinkResolver ||
			!content
		) {
			return content;
		}

		try {
			const basenameIndex =
				options.wikilinkResolver.buildBasenameIndex();
			const links = options.wikilinkResolver.extractLinkedNoteMetadata(
				content,
				sourceVaultPath,
				basenameIndex,
			);
			const prelude = formatLinkedNotesPrelude(links, {
				vaultBasePath: options.vaultBasePath,
				convertToWsl: options.convertToWsl,
			});
			return prelude + content;
		} catch (error) {
			this.logger.warn(
				"[AgentWorkspace] Failed to expand wikilinks in Index:",
				error,
			);
			return content;
		}
	}

	private formatResourcesBlock(
		manifest: ResourcesManifest,
		settings: ReturnType<
			ISettingsAccess["getSnapshot"]
		>["agentWorkspace"],
		options: BuildPreludeOptions,
		mode: "seed" | "delta",
	): string {
		const resourcesVaultPath = joinVaultPath(
			settings.path,
			RESOURCES_DIRNAME,
		);
		const resourcesAbs = resolveAbsolute(
			resourcesVaultPath,
			options.vaultBasePath,
			options.convertToWsl,
		);

		const truncatedAttr =
			manifest.truncated > 0
				? ` truncated="${manifest.truncated}"`
				: "";

		// In v1 we send the full manifest in delta mode (not added/removed/modified).
		// Diffing keyed entries adds complexity without much agent-side benefit;
		// the manifest itself is small (capped at resourcesMaxEntries).
		const documents = manifest.entries
			.map((entry) => this.formatDocumentLine(entry, options))
			.join("\n");

		const tag = mode === "seed" ? "resources" : "resources";
		const inner = documents.length > 0 ? `\n${documents}\n  ` : "";

		return `  <${tag} directory="${escapeXml(resourcesAbs)}" max_entries="${settings.resourcesMaxEntries}" max_depth="${settings.resourcesMaxDepth}"${truncatedAttr}>${inner}</${tag}>`;
	}

	private formatDocumentLine(
		entry: ResourceEntry,
		options: BuildPreludeOptions,
	): string {
		const abs = resolveAbsolute(
			entry.vaultPath,
			options.vaultBasePath,
			options.convertToWsl,
		);
		const lastModified = new Date(entry.mtimeMs).toISOString();
		return `    <document path="${escapeXml(abs)}" size="${entry.size}" last_modified="${escapeXml(lastModified)}" extension="${escapeXml(entry.extension)}" />`;
	}

	private formatOutputDirectoryBlock(
		today: string,
		workspacePath: string,
		options: BuildPreludeOptions,
	): string {
		const outputVaultPath = joinVaultPath(
			workspacePath,
			AGENT_OUTPUT_DIRNAME,
			today,
		);
		const abs = resolveAbsolute(
			outputVaultPath,
			options.vaultBasePath,
			options.convertToWsl,
		);
		// Trailing slash signals "directory" intent.
		return `  <output_directory absolute_path="${escapeXml(abs)}/" />`;
	}

	private formatInstructionsXml(agentAssistedFocusUpdate: boolean): string {
		const indexUpdateLine = agentAssistedFocusUpdate
			? "After creating a note in output_directory, append a line `[[<basename>]]: <one-line summary>` to Index.md."
			: "";
		const lines = [
			"<obsidian_workspace_instructions>",
			"  Resources/ contains user-submitted raw materials; read them on demand using your file tools.",
			"  Write any new notes to output_directory using absolute paths.",
			"  Index.md is jointly maintained by the user.",
		];
		if (indexUpdateLine) {
			lines.push(`  ${indexUpdateLine}`);
		}
		lines.push("</obsidian_workspace_instructions>");
		return lines.join("\n");
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	destroy(): void {
		for (const ref of this.vaultEventRefs) {
			this.app.vault.offref(ref);
		}
		this.vaultEventRefs = [];
		this.bootstrapped = false;
		this.manifest = { entries: [], truncated: 0 };
		this.manifestDirty = true;
	}
}
