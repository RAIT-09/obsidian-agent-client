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
import { TFile, MarkdownView } from "obsidian";

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
	 * Update the stored selection for the given file.
	 *
	 * This should be called whenever the editor selection changes.
	 * Finds the MarkdownView for the file and stores the current selection.
	 *
	 * @param filePath - Path of the file whose selection changed
	 */
	updateSelection(filePath: string): void {
		// Find the MarkdownView for this file
		const leaves = this.plugin.app.workspace.getLeavesOfType("markdown");
		const leaf = leaves.find((l) => {
			const view = l.view;
			if (view instanceof MarkdownView && view.file) {
				return view.file.path === filePath;
			}
			return false;
		});

		if (!leaf || !(leaf.view instanceof MarkdownView)) {
			return;
		}

		const view = leaf.view;
		const editor = view.editor;

		// Check if text is selected
		if (editor.somethingSelected()) {
			const selections = editor.listSelections();
			if (selections.length > 0) {
				const selection = selections[0]; // Use first selection
				this.currentSelection = {
					filePath,
					selection: {
						from: {
							line: selection.anchor.line,
							ch: selection.anchor.ch,
						},
						to: {
							line: selection.head.line,
							ch: selection.head.ch,
						},
					},
				};
			}
		} else {
			// No selection - clear if it was for this file
			if (
				this.currentSelection &&
				this.currentSelection.filePath === filePath
			) {
				this.currentSelection = null;
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
