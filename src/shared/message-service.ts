/**
 * Message Service
 *
 * Pure functions for prompt preparation and sending.
 * Extracted from SendMessageUseCase for better separation of concerns.
 *
 * Responsibilities:
 * - Process mentions (@[[note]] syntax)
 * - Add auto-mention for active note
 * - Convert mentions to file paths
 * - Send prompt to agent via IAgentClient
 * - Handle authentication errors with retry logic
 */

import type { IAgentClient } from "../domain/ports/agent-client.port";
import type {
	IVaultAccess,
	NoteMetadata,
	EditorPosition,
} from "../domain/ports/vault-access.port";
import { AcpErrorCode, type AcpError } from "../domain/models/agent-error";
import {
	extractErrorCode,
	toAcpError,
	isEmptyResponseError,
} from "./acp-error-utils";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import type {
	PromptContent,
	ImagePromptContent,
	ResourcePromptContent,
} from "../domain/models/prompt-content";
import { extractMentionedNotes, type IMentionService } from "./mention-utils";
import { convertWindowsPathToWsl } from "./wsl-utils";
import { buildFileUri } from "./path-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for preparing a prompt
 */
export interface PreparePromptInput {
	/** User's message text (may contain @mentions) */
	message: string;

	/** Attached images */
	images?: ImagePromptContent[];

	/** Currently active note (for auto-mention feature) */
	activeNote?: NoteMetadata | null;

	/** Vault base path for converting mentions to absolute paths */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;

	/** Whether to convert paths to WSL format (Windows + WSL mode) */
	convertToWsl?: boolean;

	/** Whether agent supports embeddedContext capability */
	supportsEmbeddedContext?: boolean;

	/** Maximum characters per mentioned note (default: 10000) */
	maxNoteLength?: number;

	/** Maximum characters for selection (default: 10000) */
	maxSelectionLength?: number;
}

/**
 * Result of preparing a prompt
 */
export interface PreparePromptResult {
	/** Content for UI display (original text + images) */
	displayContent: PromptContent[];

	/** Content to send to agent (processed text + images) */
	agentContent: PromptContent[];

	/** Auto-mention context metadata (if auto-mention is active) */
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

/**
 * Input for sending a prepared prompt
 */
export interface SendPreparedPromptInput {
	/** Current session ID */
	sessionId: string;

	/** The prepared agent content (from preparePrompt) */
	agentContent: PromptContent[];

	/** The display content (for error reporting) */
	displayContent: PromptContent[];

	/** Available authentication methods */
	authMethods: AuthenticationMethod[];
}

/**
 * Result of sending a prompt
 */
export interface SendPromptResult {
	/** Whether the prompt was sent successfully */
	success: boolean;

	/** The display content */
	displayContent: PromptContent[];

	/** The agent content sent */
	agentContent: PromptContent[];

	/** Error information if sending failed */
	error?: AcpError;

	/** Whether authentication is required */
	requiresAuth?: boolean;

	/** Whether the prompt was successfully sent after retry */
	retriedSuccessfully?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_NOTE_LENGTH = 10000; // Default maximum characters per note
const DEFAULT_MAX_SELECTION_LENGTH = 10000; // Default maximum characters for selection

// ============================================================================
// Prompt Preparation Functions
// ============================================================================

/**
 * Prepare a prompt for sending to the agent.
 *
 * Processes the message by:
 * - Building context blocks for mentioned notes
 * - Adding auto-mention context for active note
 * - Creating agent content with context + user message + images
 *
 * When agent supports embeddedContext capability, mentioned notes are sent
 * as Resource content blocks. Otherwise, they are embedded as XML text.
 */
export async function preparePrompt(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
): Promise<PreparePromptResult> {
	// Step 1: Extract all mentioned notes from the message
	const mentionedNotes = extractMentionedNotes(input.message, mentionService);

	// Step 2: Build context based on agent capabilities
	if (input.supportsEmbeddedContext) {
		return preparePromptWithEmbeddedContext(
			input,
			vaultAccess,
			mentionedNotes,
		);
	} else {
		return preparePromptWithTextContext(input, vaultAccess, mentionedNotes);
	}
}

/**
 * Prepare prompt using embedded Resource format (for embeddedContext-capable agents).
 */
async function preparePromptWithEmbeddedContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
): Promise<PreparePromptResult> {
	const resourceBlocks: ResourcePromptContent[] = [];

	// Build Resource blocks for each mentioned note
	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}

		try {
			const content = await vaultAccess.readNote(file.path);
			const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;

			let processedContent = content;
			if (content.length > maxNoteLen) {
				processedContent =
					content.substring(0, maxNoteLen) +
					`\n\n[Note: Truncated from ${content.length} to ${maxNoteLen} characters]`;
			}

			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;

			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			resourceBlocks.push({
				type: "resource",
				resource: {
					uri: buildFileUri(absolutePath),
					mimeType: "text/markdown",
					text: processedContent,
				},
				annotations: {
					audience: ["assistant"],
					priority: 1.0, // Manual mentions are high priority
					lastModified: new Date(file.stat.mtime).toISOString(),
				},
			});
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	// Build auto-mention Resource block
	const autoMentionBlocks: PromptContent[] = [];
	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoMentionResource = await buildAutoMentionResource(
			input.activeNote,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
		);
		autoMentionBlocks.push(...autoMentionResource);
	}

	// Build content arrays
	const displayContent: PromptContent[] = [
		...(input.message
			? [{ type: "text" as const, text: input.message }]
			: []),
		...(input.images || []),
	];

	// Build auto-mention prefix for session/load recovery
	// This allows @[[note]] to be restored when loading a saved session
	const autoMentionPrefix =
		input.activeNote && !input.isAutoMentionDisabled
			? input.activeNote.selection
				? `@[[${input.activeNote.name}]]:${input.activeNote.selection.from.line + 1}-${input.activeNote.selection.to.line + 1}\n`
				: `@[[${input.activeNote.name}]]\n`
			: "";

	const agentContent: PromptContent[] = [
		...resourceBlocks,
		...autoMentionBlocks,
		...(input.message || autoMentionPrefix
			? [
					{
						type: "text" as const,
						text: autoMentionPrefix + input.message,
					},
				]
			: []),
		...(input.images || []),
	];

	// Build auto-mention context metadata for UI
	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine:
									input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayContent,
		agentContent,
		autoMentionContext,
	};
}

/**
 * Prepare prompt using XML text format (fallback for agents without embeddedContext).
 */
async function preparePromptWithTextContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
): Promise<PreparePromptResult> {
	const contextBlocks: string[] = [];

	// Build XML context blocks for each mentioned note
	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}

		try {
			const content = await vaultAccess.readNote(file.path);
			const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;

			let processedContent = content;
			let truncationNote = "";

			if (content.length > maxNoteLen) {
				processedContent = content.substring(0, maxNoteLen);
				truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${maxNoteLen} characters]`;
			}

			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;

			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			const contextBlock = `<obsidian_mentioned_note ref="${absolutePath}">\n${processedContent}${truncationNote}\n</obsidian_mentioned_note>`;
			contextBlocks.push(contextBlock);
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	// Build auto-mention XML context
	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoMentionContextBlock = await buildAutoMentionTextContext(
			input.activeNote.path,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.activeNote.selection,
			input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
		);
		contextBlocks.push(autoMentionContextBlock);
	}

	// Build auto-mention prefix for session/load recovery
	// This allows @[[note]] to be restored when loading a saved session
	const autoMentionPrefix =
		input.activeNote && !input.isAutoMentionDisabled
			? input.activeNote.selection
				? `@[[${input.activeNote.name}]]:${input.activeNote.selection.from.line + 1}-${input.activeNote.selection.to.line + 1}\n`
				: `@[[${input.activeNote.name}]]\n`
			: "";

	// Build agent message text (context blocks + auto-mention prefix + original message)
	const agentMessageText =
		contextBlocks.length > 0
			? contextBlocks.join("\n") +
				"\n\n" +
				autoMentionPrefix +
				input.message
			: autoMentionPrefix + input.message;

	// Build content arrays
	const displayContent: PromptContent[] = [
		...(input.message
			? [{ type: "text" as const, text: input.message }]
			: []),
		...(input.images || []),
	];

	const agentContent: PromptContent[] = [
		...(agentMessageText
			? [{ type: "text" as const, text: agentMessageText }]
			: []),
		...(input.images || []),
	];

	// Build auto-mention context metadata for UI
	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine:
									input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayContent,
		agentContent,
		autoMentionContext,
	};
}

/**
 * Build Resource content blocks for auto-mentioned note.
 */
async function buildAutoMentionResource(
	activeNote: NoteMetadata,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	maxSelectionLength: number,
): Promise<PromptContent[]> {
	let absolutePath = vaultPath
		? `${vaultPath}/${activeNote.path}`
		: activeNote.path;

	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}

	const uri = buildFileUri(absolutePath);

	if (activeNote.selection) {
		// Selection exists - send the selected content as a Resource
		const fromLine = activeNote.selection.from.line + 1;
		const toLine = activeNote.selection.to.line + 1;

		try {
			const content = await vaultAccess.readNote(activeNote.path);
			const lines = content.split("\n");
			const selectedLines = lines.slice(
				activeNote.selection.from.line,
				activeNote.selection.to.line + 1,
			);
			let selectedText = selectedLines.join("\n");

			if (selectedText.length > maxSelectionLength) {
				selectedText =
					selectedText.substring(0, maxSelectionLength) +
					`\n\n[Note: Truncated from ${selectedLines.join("\n").length} to ${maxSelectionLength} characters]`;
			}

			return [
				{
					type: "resource",
					resource: {
						uri: uri,
						mimeType: "text/markdown",
						text: selectedText,
					},
					annotations: {
						audience: ["assistant"],
						priority: 0.8, // Selection is high priority
						lastModified: new Date(
							activeNote.modified,
						).toISOString(),
					},
				} as ResourcePromptContent,
				{
					type: "text",
					text: `The user has selected lines ${fromLine}-${toLine} in the above note. This is what they are currently focusing on.`,
				},
			];
		} catch (error) {
			console.error(
				`Failed to read selection from ${activeNote.path}:`,
				error,
			);
			return [
				{
					type: "text",
					text: `The user has selected lines ${fromLine}-${toLine} in ${uri}. If relevant, use the Read tool to examine the specific lines.`,
				},
			];
		}
	}

	// No selection - just inform about the opened note
	return [
		{
			type: "text",
			text: `The user has opened the note ${uri} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.`,
		},
	];
}

/**
 * Build XML text context from auto-mentioned note (fallback format).
 */
async function buildAutoMentionTextContext(
	notePath: string,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	selection: { from: EditorPosition; to: EditorPosition } | undefined,
	maxSelectionLength: number,
): Promise<string> {
	let absolutePath = vaultPath ? `${vaultPath}/${notePath}` : notePath;

	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}

	if (selection) {
		const fromLine = selection.from.line + 1;
		const toLine = selection.to.line + 1;

		try {
			const content = await vaultAccess.readNote(notePath);
			const lines = content.split("\n");
			const selectedLines = lines.slice(
				selection.from.line,
				selection.to.line + 1,
			);
			let selectedText = selectedLines.join("\n");

			let truncationNote = "";
			if (selectedText.length > maxSelectionLength) {
				selectedText = selectedText.substring(0, maxSelectionLength);
				truncationNote = `\n\n[Note: The selection was truncated. Original length: ${selectedLines.join("\n").length} characters, showing first ${maxSelectionLength} characters]`;
			}

			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">
The user opened the note ${absolutePath} in Obsidian and selected the following text (lines ${fromLine}-${toLine}):

${selectedText}${truncationNote}

This is what the user is currently focusing on.
</obsidian_opened_note>`;
		} catch (error) {
			console.error(`Failed to read selection from ${notePath}:`, error);
			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">The user opened the note ${absolutePath} in Obsidian and is focusing on lines ${fromLine}-${toLine}. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the specific lines.</obsidian_opened_note>`;
		}
	}

	return `<obsidian_opened_note>The user opened the note ${absolutePath} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>`;
}

// ============================================================================
// Prompt Sending Functions
// ============================================================================

/**
 * Send a prepared prompt to the agent.
 */
export async function sendPreparedPrompt(
	input: SendPreparedPromptInput,
	agentClient: IAgentClient,
): Promise<SendPromptResult> {
	try {
		await agentClient.sendPrompt(input.sessionId, input.agentContent);

		return {
			success: true,
			displayContent: input.displayContent,
			agentContent: input.agentContent,
		};
	} catch (error) {
		return await handleSendError(
			error,
			input.sessionId,
			input.agentContent,
			input.displayContent,
			input.authMethods,
			agentClient,
		);
	}
}

// ============================================================================
// Error Handling Functions
// ============================================================================

/**
 * Handle errors that occur during prompt sending.
 *
 * Error handling strategy:
 * 1. "empty response text" errors are ignored (not real errors)
 * 2. -32000 (Authentication Required) triggers authentication retry
 * 3. All other errors are converted to AcpError and displayed directly
 */
async function handleSendError(
	error: unknown,
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethods: AuthenticationMethod[],
	agentClient: IAgentClient,
): Promise<SendPromptResult> {
	// Check for "empty response text" error - ignore silently
	if (isEmptyResponseError(error)) {
		return {
			success: true,
			displayContent,
			agentContent,
		};
	}

	const errorCode = extractErrorCode(error);

	// Only attempt authentication retry for -32000 (Authentication Required)
	if (errorCode === AcpErrorCode.AUTHENTICATION_REQUIRED) {
		// Check if authentication methods are available
		if (authMethods && authMethods.length > 0) {
			// Try automatic authentication retry if only one method available
			if (authMethods.length === 1) {
				const retryResult = await retryWithAuthentication(
					sessionId,
					agentContent,
					displayContent,
					authMethods[0].id,
					agentClient,
				);

				if (retryResult) {
					return retryResult;
				}
			}

			// Multiple auth methods or retry failed - let user choose
			return {
				success: false,
				displayContent,
				agentContent,
				requiresAuth: true,
				error: toAcpError(error, sessionId),
			};
		}

		// No auth methods available - still show the error
		// This is not an error condition, agent just doesn't support auth
	}

	// For all other errors, convert to AcpError and display directly
	// The agent's error message is preserved and shown to the user
	return {
		success: false,
		displayContent,
		agentContent,
		error: toAcpError(error, sessionId),
	};
}

/**
 * Retry sending prompt after authentication.
 */
async function retryWithAuthentication(
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethodId: string,
	agentClient: IAgentClient,
): Promise<SendPromptResult | null> {
	try {
		const authSuccess = await agentClient.authenticate(authMethodId);

		if (!authSuccess) {
			return null;
		}

		await agentClient.sendPrompt(sessionId, agentContent);

		return {
			success: true,
			displayContent,
			agentContent,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		// Convert retry error to AcpError
		return {
			success: false,
			displayContent,
			agentContent,
			error: toAcpError(retryError, sessionId),
		};
	}
}
