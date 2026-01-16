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
 * Annotations for resource content (ACP spec compliant)
 *
 * Provides hints to the agent about how to use or prioritize the resource.
 */
export interface ResourceAnnotations {
	/** Intended audience(s) for this resource */
	audience?: ("user" | "assistant")[];
	/** Importance (0.0 = least important, 1.0 = most important) */
	priority?: number;
	/** Last modified timestamp (ISO 8601) */
	lastModified?: string;
}

/**
 * Embedded resource content in a prompt
 *
 * Used when agent supports embeddedContext capability.
 * Contains file content with URI and metadata.
 * This allows the agent to receive structured context about referenced files.
 */
export interface ResourcePromptContent {
	type: "resource";
	resource: {
		/** Resource URI (e.g., "file:///path/to/note.md") */
		uri: string;
		/** MIME type of the resource */
		mimeType: string;
		/** Text content of the resource */
		text: string;
	};
	/** Optional annotations for the resource */
	annotations?: ResourceAnnotations;
}

/**
 * Union type for all prompt content types
 */
export type PromptContent =
	| TextPromptContent
	| ImagePromptContent
	| ResourcePromptContent;
