/**
 * Vault Types
 *
 * Type definitions for Obsidian vault operations and note metadata.
 */

/**
 * Position in the editor (line and character).
 * Line numbers are 0-indexed.
 */
export interface EditorPosition {
	line: number;
	ch: number;
}

/**
 * Metadata for a note in the vault.
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
 * Context for @-mention detection.
 */
export interface MentionContext {
	start: number;
	end: number;
	query: string;
}
