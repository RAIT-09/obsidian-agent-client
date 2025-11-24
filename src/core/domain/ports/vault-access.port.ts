/**
 * Port for accessing Obsidian vault
 *
 * This interface abstracts vault operations (reading notes, searching, etc.),
 * allowing the domain layer to work with notes without depending on
 * Obsidian's specific APIs (TFile, Vault, MetadataCache, etc.).
 */

// Re-export types from centralized types/ directory
export type { EditorPosition, NoteMetadata } from "../../../types";

import type { NoteMetadata } from "../../../types";

/**
 * Interface for accessing vault notes and files.
 *
 * Provides methods for searching, reading, and listing notes
 * in the Obsidian vault. This port will be implemented by adapters
 * that use Obsidian's Vault API, NoteMentionService, etc.
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
