/**
 * Prompt Content Types
 *
 * Types representing content that can be included in a prompt sent to the agent.
 * These correspond to ACP ContentBlock types but are defined independently
 * to maintain domain layer isolation.
 */

/**
 * Text content in a prompt
 */
export interface TextPromptContent {
	type: "text";
	text: string;
}

/**
 * Image content in a prompt
 *
 * Images are sent as Base64-encoded data with their MIME type.
 * Supported MIME types: image/png, image/jpeg, image/gif, image/webp
 */
export interface ImagePromptContent {
	type: "image";
	/** Base64-encoded image data (without data: prefix) */
	data: string;
	/** MIME type of the image */
	mimeType: string;
}

/**
 * Union type for all prompt content types
 */
export type PromptContent = TextPromptContent | ImagePromptContent;
