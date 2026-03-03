/**
 * Attached image for ChatInput.
 * Matches the AttachedImage interface in ImagePreviewStrip.tsx.
 */
export interface AttachedImage {
	id: string;
	data: string;
	mimeType: string;
}

/**
 * ChatInput component state that can be shared between views.
 * Used when transferring pending input between chat views.
 */
export interface ChatInputState {
	/** Text content in the input field */
	text: string;
	/** Attached images (base64 encoded) */
	images: AttachedImage[];
}
