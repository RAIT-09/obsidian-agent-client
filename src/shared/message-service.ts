/**
 * Message Service
 *
 * Pure functions for message preparation and sending.
 * Extracted from SendMessageUseCase for better separation of concerns.
 *
 * Responsibilities:
 * - Process mentions (@[[note]] syntax)
 * - Add auto-mention for active note
 * - Convert mentions to file paths
 * - Send message to agent via IAgentClient
 * - Handle authentication errors with retry logic
 */

import type { IAgentClient } from "../core/domain/ports/agent-client.port";
import type {
	IVaultAccess,
	NoteMetadata,
	EditorPosition,
} from "../core/domain/ports/vault-access.port";
import type { AgentError } from "../core/domain/models/agent-error";
import type { AuthenticationMethod } from "../core/domain/models/chat-session";
import {
	extractMentionedNotes,
	type IMentionService,
} from "./mention-utils";
import { convertWindowsPathToWsl } from "./wsl-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for preparing a message
 */
export interface PrepareMessageInput {
	/** User's message text (may contain @mentions) */
	message: string;

	/** Currently active note (for auto-mention feature) */
	activeNote?: NoteMetadata | null;

	/** Vault base path for converting mentions to absolute paths */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;

	/** Whether to convert paths to WSL format (Windows + WSL mode) */
	convertToWsl?: boolean;
}

/**
 * Result of preparing a message
 */
export interface PrepareMessageResult {
	/** The processed message text (without auto-mention syntax in text) */
	displayMessage: string;

	/** The message text to send to agent (with mentions converted to paths) */
	agentMessage: string;

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
 * Input for sending a prepared message
 */
export interface SendPreparedMessageInput {
	/** Current session ID */
	sessionId: string;

	/** The prepared agent message (from prepareMessage) */
	agentMessage: string;

	/** The display message (for error reporting) */
	displayMessage: string;

	/** Available authentication methods */
	authMethods: AuthenticationMethod[];
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
	/** Whether the message was sent successfully */
	success: boolean;

	/** The processed message text (with auto-mention added if applicable) */
	displayMessage: string;

	/** The message text sent to agent (with mentions converted to paths) */
	agentMessage: string;

	/** Error information if sending failed */
	error?: AgentError;

	/** Whether authentication is required */
	requiresAuth?: boolean;

	/** Whether the message was successfully sent after retry */
	retriedSuccessfully?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_NOTE_LENGTH = 10000; // Maximum characters per note
const MAX_SELECTION_LENGTH = 10000; // Maximum characters for selection

// ============================================================================
// Message Preparation Functions
// ============================================================================

/**
 * Prepare a message for sending to the agent.
 *
 * Processes the message by:
 * - Building context blocks for mentioned notes
 * - Adding auto-mention context for active note
 * - Creating agent message with context + user message
 */
export async function prepareMessage(
	input: PrepareMessageInput,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
): Promise<PrepareMessageResult> {
	// Step 1: Extract all mentioned notes from the message
	const mentionedNotes = extractMentionedNotes(input.message, mentionService);

	// Step 2: Build context blocks for each mentioned note
	const contextBlocks: string[] = [];

	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}

		try {
			const content = await vaultAccess.readNote(file.path);

			let processedContent = content;
			let truncationNote = "";

			if (content.length > MAX_NOTE_LENGTH) {
				processedContent = content.substring(0, MAX_NOTE_LENGTH);
				truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${MAX_NOTE_LENGTH} characters]`;
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

	// Step 3: Build context from active note (for agent only)
	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoMentionContextBlock = await buildAutoMentionContext(
			input.activeNote.path,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.activeNote.selection,
		);
		contextBlocks.push(autoMentionContextBlock);
	}

	// Step 4: Build agent message (context blocks + original message)
	const agentMessage =
		contextBlocks.length > 0
			? contextBlocks.join("\n") + "\n\n" + input.message
			: input.message;

	// Step 5: Build auto-mention context metadata
	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine: input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayMessage: input.message,
		agentMessage,
		autoMentionContext,
	};
}

/**
 * Build context from auto-mentioned note.
 */
async function buildAutoMentionContext(
	notePath: string,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	selection?: {
		from: EditorPosition;
		to: EditorPosition;
	},
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
			if (selectedText.length > MAX_SELECTION_LENGTH) {
				selectedText = selectedText.substring(0, MAX_SELECTION_LENGTH);
				truncationNote = `\n\n[Note: The selection was truncated. Original length: ${selectedLines.join("\n").length} characters, showing first ${MAX_SELECTION_LENGTH} characters]`;
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
// Message Sending Functions
// ============================================================================

/**
 * Send a prepared message to the agent.
 */
export async function sendPreparedMessage(
	input: SendPreparedMessageInput,
	agentClient: IAgentClient,
): Promise<SendMessageResult> {
	try {
		await agentClient.sendMessage(input.sessionId, input.agentMessage);

		return {
			success: true,
			displayMessage: input.displayMessage,
			agentMessage: input.agentMessage,
		};
	} catch (error) {
		return await handleSendError(
			error,
			input.sessionId,
			input.agentMessage,
			input.displayMessage,
			input.authMethods,
			agentClient,
		);
	}
}

// ============================================================================
// Error Handling Functions
// ============================================================================

/**
 * Handle errors that occur during message sending.
 */
async function handleSendError(
	error: unknown,
	sessionId: string,
	agentMessage: string,
	displayMessage: string,
	authMethods: AuthenticationMethod[],
	agentClient: IAgentClient,
): Promise<SendMessageResult> {
	// Check for "empty response text" error - ignore silently
	if (isEmptyResponseError(error)) {
		return {
			success: true,
			displayMessage,
			agentMessage,
		};
	}

	// Check if this is a rate limit error
	const isRateLimitError =
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code: unknown }).code === 429;

	if (isRateLimitError) {
		const errorMessage =
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
				? (error as { message: string }).message
				: "Too many requests. Please try again later.";

		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "rate_limit",
				severity: "error",
				title: "Rate Limit Exceeded",
				message: `Rate limit exceeded: ${errorMessage}`,
				suggestion:
					"You have exceeded the API rate limit. Please wait a few moments before trying again.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	// Check if authentication is required
	if (!authMethods || authMethods.length === 0) {
		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "authentication",
				severity: "error",
				title: "No Authentication Methods",
				message: "No authentication methods available for this agent.",
				suggestion: "Please check your agent configuration in settings.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	// Try automatic authentication retry if only one method available
	if (authMethods.length === 1) {
		const retryResult = await retryWithAuthentication(
			sessionId,
			agentMessage,
			displayMessage,
			authMethods[0].id,
			agentClient,
		);

		if (retryResult) {
			return retryResult;
		}
	}

	// Multiple auth methods or retry failed
	return {
		success: false,
		displayMessage,
		agentMessage,
		requiresAuth: true,
		error: {
			id: crypto.randomUUID(),
			category: "authentication",
			severity: "error",
			title: "Authentication Required",
			message:
				"Authentication failed. Please check if you are logged into the agent or if your API key is correctly set.",
			suggestion:
				"Check your agent configuration in settings and ensure API keys are valid.",
			occurredAt: new Date(),
			sessionId,
			originalError: error,
		},
	};
}

/**
 * Check if error is the "empty response text" error that should be ignored.
 */
function isEmptyResponseError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}

	if (!("code" in error) || (error as { code: unknown }).code !== -32603) {
		return false;
	}

	if (!("data" in error)) {
		return false;
	}

	const errorData = (error as { data: unknown }).data;

	if (
		errorData &&
		typeof errorData === "object" &&
		"details" in errorData &&
		typeof (errorData as { details: unknown }).details === "string" &&
		(errorData as { details: string }).details.includes("empty response text")
	) {
		return true;
	}

	return false;
}

/**
 * Retry sending message after authentication.
 */
async function retryWithAuthentication(
	sessionId: string,
	agentMessage: string,
	displayMessage: string,
	authMethodId: string,
	agentClient: IAgentClient,
): Promise<SendMessageResult | null> {
	try {
		const authSuccess = await agentClient.authenticate(authMethodId);

		if (!authSuccess) {
			return null;
		}

		await agentClient.sendMessage(sessionId, agentMessage);

		return {
			success: true,
			displayMessage,
			agentMessage,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		return {
			success: false,
			displayMessage,
			agentMessage,
			error: {
				id: crypto.randomUUID(),
				category: "communication",
				severity: "error",
				title: "Message Send Failed",
				message: `Failed to send message after authentication: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
				suggestion: "Please try again or check your connection.",
				occurredAt: new Date(),
				sessionId,
				originalError: retryError,
			},
		};
	}
}
