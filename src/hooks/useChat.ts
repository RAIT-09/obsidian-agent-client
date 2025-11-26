import { useState, useCallback, useMemo } from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../domain/models/chat-message";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { IVaultAccess } from "../domain/ports/vault-access.port";
import type { NoteMetadata } from "../domain/ports/vault-access.port";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import type { ErrorInfo } from "../domain/models/agent-error";
import type { IMentionService } from "../shared/mention-utils";
import { prepareMessage, sendPreparedMessage } from "../shared/message-service";
import { Platform } from "obsidian";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;
	/** Vault base path for mention resolution */
	vaultBasePath: string;
	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;
}

/**
 * Return type for useChat hook.
 */
export interface UseChatReturn {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Last user message (can be restored after cancel) */
	lastUserMessage: string | null;
	/** Error information from message operations */
	errorInfo: ErrorInfo | null;

	/**
	 * Send a message to the agent.
	 * @param content - Message content
	 * @param options - Message options (activeNote, vaultBasePath, etc.)
	 */
	sendMessage: (
		content: string,
		options: SendMessageOptions,
	) => Promise<void>;

	/**
	 * Clear all messages (e.g., when starting a new session).
	 */
	clearMessages: () => void;

	/**
	 * Clear the current error.
	 */
	clearError: () => void;

	/**
	 * Callback to add a new message.
	 * Used by AcpAdapter when receiving agent messages.
	 */
	addMessage: (message: ChatMessage) => void;

	/**
	 * Callback to update the last message content.
	 * Used by AcpAdapter for streaming text updates.
	 */
	updateLastMessage: (content: MessageContent) => void;

	/**
	 * Callback to update a specific message by tool call ID.
	 * Used by AcpAdapter for tool call status updates.
	 * @returns True if the message was found and updated
	 */
	updateMessage: (toolCallId: string, content: MessageContent) => boolean;
}

/**
 * Session context required for sending messages.
 */
export interface SessionContext {
	sessionId: string | null;
	authMethods: AuthenticationMethod[];
}

/**
 * Settings context required for message preparation.
 */
export interface SettingsContext {
	windowsWslMode: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing chat messages and message sending.
 *
 * This hook owns:
 * - Message history (messages array)
 * - Sending state (isSending flag)
 * - Message operations (send, add, update)
 *
 * It provides callbacks (addMessage, updateLastMessage, updateMessage) that
 * should be passed to AcpAdapter.setMessageCallbacks() for receiving
 * agent responses.
 *
 * @param agentClient - Agent client for sending messages
 * @param vaultAccess - Vault access for reading notes
 * @param mentionService - Mention service for parsing mentions
 * @param sessionContext - Session information (sessionId, authMethods)
 * @param settingsContext - Settings information (windowsWslMode)
 */
export function useChat(
	agentClient: IAgentClient,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
	sessionContext: SessionContext,
	settingsContext: SettingsContext,
): UseChatReturn {
	// Message state
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	/**
	 * Add a new message to the chat.
	 */
	const addMessage = useCallback((message: ChatMessage): void => {
		setMessages((prev) => [...prev, message]);
	}, []);

	/**
	 * Update the last message in the chat.
	 * Creates a new assistant message if needed.
	 */
	const updateLastMessage = useCallback((content: MessageContent): void => {
		setMessages((prev) => {
			// If no messages or last message is not assistant, create new assistant message
			if (
				prev.length === 0 ||
				prev[prev.length - 1].role !== "assistant"
			) {
				const newMessage: ChatMessage = {
					id: crypto.randomUUID(),
					role: "assistant",
					content: [content],
					timestamp: new Date(),
				};
				return [...prev, newMessage];
			}

			// Update existing last message
			const lastMessage = prev[prev.length - 1];
			const updatedMessage = { ...lastMessage };

			if (content.type === "text" || content.type === "agent_thought") {
				// Append to existing content of same type or create new content
				const existingContentIndex = updatedMessage.content.findIndex(
					(c) => c.type === content.type,
				);
				if (existingContentIndex >= 0) {
					const existingContent =
						updatedMessage.content[existingContentIndex];
					// Type guard: we know it's text or agent_thought from findIndex condition
					if (
						existingContent.type === "text" ||
						existingContent.type === "agent_thought"
					) {
						updatedMessage.content[existingContentIndex] = {
							type: content.type,
							text:
								existingContent.text +
								(content.type === "agent_thought" ? "\n" : "") +
								content.text,
						};
					}
				} else {
					updatedMessage.content.push(content);
				}
			} else {
				// Replace or add non-text content
				const existingIndex = updatedMessage.content.findIndex(
					(c) => c.type === content.type,
				);

				if (existingIndex >= 0) {
					updatedMessage.content[existingIndex] = content;
				} else {
					updatedMessage.content.push(content);
				}
			}

			return [...prev.slice(0, -1), updatedMessage];
		});
	}, []);

	/**
	 * Update a specific message by tool call ID.
	 */
	const updateMessage = useCallback(
		(toolCallId: string, content: MessageContent): boolean => {
			let found = false;

			setMessages((prev) => {
				const updatedMessages = prev.map((message) => ({
					...message,
					content: message.content.map((c) => {
						if (
							c.type === "tool_call" &&
							c.toolCallId === toolCallId &&
							content.type === "tool_call"
						) {
							found = true;
							// Merge content arrays
							let mergedContent = c.content || [];
							if (content.content !== undefined) {
								const newContent = content.content || [];

								// If new content contains diff, replace all old diffs
								const hasDiff = newContent.some(
									(item) => item.type === "diff",
								);
								if (hasDiff) {
									mergedContent = mergedContent.filter(
										(item) => item.type !== "diff",
									);
								}

								mergedContent = [
									...mergedContent,
									...newContent,
								];
							}

							return {
								...c,
								toolCallId: content.toolCallId,
								title:
									content.title !== undefined
										? content.title
										: c.title,
								kind:
									content.kind !== undefined
										? content.kind
										: c.kind,
								status:
									content.status !== undefined
										? content.status
										: c.status,
								content: mergedContent,
								permissionRequest:
									content.permissionRequest !== undefined
										? content.permissionRequest
										: c.permissionRequest,
							};
						}
						return c;
					}),
				}));

				return found ? updatedMessages : prev;
			});

			return found;
		},
		[],
	);

	/**
	 * Clear all messages.
	 */
	const clearMessages = useCallback((): void => {
		setMessages([]);
		setLastUserMessage(null);
		setIsSending(false);
		setErrorInfo(null);
	}, []);

	/**
	 * Clear the current error.
	 */
	const clearError = useCallback((): void => {
		setErrorInfo(null);
	}, []);

	/**
	 * Check if paths should be converted to WSL format.
	 */
	const shouldConvertToWsl = useMemo(() => {
		return Platform.isWin && settingsContext.windowsWslMode;
	}, [settingsContext.windowsWslMode]);

	/**
	 * Send a message to the agent.
	 */
	const sendMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			// Guard: Need session ID to send
			if (!sessionContext.sessionId) {
				setErrorInfo({
					title: "Cannot Send Message",
					message: "No active session. Please wait for connection.",
				});
				return;
			}

			// Phase 1: Prepare message using message-service
			const prepared = await prepareMessage(
				{
					message: content,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
				},
				vaultAccess,
				mentionService,
			);

			// Phase 2: Add user message to UI immediately
			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: prepared.autoMentionContext
					? [
							{
								type: "text_with_context",
								text: prepared.displayMessage,
								autoMentionContext: prepared.autoMentionContext,
							},
						]
					: [
							{
								type: "text",
								text: prepared.displayMessage,
							},
						],
				timestamp: new Date(),
			};
			addMessage(userMessage);

			// Phase 3: Set sending state and store original message
			setIsSending(true);
			setLastUserMessage(content);

			// Phase 4: Send prepared message to agent using message-service
			try {
				const result = await sendPreparedMessage(
					{
						sessionId: sessionContext.sessionId,
						agentMessage: prepared.agentMessage,
						displayMessage: prepared.displayMessage,
						authMethods: sessionContext.authMethods,
					},
					agentClient,
				);

				if (result.success) {
					// Success - clear stored message
					setIsSending(false);
					setLastUserMessage(null);
				} else {
					// Error from message-service
					setIsSending(false);
					setErrorInfo(
						result.error
							? {
									title: result.error.title,
									message: result.error.message,
									suggestion: result.error.suggestion,
								}
							: {
									title: "Send Message Failed",
									message: "Failed to send message",
								},
					);
				}
			} catch (error) {
				// Unexpected error
				setIsSending(false);
				setErrorInfo({
					title: "Send Message Failed",
					message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[
			agentClient,
			vaultAccess,
			mentionService,
			sessionContext.sessionId,
			sessionContext.authMethods,
			shouldConvertToWsl,
			addMessage,
		],
	);

	return {
		messages,
		isSending,
		lastUserMessage,
		errorInfo,
		sendMessage,
		clearMessages,
		clearError,
		addMessage,
		updateLastMessage,
		updateMessage,
	};
}
