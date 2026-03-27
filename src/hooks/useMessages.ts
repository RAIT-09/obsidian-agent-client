import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import type { SessionUpdate, AuthenticationMethod } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { IVaultAccess, NoteMetadata } from "../services/vault-service";
import type { ErrorInfo } from "../types/errors";
import type { IMentionService } from "../utils/mention-parser";
import { preparePrompt, sendPreparedPrompt } from "../services/message-sender";
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
	/** Attached images (Base64 embedded) */
	images?: ImagePromptContent[];
	/** Attached file references (resource links) */
	resourceLinks?: ResourceLinkPromptContent[];
}

/**
 * Return type for useMessages hook.
 */
export interface UseMessagesReturn {
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
	 * Set messages directly from local storage.
	 * Unlike setInitialMessages which converts from ACP history format,
	 * this accepts ChatMessage[] as-is (for resume/fork operations).
	 * @param localMessages - Chat messages from local storage
	 */
	setMessagesFromLocal: (localMessages: ChatMessage[]) => void;

	/**
	 * Clear the current error.
	 */
	clearError: () => void;

	/**
	 * Callback to add a new message.
	 * Used by AcpClient when receiving agent messages.
	 */
	addMessage: (message: ChatMessage) => void;

	/**
	 * Callback to update the last message content.
	 * Used by AcpClient for streaming text updates.
	 */
	updateLastMessage: (content: MessageContent) => void;

	/**
	 * Callback to upsert a tool call message.
	 * If a tool call with the given ID exists, it will be updated.
	 * Otherwise, a new message will be created.
	 * Used by AcpClient for tool_call and tool_call_update events.
	 */
	upsertToolCall: (toolCallId: string, content: MessageContent) => void;

	/**
	 * Set whether to ignore incoming updates.
	 * Used during session/load to skip history replay messages.
	 */
	setIgnoreUpdates: (ignore: boolean) => void;

	// Permission state and operations (integrated from usePermission)

	/** Currently active permission request (if any) */
	activePermission: ActivePermission | null;
	/** Whether there is an active permission request */
	hasActivePermission: boolean;
	/** Approve a specific permission request with the given option */
	approvePermission: (requestId: string, optionId: string) => Promise<void>;
	/** Approve the currently active permission (for hotkey handling) */
	approveActivePermission: () => Promise<boolean>;
	/** Reject the currently active permission (for hotkey handling) */
	rejectActivePermission: () => Promise<boolean>;
}

/**
 * Session context required for sending messages.
 */
export interface SessionContext {
	sessionId: string | null;
	authMethods: AuthenticationMethod[];
	/** Prompt capabilities from agent initialization */
	promptCapabilities?: {
		image?: boolean;
		audio?: boolean;
		embeddedContext?: boolean;
	};
}

/**
 * Settings context required for message preparation.
 */
export interface SettingsContext {
	windowsWslMode: boolean;
	maxNoteLength: number;
	maxSelectionLength: number;
}

import {
	type ToolCallMessageContent,
	mergeToolCallContent,
	applyUpdateLastMessage,
	applyUpsertToolCall,
	rebuildToolCallIndex,
	applySingleUpdate,
	findActivePermission,
	selectOption,
} from "../services/message-state";

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
 * It provides callbacks (addMessage, updateLastMessage, upsertToolCall) that
 * should be passed to AcpClient.setMessageCallbacks() for receiving
 * agent responses.
 *
 * @param agentClient - Agent client for sending messages
 * @param vaultAccess - Vault access for reading notes
 * @param mentionService - Mention service for parsing mentions
 * @param sessionContext - Session information (sessionId, authMethods)
 * @param settingsContext - Settings information (windowsWslMode)
 */
export function useMessages(
	agentClient: AcpClient,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
	sessionContext: SessionContext,
	settingsContext: SettingsContext,
): UseMessagesReturn {
	// Message state
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	// Tool call index: toolCallId → message index for O(1) lookup
	const toolCallIndexRef = useRef<Map<string, number>>(new Map());

	// Ignore updates flag (used during session/load to skip history replay)
	const ignoreUpdatesRef = useRef(false);

	// ============================================================
	// Streaming update batching
	// ============================================================
	// Buffer updates and flush on requestAnimationFrame to reduce
	// React re-renders from per-chunk to per-frame (~60fps).
	const pendingUpdatesRef = useRef<SessionUpdate[]>([]);
	const flushScheduledRef = useRef(false);

	const flushPendingUpdates = useCallback(() => {
		flushScheduledRef.current = false;
		const updates = pendingUpdatesRef.current;
		if (updates.length === 0) return;
		pendingUpdatesRef.current = [];

		setMessages((prev) => {
			let result = prev;
			for (const update of updates) {
				result = applySingleUpdate(result, update, toolCallIndexRef.current);
			}
			return result;
		});
	}, []);

	const enqueueUpdate = useCallback(
		(update: SessionUpdate) => {
			pendingUpdatesRef.current.push(update);
			if (!flushScheduledRef.current) {
				flushScheduledRef.current = true;
				requestAnimationFrame(flushPendingUpdates);
			}
		},
		[flushPendingUpdates],
	);

	// Clean up on unmount — drop any pending updates
	useEffect(() => {
		return () => {
			pendingUpdatesRef.current = [];
			flushScheduledRef.current = false;
			toolCallIndexRef.current.clear();
		};
	}, []);

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
		setMessages((prev) => applyUpdateLastMessage(prev, content));
	}, []);

	/**
	 * Upsert a tool call message.
	 * If a tool call with the given ID exists, it will be updated (merged).
	 * Otherwise, a new assistant message will be created.
	 * All logic is inside setMessages callback to avoid race conditions.
	 */
	const upsertToolCall = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;
			setMessages((prev) => applyUpsertToolCall(prev, content, toolCallIndexRef.current));
		},
		[],
	);

	/**
	 * Handle a session update from the agent.
	 * Updates are batched via requestAnimationFrame for performance.
	 * Session-level updates (commands, mode, config, usage) are no-ops
	 * and are handled by useSession independently.
	 */
	const handleSessionUpdate = useCallback(
		(update: SessionUpdate): void => {
			if (ignoreUpdatesRef.current) return;
			enqueueUpdate(update);
		},
		[enqueueUpdate],
	);

	// Subscribe to message-level updates from agent
	useEffect(() => {
		const unsubscribe = agentClient.onSessionUpdate(handleSessionUpdate);
		return unsubscribe;
	}, [agentClient, handleSessionUpdate]);

	/**
	 * Set whether to ignore incoming updates (used during session/load history replay).
	 */
	const setIgnoreUpdates = useCallback((ignore: boolean): void => {
		ignoreUpdatesRef.current = ignore;
	}, []);

	// ============================================================
	// Permission State & Operations
	// ============================================================

	const activePermission = useMemo(
		() => findActivePermission(messages),
		[messages],
	);

	const hasActivePermission = activePermission !== null;

	const approvePermission = useCallback(
		async (requestId: string, optionId: string): Promise<void> => {
			try {
				await agentClient.respondToPermission(requestId, optionId);
			} catch (error) {
				setErrorInfo({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[agentClient],
	);

	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0) return false;
		const option = selectOption(activePermission.options, ["allow_once", "allow_always"]);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0) return false;
		const option = selectOption(
			activePermission.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);
		if (!option) return false;
		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	/**
	 * Clear all messages.
	 */
	const clearMessages = useCallback((): void => {
		setMessages([]);
		toolCallIndexRef.current.clear();
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
			rebuildToolCallIndex(chatMessages, toolCallIndexRef.current);
			setIsSending(false);
			setErrorInfo(null);
		},
		[],
	);

	/**
	 * Set messages directly from local storage.
	 * Unlike setInitialMessages which converts from ACP history format,
	 * this accepts ChatMessage[] as-is (for resume/fork operations).
	 */
	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			setMessages(localMessages);
			rebuildToolCallIndex(localMessages, toolCallIndexRef.current);
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
					resourceLinks: options.resourceLinks,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
					supportsEmbeddedContext:
						sessionContext.promptCapabilities?.embeddedContext ??
						false,
					maxNoteLength: settingsContext.maxNoteLength,
					maxSelectionLength: settingsContext.maxSelectionLength,
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

			// Resource link parts
			if (options.resourceLinks && options.resourceLinks.length > 0) {
				for (const link of options.resourceLinks) {
					userMessageContent.push({
						type: "resource_link",
						uri: link.uri,
						name: link.name,
						mimeType: link.mimeType,
						size: link.size,
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
			sessionContext.promptCapabilities,
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
		setMessagesFromLocal,
		clearError,
		addMessage,
		updateLastMessage,
		upsertToolCall,
		setIgnoreUpdates,
		activePermission,
		hasActivePermission,
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
	};
}
