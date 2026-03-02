import { useCallback, useMemo, useReducer } from "react";
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
import { chatReducer } from "./state/chat.reducer";
import { createInitialChatState, type ChatAction } from "./state/chat.actions";

type ToolCallMessageContent = Extract<MessageContent, { type: "tool_call" }>;

export interface SendMessageOptions {
	activeNote: NoteMetadata | null;
	vaultBasePath: string;
	isAutoMentionDisabled?: boolean;
	images?: ImagePromptContent[];
}

export interface UseChatReturn {
	messages: ChatMessage[];
	isSending: boolean;
	lastUserMessage: string | null;
	errorInfo: ErrorInfo | null;

	sendMessage: (content: string, options: SendMessageOptions) => Promise<void>;

	clearMessages: () => void;

	setInitialMessages: (
		history: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	) => void;

	setMessagesFromLocal: (localMessages: ChatMessage[]) => void;

	clearError: () => void;

	addMessage: (message: ChatMessage) => void;

	updateLastMessage: (content: MessageContent) => void;

	updateMessage: (toolCallId: string, content: MessageContent) => void;

	upsertToolCall: (toolCallId: string, content: MessageContent) => void;

	handleSessionUpdate: (update: SessionUpdate) => void;
}

export interface SessionContext {
	sessionId: string | null;
	authMethods: AuthenticationMethod[];
	promptCapabilities?: {
		image?: boolean;
		audio?: boolean;
		embeddedContext?: boolean;
	};
}

export interface SettingsContext {
	windowsWslMode: boolean;
	maxNoteLength: number;
	maxSelectionLength: number;
}

function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	let mergedContent = existing.content || [];
	if (update.content !== undefined) {
		const newContent = update.content || [];

		const hasDiff = newContent.some((item) => item.type === "diff");
		if (hasDiff) {
			mergedContent = mergedContent.filter((item) => item.type !== "diff");
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
			update.locations !== undefined ? update.locations : existing.locations,
		rawInput:
			update.rawInput !== undefined && Object.keys(update.rawInput).length > 0
				? update.rawInput
				: existing.rawInput,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
}

export function useChat(
	agentClient: IAgentClient,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
	sessionContext: SessionContext,
	settingsContext: SettingsContext,
): UseChatReturn {
	const [state, dispatch] = useReducer(
		chatReducer,
		undefined,
		createInitialChatState,
	);

	const applyMessageUpdater = useCallback(
		(updater: (messages: ChatMessage[]) => ChatMessage[]) => {
			dispatch({
				type: "apply_messages",
				updater,
			});
		},
		[],
	);

	const addMessage = useCallback(
		(message: ChatMessage): void => {
			applyMessageUpdater((prev) => [...prev, message]);
		},
		[applyMessageUpdater],
	);

	const updateLastMessage = useCallback(
		(content: MessageContent): void => {
			applyMessageUpdater((prev) => {
				if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
					const newMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: "assistant",
						content: [content],
						timestamp: new Date(),
					};
					return [...prev, newMessage];
				}

				const lastMessage = prev[prev.length - 1];
				const updatedMessage = { ...lastMessage };

				if (content.type === "text" || content.type === "agent_thought") {
					const existingContentIndex = updatedMessage.content.findIndex(
						(c) => c.type === content.type,
					);
					if (existingContentIndex >= 0) {
						const existingContent =
							updatedMessage.content[existingContentIndex];
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
		},
		[applyMessageUpdater],
	);

	const updateUserMessage = useCallback(
		(content: MessageContent): void => {
			applyMessageUpdater((prev) => {
				if (prev.length === 0 || prev[prev.length - 1].role !== "user") {
					const newMessage: ChatMessage = {
						id: crypto.randomUUID(),
						role: "user",
						content: [content],
						timestamp: new Date(),
					};
					return [...prev, newMessage];
				}

				const lastMessage = prev[prev.length - 1];
				const updatedMessage = { ...lastMessage };

				if (content.type === "text") {
					const existingContentIndex = updatedMessage.content.findIndex(
						(c) => c.type === "text",
					);
					if (existingContentIndex >= 0) {
						const existingContent =
							updatedMessage.content[existingContentIndex];
						if (existingContent.type === "text") {
							updatedMessage.content[existingContentIndex] = {
								type: "text",
								text: existingContent.text + content.text,
							};
						}
					} else {
						updatedMessage.content.push(content);
					}
				} else {
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
		},
		[applyMessageUpdater],
	);

	const updateMessage = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;

			applyMessageUpdater((prev) =>
				prev.map((message) => ({
					...message,
					content: message.content.map((c) => {
						if (c.type === "tool_call" && c.toolCallId === toolCallId) {
							return mergeToolCallContent(c, content);
						}
						return c;
					}),
				})),
			);
		},
		[applyMessageUpdater],
	);

	const upsertToolCall = useCallback(
		(toolCallId: string, content: MessageContent): void => {
			if (content.type !== "tool_call") return;

			applyMessageUpdater((prev) => {
				let found = false;
				const updated = prev.map((message) => ({
					...message,
					content: message.content.map((c) => {
						if (c.type === "tool_call" && c.toolCallId === toolCallId) {
							found = true;
							return mergeToolCallContent(c, content);
						}
						return c;
					}),
				}));

				if (found) {
					return updated;
				}

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
		[applyMessageUpdater],
	);

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

				case "user_message_chunk":
					updateUserMessage({
						type: "text",
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
						rawInput: update.rawInput,
						permissionRequest: update.permissionRequest,
					});
					break;

				case "plan":
					updateLastMessage({
						type: "plan",
						entries: update.entries,
					});
					break;

				case "available_commands_update":
				case "current_mode_update":
				case "usage_update":
					break;

				default: {
					const exhaustiveCheck: never = update;
					return exhaustiveCheck;
				}
			}
		},
		[updateLastMessage, upsertToolCall],
	);

	const clearMessages = useCallback((): void => {
		const actions: ChatAction[] = [
			{ type: "clear_messages" },
			{ type: "set_last_user_message", message: null },
			{ type: "send_complete" },
			{ type: "clear_error" },
		];
		for (const action of actions) {
			dispatch(action);
		}
	}, []);

	const setInitialMessages = useCallback(
		(
			history: Array<{
				role: string;
				content: Array<{ type: string; text: string }>;
				timestamp?: string;
			}>,
		): void => {
			const chatMessages: ChatMessage[] = history.map((msg) => ({
				id: crypto.randomUUID(),
				role: msg.role as "user" | "assistant",
				content: msg.content.map((c) => ({
					type: c.type as "text",
					text: c.text,
				})),
				timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
			}));

			dispatch({ type: "set_messages", messages: chatMessages });
			dispatch({ type: "send_complete" });
			dispatch({ type: "clear_error" });
		},
		[],
	);

	const setMessagesFromLocal = useCallback(
		(localMessages: ChatMessage[]): void => {
			dispatch({ type: "set_messages", messages: localMessages });
			dispatch({ type: "send_complete" });
			dispatch({ type: "clear_error" });
		},
		[],
	);

	const clearError = useCallback((): void => {
		dispatch({ type: "clear_error" });
	}, []);

	const shouldConvertToWsl = useMemo(() => {
		return Platform.isWin && settingsContext.windowsWslMode;
	}, [settingsContext.windowsWslMode]);

	const sendMessage = useCallback(
		async (content: string, options: SendMessageOptions): Promise<void> => {
			if (!sessionContext.sessionId) {
				dispatch({
					type: "set_error",
					error: {
						title: "Cannot send message",
						message: "No active session. Please wait for connection.",
					},
				});
				return;
			}

			const prepared = await preparePrompt(
				{
					message: content,
					images: options.images,
					activeNote: options.activeNote,
					vaultBasePath: options.vaultBasePath,
					isAutoMentionDisabled: options.isAutoMentionDisabled,
					convertToWsl: shouldConvertToWsl,
					supportsEmbeddedContext:
						sessionContext.promptCapabilities?.embeddedContext ?? false,
					supportsImage: sessionContext.promptCapabilities?.image ?? false,
					maxNoteLength: settingsContext.maxNoteLength,
					maxSelectionLength: settingsContext.maxSelectionLength,
				},
				vaultAccess,
				mentionService,
			);

			const originalInputText = content;

			const userMessageContent: MessageContent[] = [];

			if (prepared.autoMentionContext) {
				userMessageContent.push({
					type: "text_with_context",
					text: originalInputText,
					autoMentionContext: prepared.autoMentionContext,
				});
			} else {
				userMessageContent.push({
					type: "text",
					text: originalInputText,
				});
			}

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

			dispatch({ type: "send_start" });
			dispatch({ type: "set_last_user_message", message: content });

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
					dispatch({ type: "send_complete" });
					dispatch({
						type: "set_last_user_message",
						message: null,
					});
				} else {
					dispatch({ type: "send_complete" });
					dispatch({
						type: "set_error",
						error: result.error
							? {
									title: result.error.title,
									message: result.error.message,
									suggestion: result.error.suggestion,
								}
							: {
									title: "Send message failed",
									message: "Failed to send message",
								},
					});
				}
			} catch (error) {
				dispatch({ type: "send_complete" });
				dispatch({
					type: "set_error",
					error: {
						title: "Send message failed",
						message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
					},
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
		messages: state.messages,
		isSending: state.isSending,
		lastUserMessage: state.lastUserMessage,
		errorInfo: state.errorInfo,
		sendMessage,
		clearMessages,
		setInitialMessages,
		setMessagesFromLocal,
		clearError,
		addMessage,
		updateLastMessage,
		updateMessage,
		upsertToolCall,
		handleSessionUpdate,
	};
}
