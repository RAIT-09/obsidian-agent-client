import { useState, useCallback, useMemo } from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../domain/models/chat-message";
import type { SessionUpdate } from "../domain/models/session-update";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { IVaultAccess } from "../domain/ports/vault-access.port";
import type { NoteMetadata } from "../domain/ports/vault-access.port";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import type { ErrorInfo } from "../domain/models/agent-error";
import type { ImagePromptContent } from "../domain/models/prompt-content";
import type { IMentionService } from "../shared/mention-utils";
import { preparePrompt, sendPreparedPrompt } from "../shared/message-service";
import { Platform } from "obsidian";

// ============================================================================
// Types
// ============================================================================

/** Tool call content type extracted for type safety */
type ToolCallMessageContent = Extract<MessageContent, { type: "tool_call" }>;

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
	/** Attached images */
	images?: ImagePromptContent[];
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
	 * Set initial messages from loaded session history.
	 * Converts conversation history to ChatMessage format.
	 * @param history - Conversation history from loadSession
	 */
	setInitialMessages: (
		history: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	) => void;

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
	 */
	updateMessage: (toolCallId: string, content: MessageContent) => void;

	/**
	 * Callback to upsert a tool call message.
	 * If a tool call with the given ID exists, it will be updated.
	 * Otherwise, a new message will be created.
	 * Used by AcpAdapter for tool_call and tool_call_update events.
	 */
	upsertToolCall: (toolCallId: string, content: MessageContent) => void;

	/**
	 * Handle a session update from the agent.
	 * This is the unified handler for all session update events.
	 * Should be registered with agentClient.onSessionUpdate().
	 */
	handleSessionUpdate: (update: SessionUpdate) => void;
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
// Helper Functions
// ============================================================================

/**
 * Merge new tool call content into existing tool call.
 * Preserves existing values when new values are undefined.
 */
function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	// Merge content arrays
	let mergedContent = existing.content || [];
	if (update.content !== undefined) {
		const newContent = update.content || [];

		// If new content contains diff, replace all old diffs
		const hasDiff = newContent.some((item) => item.type === "diff");
		if (hasDiff) {
			mergedContent = mergedContent.filter(
				(item) => item.type !== "diff",
			);
		}

		mergedContent = [...mergedContent, ...newContent];
	}

	return {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		status: update.status !== undefined ? update.status : existing.status,
		content: mergedContent,
		locations:
			update.locations !== undefined
				? update.locations
				: existing.locations,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
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
							text: existingContent.text + content.text,
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
	 * Only updates if the tool call exists in state.
	 */
	const updateMessage = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;

			setMessages((prev) =>
				prev.map((message) => ({
					...message,
					content: message.content.map((c) => {
						if (
							c.type === "tool_call" &&
							c.toolCallId === toolCallId
						) {
							return mergeToolCallContent(c, content);
						}
						return c;
					}),
				})),
			);
		},
		[],
	);

	/**
	 * Upsert a tool call message.
	 * If a tool call with the given ID exists, it will be updated (merged).
	 * Otherwise, a new assistant message will be created.
	 * All logic is inside setMessages callback to avoid race conditions.
	 */
	const upsertToolCall = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;

			setMessages((prev) => {
				// Try to find existing tool call
				let found = false;
				const updated = prev.map((message) => ({
					...message,
					content: message.content.map((c) => {
						if (
							c.type === "tool_call" &&
							c.toolCallId === toolCallId
						) {
							found = true;
							return mergeToolCallContent(c, content);
						}
						return c;
					}),
				}));

				if (found) {
					return updated;
				}

				// Not found - create new message
				return [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant" as const,
						content: [content],
						timestamp: new Date(),
					},
				];
			});
		},
		[],
	);

	/**
	 * Handle a session update from the agent.
	 * This is the unified handler for all session update events.
	 *
	 * Note: available_commands_update and current_mode_update are not handled here
	 * as they are session-level updates, not message-level updates.
	 * They should be handled by useAgentSession.
	 */
	const handleSessionUpdate = useCallback(
		(update: SessionUpdate): void => {
			switch (update.type) {
				case "agent_message_chunk":
					updateLastMessage({
						type: "text",
						text: update.text,
					});
					break;

				case "agent_thought_chunk":
					updateLastMessage({
						type: "agent_thought",
						text: update.text,
					});
					break;

				case "tool_call":
				case "tool_call_update":
					upsertToolCall(update.toolCallId, {
						type: "tool_call",
						toolCallId: update.toolCallId,
						title: update.title,
						status: update.status || "pending",
						kind: update.kind,
						content: update.content,
						locations: update.locations,
						permissionRequest: update.permissionRequest,
					});
					break;

				case "plan":
					updateLastMessage({
						type: "plan",
						entries: update.entries,
					});
					break;

				// Session-level updates are handled elsewhere (useAgentSession)
				case "available_commands_update":
				case "current_mode_update":
					// These are intentionally not handled here
					break;
			}
		},
		[updateLastMessage, upsertToolCall],
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
	 * Set initial messages from loaded session history.
	 * Converts conversation history to ChatMessage format.
	 */
	const setInitialMessages = useCallback(
		(
			history: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp?: string;
			}>,
		): void => {
			// Convert conversation history to ChatMessage format
			const chatMessages: ChatMessage[] = history.map((msg) => ({
				id: crypto.randomUUID(),
				role: msg.role as "user" | "assistant",
				content: msg.content.map((c) => ({
					type: c.type as "text",
					text: c.text,
				})),
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
			}));

			setMessages(chatMessages);
			setIsSending(false);
			setErrorInfo(null);
		},
		[],
	);

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

			// Phase 1: Prepare prompt using message-service
			const prepared = await preparePrompt(
				{
					message: content,
					images: options.images,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
				},
				vaultAccess,
				mentionService,
			);

			// Phase 2: Build user message for UI
			const userMessageContent: MessageContent[] = [];

			// Text part (with or without auto-mention context)
			if (prepared.autoMentionContext) {
				userMessageContent.push({
					type: "text_with_context",
					text: content,
					autoMentionContext: prepared.autoMentionContext,
				});
			} else {
				userMessageContent.push({
					type: "text",
					text: content,
				});
			}

			// Image parts
			if (options.images && options.images.length > 0) {
				for (const img of options.images) {
					userMessageContent.push({
						type: "image",
						data: img.data,
						mimeType: img.mimeType,
					});
				}
			}

			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: userMessageContent,
				timestamp: new Date(),
			};
			addMessage(userMessage);

			// Phase 3: Set sending state and store original message
			setIsSending(true);
			setLastUserMessage(content);

			// Phase 4: Send prepared prompt to agent using message-service
			try {
				const result = await sendPreparedPrompt(
					{
						sessionId: sessionContext.sessionId,
						agentContent: prepared.agentContent,
						displayContent: prepared.displayContent,
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
		setInitialMessages,
		clearError,
		addMessage,
		updateLastMessage,
		updateMessage,
		upsertToolCall,
		handleSessionUpdate,
	};
}
