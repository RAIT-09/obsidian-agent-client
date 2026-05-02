/**
 * Vault Service
 *
 * Unified service implementing IVaultAccess port for Obsidian's Vault API.
 * Combines vault file access, fuzzy search (formerly NoteMentionService),
 * and editor selection tracking into a single service.
 */

import type AgentClientPlugin from "../plugin";
import {
	TFile,
	MarkdownView,
	prepareFuzzySearch,
	type EventRef,
	type EditorSelection,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { Compartment, StateEffect } from "@codemirror/state";
import { getLogger, Logger } from "../utils/logger";

// ============================================================================
// Port Types (from vault-access.port.ts)
// ============================================================================

/**
 * Position in the editor (line and character).
 * Line numbers are 0-indexed.
 */
export interface EditorPosition {
	/** Line number (0-indexed) */
	line: number;
	/** Character position within the line */
	ch: number;
}

/**
 * Metadata for a note in the vault.
 *
 * Contains essential information about a note file without
 * exposing Obsidian's internal TFile structure.
 */
export interface NoteMetadata {
	/** Full path to the note within the vault (e.g., "folder/note.md") */
	path: string;

	/** Filename without extension (e.g., "note") */
	name: string;

	/** File extension (usually "md") */
	extension: string;

	/** Creation timestamp (milliseconds since epoch) */
	created: number;

	/** Last modified timestamp (milliseconds since epoch) */
	modified: number;

	/** Optional aliases from frontmatter */
	aliases?: string[];

	/** Optional text selection range in the editor */
	selection?: {
		from: EditorPosition;
		to: EditorPosition;
	};
}

/**
 * Interface for accessing vault notes and files.
 *
 * Provides methods for searching, reading, and listing notes
 * in the Obsidian vault. This port will be implemented by adapters
 * that use Obsidian's Vault API.
 */
export interface IVaultAccess {
	/**
	 * Read the content of a note.
	 *
	 * @param path - Path to the note within the vault
	 * @returns Promise resolving to note content as plain text
	 * @throws Error if note doesn't exist or cannot be read
	 */
	readNote(path: string): Promise<string>;

	/**
	 * Search for notes matching a query.
	 *
	 * Uses fuzzy search against note names, paths, and aliases.
	 * Returns up to 5 best matches sorted by relevance.
	 * If query is empty, returns recently modified files.
	 *
	 * @param query - Search query string (can be empty for recent files)
	 * @returns Promise resolving to array of matching note metadata
	 */
	searchNotes(query: string): Promise<NoteMetadata[]>;

	/**
	 * Get the currently active note in the editor.
	 *
	 * @returns Promise resolving to active note metadata, or null if no note is active
	 */
	getActiveNote(): Promise<NoteMetadata | null>;

	/**
	 * List all markdown notes in the vault.
	 *
	 * @returns Promise resolving to array of all note metadata
	 */
	listNotes(): Promise<NoteMetadata[]>;
}

/**
 * Unified vault service for note access, fuzzy search, and selection tracking.
 *
 * Implements IVaultAccess port by wrapping Obsidian's Vault API,
 * providing built-in fuzzy search (formerly NoteMentionService),
 * and tracking editor selection state.
 */
export class VaultService implements IVaultAccess {
	private files: TFile[] = [];
	private lastBuild = 0;
	private logger: Logger;
	private vaultEventRefs: ReturnType<typeof this.plugin.app.vault.on>[] = [];

	private currentSelection: {
		filePath: string;
		selection: { from: EditorPosition; to: EditorPosition };
	} | null = null;
	private selectionListeners = new Set<() => void>();
	private activeLeafRef: EventRef | null = null;
	private detachEditorListenerFn: (() => void) | null = null;
	private selectionCompartment: Compartment | null = null;
	private lastSelectionKey = "";

	constructor(private plugin: AgentClientPlugin) {
		// File index init
		this.logger = getLogger();
		this.rebuildIndex();
		this.registerVaultEvents();

		// Selection tracking init
		this.currentSelection = null;
		this.selectionListeners = new Set();
	}

	// ========================================================================
	// File Index (formerly NoteMentionService)
	// ========================================================================

	private rebuildIndex() {
		this.files = this.plugin.app.vault.getMarkdownFiles();
		this.lastBuild = Date.now();
		this.logger.log(
			`[VaultService] Rebuilt index with ${this.files.length} files`,
		);
	}

	private registerVaultEvents() {
		this.vaultEventRefs.push(
			this.plugin.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.rebuildIndex();
				}
			}),
		);
		this.vaultEventRefs.push(
			this.plugin.app.vault.on("delete", () => this.rebuildIndex()),
		);
		this.vaultEventRefs.push(
			this.plugin.app.vault.on("rename", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.rebuildIndex();
				}
			}),
		);
	}

	getAllFiles(): TFile[] {
		return this.files;
	}

	getFileByPath(path: string): TFile | null {
		return this.files.find((file) => file.path === path) || null;
	}

	// ========================================================================
	// IVaultAccess Implementation
	// ========================================================================

	/**
	 * Read the content of a note.
	 *
	 * @param path - Path to the note within the vault
	 * @returns Promise resolving to note content as plain text
	 * @throws Error if note doesn't exist or cannot be read
	 */
	async readNote(path: string): Promise<string> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${path}`);
		}
		return await this.plugin.app.vault.read(file);
	}

	/**
	 * Search for notes matching a query.
	 *
	 * Uses fuzzy search against note names, paths, and aliases.
	 * Returns up to 20 best matches sorted by relevance.
	 * If query is empty, returns recently modified files.
	 *
	 * @param query - Search query string (can be empty for recent files)
	 * @returns Promise resolving to array of matching note metadata
	 */
	searchNotes(query: string): Promise<NoteMetadata[]> {
		if (!query.trim()) {
			const recentFiles = this.files
				.slice()
				.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
				.slice(0, 20);
			return Promise.resolve(
				recentFiles.map((file) => this.convertToMetadata(file)),
			);
		}

		const fuzzySearch = prepareFuzzySearch(query.trim());

		const scored: Array<{ file: TFile; score: number }> = this.files.map(
			(file) => {
				const basename = file.basename;
				const path = file.path;
				const fileCache =
					this.plugin.app.metadataCache.getFileCache(file);
				const aliases = fileCache?.frontmatter?.aliases as
					| string[]
					| string
					| undefined;
				const aliasArray: string[] = Array.isArray(aliases)
					? aliases
					: aliases
						? [aliases]
						: [];

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

		const results = scored
			.filter((item) => item.score > -Infinity)
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
			.map((item) => this.convertToMetadata(item.file));
		return Promise.resolve(results);
	}

	/**
	 * Get the currently active note in the editor.
	 *
	 * Returns the active note with current selection if available.
	 *
	 * @returns Promise resolving to active note metadata, or null if no note is active
	 */
	getActiveNote(): Promise<NoteMetadata | null> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) return Promise.resolve(null);

		const metadata = this.convertToMetadata(activeFile);

		// Add selection if we have it stored for this file
		if (
			this.currentSelection &&
			this.currentSelection.filePath === activeFile.path
		) {
			metadata.selection = this.currentSelection.selection;
		}

		return Promise.resolve(metadata);
	}

	/**
	 * List all markdown notes in the vault.
	 *
	 * @returns Promise resolving to array of all note metadata
	 */
	listNotes(): Promise<NoteMetadata[]> {
		return Promise.resolve(
			this.files.map((file) => this.convertToMetadata(file)),
		);
	}

	// ========================================================================
	// Selection Tracking
	// ========================================================================

	/**
	 * Subscribe to selection changes for the active markdown editor.
	 *
	 * The adapter will monitor the currently active MarkdownView and
	 * keep track of its selection, notifying subscribers whenever the
	 * selection or active file changes.
	 */
	subscribeSelectionChanges(listener: () => void): () => void {
		this.selectionListeners.add(listener);
		this.ensureSelectionTracking();

		return () => {
			this.selectionListeners.delete(listener);
			if (this.selectionListeners.size === 0) {
				this.teardownSelectionTracking();
			}
		};
	}

	private ensureSelectionTracking(): void {
		if (this.activeLeafRef) {
			return;
		}

		const activeView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.attachToView(activeView ?? null);

		this.activeLeafRef = this.plugin.app.workspace.on(
			"active-leaf-change",
			(leaf) => {
				const nextView =
					leaf?.view instanceof MarkdownView
						? leaf.view
						: this.plugin.app.workspace.getActiveViewOfType(
								MarkdownView,
							);
				this.attachToView(nextView ?? null);
			},
		);
	}

	private teardownSelectionTracking(): void {
		this.detachEditorListener();
		if (this.activeLeafRef) {
			this.plugin.app.workspace.offref(this.activeLeafRef);
			this.activeLeafRef = null;
		}
		this.lastSelectionKey = "";
	}

	private detachEditorListener(): void {
		if (this.detachEditorListenerFn) {
			this.detachEditorListenerFn();
			this.detachEditorListenerFn = null;
		}
		this.selectionCompartment = null;
	}

	private attachToView(view: MarkdownView | null): void {
		this.detachEditorListener();

		if (!view?.file) {
			return;
		}

		const { editor, file } = view;
		const filePath = file.path;

		if (
			this.lastSelectionKey &&
			!this.lastSelectionKey.startsWith(`${filePath}:`)
		) {
			// Clear previous file selection when switching files
			this.handleSelectionChange(filePath, null);
		}

		const emitSelection = () => {
			if (editor.somethingSelected()) {
				const selections = editor.listSelections();
				if (selections.length > 0) {
					const normalized = this.normalizeSelection(selections[0]);
					this.handleSelectionChange(filePath, {
						from: {
							line: normalized.anchor.line,
							ch: normalized.anchor.ch,
						},
						to: {
							line: normalized.head.line,
							ch: normalized.head.ch,
						},
					});
					return;
				}
			}

			const editorHasFocus = editor.hasFocus();
			if (editorHasFocus) {
				this.handleSelectionChange(filePath, null);
			}
		};

		// Access CodeMirror 6 instance from Obsidian's Editor
		// WARNING: This uses Obsidian's internal API (editor.cm) which is not documented
		// and may change or be removed in future versions.
		// This is required for real-time selection change tracking via EditorView.updateListener.
		// If this API becomes unavailable, selection tracking will silently fail.
		const cm = (editor as unknown as { cm?: EditorView }).cm;
		emitSelection();

		if (!cm) {
			// Fallback: CodeMirror 6 API not available
			// This may happen if:
			// 1. Obsidian changes its internal implementation
			// 2. A future Obsidian version removes the 'cm' property
			// 3. The editor is in a different mode (e.g., legacy editor)
			getLogger().debug(
				"[VaultService] CodeMirror 6 API not available. " +
					"Selection change tracking will not work. " +
					"This may be due to an Obsidian version change.",
			);
			return;
		}

		// Only proceed if cm is available
		{
			const compartment = new Compartment();
			this.selectionCompartment = compartment;
			cm.dispatch({
				effects: StateEffect.appendConfig.of(
					compartment.of(
						EditorView.updateListener.of((update) => {
							if (update.selectionSet) {
								emitSelection();
							}
						}),
					),
				),
			});
			this.detachEditorListenerFn = () => {
				if (this.selectionCompartment) {
					cm.dispatch({
						effects: this.selectionCompartment.reconfigure([]),
					});
				}
				this.selectionCompartment = null;
			};
		}
	}

	private normalizeSelection(selection: EditorSelection) {
		const anchor = selection.anchor;
		const head = selection.head ?? selection.anchor;
		const anchorFirst =
			anchor.line < head.line ||
			(anchor.line === head.line && anchor.ch <= head.ch);

		return anchorFirst ? { anchor, head } : { anchor: head, head: anchor };
	}

	private handleSelectionChange(
		filePath: string | null,
		selection: { from: EditorPosition; to: EditorPosition } | null,
	): void {
		const selectionKey = filePath
			? selection
				? `${filePath}:${selection.from.line}:${selection.from.ch}-${selection.to.line}:${selection.to.ch}`
				: `${filePath}:none`
			: "none";

		if (selectionKey === this.lastSelectionKey) {
			return;
		}

		this.lastSelectionKey = selectionKey;

		if (filePath && selection) {
			this.currentSelection = {
				filePath,
				selection,
			};
		} else if (
			this.currentSelection &&
			(filePath === null || this.currentSelection.filePath === filePath)
		) {
			this.currentSelection = null;
		}

		this.notifySelectionListeners();
	}

	private notifySelectionListeners(): void {
		for (const listener of this.selectionListeners) {
			try {
				listener();
			} catch (error) {
				getLogger().error("[VaultService] Selection listener error", error);
			}
		}
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	/**
	 * Clean up all event listeners and tracking.
	 * Call this when the service is no longer needed.
	 */
	destroy(): void {
		// Clean up vault event listeners (from file index)
		for (const ref of this.vaultEventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.vaultEventRefs = [];

		// Clean up selection tracking
		this.teardownSelectionTracking();
	}

	// ========================================================================
	// Private Helpers
	// ========================================================================

	/**
	 * Convert Obsidian TFile to domain NoteMetadata.
	 *
	 * Extracts relevant properties from TFile and metadata cache,
	 * including frontmatter aliases.
	 *
	 * @param file - Obsidian TFile object
	 * @returns NoteMetadata object
	 */
	private convertToMetadata(file: TFile): NoteMetadata {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const aliases = cache?.frontmatter?.aliases as
			| string[]
			| string
			| undefined;

		return {
			path: file.path,
			name: file.basename,
			extension: file.extension,
			created: file.stat.ctime,
			modified: file.stat.mtime,
			aliases: Array.isArray(aliases)
				? aliases
				: aliases
					? [aliases]
					: undefined,
		};
	}
}
