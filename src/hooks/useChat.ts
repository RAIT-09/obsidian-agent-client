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
import { preparePrompt, sendPreparedPrompt } from "../application/use-cases/prompt";
import { Platform } from "obsidian";
import { chatReducer } from "./state/chat.reducer";
import { createInitialChatState, type ChatAction } from "./state/chat.actions";
import { applySessionUpdateToMessages } from "./chat/message-updaters";

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

	const handleSessionUpdate = useCallback(
		(update: SessionUpdate): void => {
			applyMessageUpdater((messages) =>
				applySessionUpdateToMessages(messages, update),
			);
		},
		[applyMessageUpdater],
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
		handleSessionUpdate,
	};
}
