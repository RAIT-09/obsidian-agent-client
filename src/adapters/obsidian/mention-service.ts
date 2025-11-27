import { TFile, prepareFuzzySearch, EventRef } from "obsidian";
import type AgentClientPlugin from "../../infrastructure/obsidian-plugin/plugin";
import { Logger } from "../../shared/logger";

// Note mention service for @-mention functionality
export class NoteMentionService {
	private files: TFile[] = [];
	private fileByPath = new Map<string, TFile>();
	private lastBuild = 0;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	private eventRefs: EventRef[] = [];
	private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
	private static readonly DEBOUNCE_MS = 100;

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
		this.logger = new Logger(plugin);
		this.rebuildIndex();

		// Listen for vault changes to keep index up to date
		// Store EventRefs for cleanup
		this.eventRefs.push(
			this.plugin.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.debouncedRebuildIndex();
				}
			}),
		);
		this.eventRefs.push(
			this.plugin.app.vault.on("delete", () => this.debouncedRebuildIndex()),
		);
		this.eventRefs.push(
			this.plugin.app.vault.on("rename", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.debouncedRebuildIndex();
				}
			}),
		);
	}

	/**
	 * Debounced rebuild to avoid excessive rebuilds during bulk operations.
	 */
	private debouncedRebuildIndex(): void {
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
		}
		this.debounceTimeout = setTimeout(() => {
			this.rebuildIndex();
			this.debounceTimeout = null;
		}, NoteMentionService.DEBOUNCE_MS);
	}

	private rebuildIndex(): void {
		this.files = this.plugin.app.vault.getMarkdownFiles();
		// Build O(1) lookup map
		this.fileByPath.clear();
		for (const file of this.files) {
			this.fileByPath.set(file.path, file);
		}
		this.lastBuild = Date.now();
		this.logger.log(
			`[NoteMentionService] Rebuilt index with ${this.files.length} files`,
		);
	}

	/**
	 * Cleanup resources when service is destroyed.
	 * Call this when the plugin unloads.
	 */
	destroy(): void {
		// Clear debounce timeout
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
			this.debounceTimeout = null;
		}
		// Unregister all event listeners
		for (const ref of this.eventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.eventRefs = [];
		this.files = [];
		this.fileByPath.clear();
	}

	searchNotes(query: string): TFile[] {
		this.logger.log(
			"[DEBUG] NoteMentionService.searchNotes called with:",
			query,
		);
		this.logger.log("[DEBUG] Total files indexed:", this.files.length);

		if (!query.trim()) {
			this.logger.log("[DEBUG] Empty query, returning recent files");
			// If no query, return recently modified files
			const recentFiles = this.files
				.slice()
				.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
				.slice(0, 5);
			this.logger.log(
				"[DEBUG] Recent files:",
				recentFiles.map((f) => f.name),
			);
			return recentFiles;
		}

		this.logger.log("[DEBUG] Preparing fuzzy search for:", query.trim());
		const fuzzySearch = prepareFuzzySearch(query.trim());

		// Score each file based on multiple fields
		const scored: Array<{ file: TFile; score: number }> = this.files.map(
			(file) => {
				const basename = file.basename;
				const path = file.path;

				// Get aliases from frontmatter
				const fileCache =
					this.plugin.app.metadataCache.getFileCache(file);
				const aliases = fileCache?.frontmatter?.aliases;
				const aliasArray: string[] = Array.isArray(aliases)
					? aliases
					: aliases
						? [aliases]
						: [];

				// Search in basename, path, and aliases
				const searchFields = [basename, path, ...aliasArray];
				let bestScore = -Infinity;

				for (const field of searchFields) {
					const match = fuzzySearch(field);
					if (match && match.score > bestScore) {
						bestScore = match.score;
					}
				}

				return { file, score: bestScore };
			},
		);

		return scored
			.filter((item) => item.score > -Infinity)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map((item) => item.file);
	}

	getAllFiles(): TFile[] {
		return this.files;
	}

	getFileByPath(path: string): TFile | null {
		return this.fileByPath.get(path) ?? null;
	}
}
