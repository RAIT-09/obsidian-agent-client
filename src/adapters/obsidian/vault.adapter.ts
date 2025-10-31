/**
 * Obsidian Vault Adapter
 *
 * Adapter implementing IVaultAccess port for Obsidian's Vault API.
 * Integrates with NoteMentionService for search functionality and
 * wraps Obsidian's file access APIs with domain-friendly interface.
 */

import type {
	IVaultAccess,
	NoteMetadata,
	EditorPosition,
} from "../../core/domain/ports/vault-access.port";
import { NoteMentionService } from "./mention-service";
import type AgentClientPlugin from "../../infrastructure/obsidian-plugin/plugin";
import {
	TFile,
	MarkdownView,
	type EventRef,
	type EditorSelection,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { Compartment, StateEffect } from "@codemirror/state";

/**
 * Adapter for accessing Obsidian vault notes.
 *
 * Implements IVaultAccess port by wrapping Obsidian's Vault API
 * and NoteMentionService, converting between Obsidian's TFile
 * and domain's NoteMetadata types.
 */
export class ObsidianVaultAdapter implements IVaultAccess {
	private mentionService: NoteMentionService;
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
		this.mentionService = new NoteMentionService(plugin);
	}

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
	 * Returns up to 5 best matches sorted by relevance.
	 * If query is empty, returns recently modified files.
	 *
	 * @param query - Search query string (can be empty for recent files)
	 * @returns Promise resolving to array of matching note metadata
	 */
	async searchNotes(query: string): Promise<NoteMetadata[]> {
		// Use existing NoteMentionService for fuzzy search
		const files = this.mentionService.searchNotes(query);
		return files.map((file) => this.convertToMetadata(file));
	}

	/**
	 * Get the currently active note in the editor.
	 *
	 * Returns the active note with current selection if available.
	 *
	 * @returns Promise resolving to active note metadata, or null if no note is active
	 */
	async getActiveNote(): Promise<NoteMetadata | null> {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) return null;

		const metadata = this.convertToMetadata(activeFile);

		// Add selection if we have it stored for this file
		if (
			this.currentSelection &&
			this.currentSelection.filePath === activeFile.path
		) {
			metadata.selection = this.currentSelection.selection;
		}

		return metadata;
	}

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

		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.attachToView(activeView ?? null);

		this.activeLeafRef = this.plugin.app.workspace.on(
			"active-leaf-change",
			(leaf) => {
				const nextView =
					leaf?.view instanceof MarkdownView
						? leaf.view
						: this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
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

		if (this.lastSelectionKey && !this.lastSelectionKey.startsWith(`${filePath}:`)) {
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

		const cm = (editor as unknown as { cm?: EditorView }).cm;
		emitSelection();

		if (cm) {
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

		return anchorFirst
			? { anchor, head }
			: { anchor: head, head: anchor };
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
				console.error("[ObsidianVaultAdapter] Selection listener error", error);
			}
		}
	}

	/**
	 * List all markdown notes in the vault.
	 *
	 * @returns Promise resolving to array of all note metadata
	 */
	async listNotes(): Promise<NoteMetadata[]> {
		// Use existing NoteMentionService to get all files
		const files = this.mentionService.getAllFiles();
		return files.map((file) => this.convertToMetadata(file));
	}

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
		const aliases = cache?.frontmatter?.aliases;

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
