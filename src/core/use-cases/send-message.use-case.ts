/**
 * Send Message Use Case
 *
 * Handles the business logic for sending user messages to AI agents.
 * Responsibilities:
 * - Process mentions (@[[note]] syntax)
 * - Add auto-mention for active note
 * - Convert mentions to file paths
 * - Send message to agent via IAgentClient
 * - Handle authentication errors with retry logic
 */

import type { IAgentClient } from "../domain/ports/agent-client.port";
import type {
	IVaultAccess,
	NoteMetadata,
} from "../domain/ports/vault-access.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type { AgentError } from "../domain/models/agent-error";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import {
	buildAutoMentionContext,
	extractMentionedNotes,
	type IMentionService,
} from "../../shared/mention-utils";
import { convertWindowsPathToWsl } from "../../shared/wsl-utils";

// ============================================================================
// Input/Output Types
// ============================================================================

/**
 * Input for preparing a message (Phase 1: synchronous)
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
 * Input for sending a prepared message (Phase 2: asynchronous)
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
 * Input for sending a message (legacy: single-phase)
 */
export interface SendMessageInput {
	/** Current session ID */
	sessionId: string;

	/** User's message text (may contain @mentions) */
	message: string;

	/** Currently active note (for auto-mention feature) */
	activeNote?: NoteMetadata | null;

	/** Vault base path for converting mentions to absolute paths */
	vaultBasePath: string;

	/** Available authentication methods */
	authMethods: AuthenticationMethod[];

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;

	/** Whether to convert paths to WSL format (Windows + WSL mode) */
	convertToWsl?: boolean;
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
// Use Case Implementation
// ============================================================================

export class SendMessageUseCase {
	constructor(
		private agentClient: IAgentClient,
		private vaultAccess: IVaultAccess,
		private settingsAccess: ISettingsAccess,
		private mentionService: IMentionService,
	) {}

	/**
	 * Phase 1: Prepare message (asynchronous)
	 *
	 * Processes the message by:
	 * - Adding auto-mention if enabled (for display only)
	 * - Converting @mentions to context blocks with note content (for agent)
	 * - Building context from active note (for agent only)
	 *
	 * Note: This is now asynchronous to read note content for mentions.
	 */
	async prepareMessage(
		input: PrepareMessageInput,
	): Promise<PrepareMessageResult> {
		// Step 1: Extract all mentioned notes from the message
		const mentionedNotes = extractMentionedNotes(
			input.message,
			this.mentionService,
		);

		// Step 2: Build context blocks for each mentioned note
		const contextBlocks: string[] = [];
		const MAX_NOTE_LENGTH = 10000; // Maximum characters per note

		for (const { noteTitle, file } of mentionedNotes) {
			if (!file) {
				// File not found, skip
				continue;
			}

			try {
				// Read note content
				const content = await this.vaultAccess.readNote(file.path);

				// Truncate content if too long
				let processedContent = content;
				let truncationNote = "";

				if (content.length > MAX_NOTE_LENGTH) {
					processedContent = content.substring(0, MAX_NOTE_LENGTH);
					truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${MAX_NOTE_LENGTH} characters]`;
				}

				// Calculate absolute path
				let absolutePath = input.vaultBasePath
					? `${input.vaultBasePath}/${file.path}`
					: file.path;

				// Convert to WSL path format if requested
				if (input.convertToWsl) {
					absolutePath = convertWindowsPathToWsl(absolutePath);
				}

				// Build context block
				const contextBlock = `<obsidian_mentioned_note ref="${absolutePath}">\n${processedContent}${truncationNote}\n</obsidian_mentioned_note>`;
				contextBlocks.push(contextBlock);
			} catch (error) {
				// If reading fails, skip this note
				console.error(`Failed to read note ${file.path}:`, error);
			}
		}

		// Step 3: Build context from active note (for agent only, not shown in UI)
		if (input.activeNote && !input.isAutoMentionDisabled) {
			const autoMentionContext = buildAutoMentionContext(
				input.activeNote.path,
				input.vaultBasePath,
				input.convertToWsl ?? false,
				input.activeNote.selection, // Pass selection range
			);
			contextBlocks.push(autoMentionContext);
		}

		// Step 4: Build agent message (context blocks + original message with mentions)
		const agentMessage =
			contextBlocks.length > 0
				? contextBlocks.join("\n") + "\n\n" + input.message
				: input.message;

		// Step 5: Build auto-mention context metadata (not added to displayMessage text)
		const autoMentionContext =
			input.activeNote && !input.isAutoMentionDisabled
				? {
						noteName: input.activeNote.name,
						notePath: input.activeNote.path,
						selection: input.activeNote.selection
							? {
									fromLine:
										input.activeNote.selection.from.line +
										1,
									toLine:
										input.activeNote.selection.to.line + 1,
								}
							: undefined,
					}
				: undefined;

		return {
			displayMessage: input.message, // For UI: original message without modification
			agentMessage, // For agent: contains context blocks + clean message
			autoMentionContext, // For UI: metadata to render auto-mention badge
		};
	}

	/**
	 * Phase 2: Send prepared message (asynchronous)
	 *
	 * Sends the prepared message to the agent and handles errors.
	 * Call this after adding the user message to UI.
	 */
	async sendPreparedMessage(
		input: SendPreparedMessageInput,
	): Promise<SendMessageResult> {
		try {
			await this.agentClient.sendMessage(
				input.sessionId,
				input.agentMessage,
			);

			return {
				success: true,
				displayMessage: input.displayMessage,
				agentMessage: input.agentMessage,
			};
		} catch (error) {
			// Handle errors (including authentication retry)
			return await this.handleSendError(
				error,
				input.sessionId,
				input.agentMessage,
				input.displayMessage,
				input.authMethods,
			);
		}
	}

	/**
	 * Execute the send message use case (legacy: single-phase)
	 *
	 * This combines prepareMessage + sendPreparedMessage for backward compatibility.
	 */
	async execute(input: SendMessageInput): Promise<SendMessageResult> {
		// Step 1: Prepare message (now async)
		const { displayMessage, agentMessage } = await this.prepareMessage({
			message: input.message,
			activeNote: input.activeNote,
			vaultBasePath: input.vaultBasePath,
			isAutoMentionDisabled: input.isAutoMentionDisabled,
			convertToWsl: input.convertToWsl,
		});

		// Step 2: Send prepared message
		return await this.sendPreparedMessage({
			sessionId: input.sessionId,
			agentMessage,
			displayMessage,
			authMethods: input.authMethods,
		});
	}

	// ========================================================================
	// Private Helper Methods
	// ========================================================================

	/**
	 * Handle errors that occur during message sending
	 */
	private async handleSendError(
		error: unknown,
		sessionId: string,
		agentMessage: string,
		displayMessage: string,
		authMethods: AuthenticationMethod[],
	): Promise<SendMessageResult> {
		// Check for "empty response text" error - ignore silently
		if (this.isEmptyResponseError(error)) {
			return {
				success: true, // Treat as success to avoid showing error
				displayMessage,
				agentMessage,
			};
		}

		// Check if this is a rate limit error - don't retry with authentication
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
					message:
						"No authentication methods available for this agent.",
					suggestion:
						"Please check your agent configuration in settings.",
					occurredAt: new Date(),
					sessionId,
					originalError: error,
				},
			};
		}

		// Try automatic authentication retry if only one method available
		if (authMethods.length === 1) {
			const retryResult = await this.retryWithAuthentication(
				sessionId,
				agentMessage,
				displayMessage,
				authMethods[0].id,
			);

			if (retryResult) {
				return retryResult;
			}
		}

		// Multiple auth methods or retry failed - return error
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
	 * Check if error is the "empty response text" error that should be ignored
	 */
	private isEmptyResponseError(error: unknown): boolean {
		// Type guard for error objects with code and data properties
		if (!error || typeof error !== "object") {
			return false;
		}

		if (
			!("code" in error) ||
			(error as { code: unknown }).code !== -32603
		) {
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
			(errorData as { details: string }).details.includes(
				"empty response text",
			)
		) {
			return true;
		}

		return false;
	}

	/**
	 * Retry sending message after authentication
	 */
	private async retryWithAuthentication(
		sessionId: string,
		agentMessage: string,
		displayMessage: string,
		authMethodId: string,
	): Promise<SendMessageResult | null> {
		try {
			// Attempt authentication
			const authSuccess =
				await this.agentClient.authenticate(authMethodId);

			if (!authSuccess) {
				return null; // Authentication failed
			}

			// Retry sending the message
			await this.agentClient.sendMessage(sessionId, agentMessage);

			return {
				success: true,
				displayMessage,
				agentMessage,
				retriedSuccessfully: true,
			};
		} catch (retryError) {
			// Retry failed
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
}
