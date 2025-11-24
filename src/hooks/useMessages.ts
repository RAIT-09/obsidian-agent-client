/**
 * useMessages Hook
 *
 * Manages chat message state and provides message operations.
 * Replaces the message-related functionality from ChatViewModel.
 */

import { useCallback, useReducer } from "react";
import type { ChatMessage, MessageContent } from "../types";

// ============================================================================
// State
// ============================================================================

export interface MessagesState {
	/** All messages in the current chat session */
	messages: ChatMessage[];

	/** Last user message (for restore after cancel) */
	lastUserMessage: string | null;
}

// ============================================================================
// Actions
// ============================================================================

type MessagesAction =
	| { type: "ADD_MESSAGE"; message: ChatMessage }
	| { type: "UPDATE_LAST_MESSAGE"; content: MessageContent }
	| {
			type: "UPDATE_MESSAGE";
			toolCallId: string;
			content: MessageContent;
	  }
	| { type: "CLEAR_MESSAGES" }
	| { type: "SET_LAST_USER_MESSAGE"; message: string | null };

// ============================================================================
// Reducer
// ============================================================================

function messagesReducer(
	state: MessagesState,
	action: MessagesAction,
): MessagesState {
	switch (action.type) {
		case "ADD_MESSAGE":
			return {
				...state,
				messages: [...state.messages, action.message],
			};

		case "UPDATE_LAST_MESSAGE": {
			const { content } = action;

			// If no messages or last message is not assistant, create new assistant message
			if (
				state.messages.length === 0 ||
				state.messages[state.messages.length - 1].role !== "assistant"
			) {
				const newMessage: ChatMessage = {
					id: crypto.randomUUID(),
					role: "assistant",
					content: [content],
					timestamp: new Date(),
				};
				return {
					...state,
					messages: [...state.messages, newMessage],
				};
			}

			const lastMessage = state.messages[state.messages.length - 1];
			const updatedMessage = { ...lastMessage };

			if (content.type === "text" || content.type === "agent_thought") {
				// Append to existing content of same type or create new content
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

			return {
				...state,
				messages: [...state.messages.slice(0, -1), updatedMessage],
			};
		}

		case "UPDATE_MESSAGE": {
			const { toolCallId, content } = action;

			const updatedMessages = state.messages.map((message) => ({
				...message,
				content: message.content.map((c) => {
					if (
						c.type === "tool_call" &&
						c.toolCallId === toolCallId &&
						content.type === "tool_call"
					) {
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

							mergedContent = [...mergedContent, ...newContent];
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

			return {
				...state,
				messages: updatedMessages,
			};
		}

		case "CLEAR_MESSAGES":
			return {
				...state,
				messages: [],
				lastUserMessage: null,
			};

		case "SET_LAST_USER_MESSAGE":
			return {
				...state,
				lastUserMessage: action.message,
			};

		default:
			return state;
	}
}

// ============================================================================
// Hook
// ============================================================================

const initialState: MessagesState = {
	messages: [],
	lastUserMessage: null,
};

export function useMessages() {
	const [state, dispatch] = useReducer(messagesReducer, initialState);

	/**
	 * Add a new message to the chat.
	 */
	const addMessage = useCallback((message: ChatMessage) => {
		dispatch({ type: "ADD_MESSAGE", message });
	}, []);

	/**
	 * Update the last assistant message (for streaming).
	 */
	const updateLastMessage = useCallback((content: MessageContent) => {
		dispatch({ type: "UPDATE_LAST_MESSAGE", content });
	}, []);

	/**
	 * Update a specific message by tool call ID.
	 * Returns true if message was found (for compatibility with ChatViewModel).
	 */
	const updateMessage = useCallback(
		(toolCallId: string, content: MessageContent): boolean => {
			// Check if message exists before dispatching
			const exists = state.messages.some((msg) =>
				msg.content.some(
					(c) =>
						c.type === "tool_call" && c.toolCallId === toolCallId,
				),
			);

			if (exists) {
				dispatch({ type: "UPDATE_MESSAGE", toolCallId, content });
			}

			return exists;
		},
		[state.messages],
	);

	/**
	 * Clear all messages.
	 */
	const clearMessages = useCallback(() => {
		dispatch({ type: "CLEAR_MESSAGES" });
	}, []);

	/**
	 * Set the last user message (for restore after cancel).
	 */
	const setLastUserMessage = useCallback((message: string | null) => {
		dispatch({ type: "SET_LAST_USER_MESSAGE", message });
	}, []);

	return {
		// State
		messages: state.messages,
		lastUserMessage: state.lastUserMessage,

		// Actions
		addMessage,
		updateLastMessage,
		updateMessage,
		clearMessages,
		setLastUserMessage,
	};
}

export type UseMessagesReturn = ReturnType<typeof useMessages>;
