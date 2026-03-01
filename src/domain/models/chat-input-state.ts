/**
 * Attached file for ChatInput.
 *
 * Two kinds:
 * - "image": Base64 embedded image (from paste or D&D with image capability)
 * - "file": File reference by path (D&D non-image, or D&D image without capability)
 */
export interface AttachedFile {
	id: string;
	kind: "image" | "file";
	mimeType: string;

	/** Base64-encoded data (only for kind === "image") */
	data?: string;

	/** File name for display (only for kind === "file") */
	name?: string;

	/** Absolute file path (only for kind === "file") */
	path?: string;

	/** File size in bytes (only for kind === "file", for display + resource_link) */
	size?: number;
}

/**
 * ChatInput component state that can be shared between views.
 * Used for broadcast-prompt command.
 */
export interface ChatInputState {
	/** Text content in the input field */
	text: string;
	/** Attached files (images and non-image files) */
	files: AttachedFile[];
}
