/**
 * Chat Context
 *
 * Provides chat state and actions throughout the React component tree.
 * This replaces the ChatViewModel class with a more React-idiomatic approach.
 */

import * as React from "react";
const { createContext, useContext, useReducer, useCallback, useMemo } = React;
import type {
	ChatMessage,
	ChatSession,
	ErrorInfo,
	SlashCommand,
	NoteMetadata,
} from "../types";

// ============================================================================
// State Types
// ============================================================================

export interface ChatState {
	messages: ChatMessage[];
	session: ChatSession;
	errorInfo: ErrorInfo | null;
	isSending: boolean;
	lastUserMessage: string | null;

	// Mention dropdown state
	showMentionDropdown: boolean;
	mentionSuggestions: NoteMetadata[];
	selectedMentionIndex: number;
	currentMentionQuery: string;

	// Slash command dropdown state
	showSlashCommandDropdown: boolean;
	slashCommandSuggestions: SlashCommand[];
	selectedSlashCommandIndex: number;
	currentSlashCommandQuery: string;

	// Auto-mention state
	isAutoMentionTemporarilyDisabled: boolean;
}

// ============================================================================
// Action Types
// ============================================================================

export type ChatAction =
	| { type: "SET_MESSAGES"; messages: ChatMessage[] }
	| { type: "ADD_MESSAGE"; message: ChatMessage }
	| { type: "UPDATE_MESSAGE"; id: string; updates: Partial<ChatMessage> }
	| { type: "UPDATE_LAST_MESSAGE"; updates: Partial<ChatMessage> }
	| { type: "CLEAR_MESSAGES" }
	| { type: "SET_SESSION"; session: Partial<ChatSession> }
	| { type: "SET_ERROR"; error: ErrorInfo | null }
	| { type: "SET_SENDING"; isSending: boolean }
	| { type: "SET_LAST_USER_MESSAGE"; message: string | null }
	| {
			type: "SET_MENTION_DROPDOWN";
			show: boolean;
			suggestions?: NoteMetadata[];
			query?: string;
	  }
	| { type: "SET_MENTION_INDEX"; index: number }
	| {
			type: "SET_SLASH_COMMAND_DROPDOWN";
			show: boolean;
			suggestions?: SlashCommand[];
			query?: string;
	  }
	| { type: "SET_SLASH_COMMAND_INDEX"; index: number }
	| { type: "SET_AVAILABLE_COMMANDS"; commands: SlashCommand[] }
	| { type: "SET_AUTO_MENTION_DISABLED"; disabled: boolean }
	| { type: "RESET_STATE" };

// ============================================================================
// Initial State
// ============================================================================

export const createInitialState = (agentId: string): ChatState => ({
	messages: [],
	session: {
		sessionId: null,
		state: "initializing",
		agentId,
		agentDisplayName: "",
		authMethods: [],
		availableCommands: [],
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory: "",
	},
	errorInfo: null,
	isSending: false,
	lastUserMessage: null,
	showMentionDropdown: false,
	mentionSuggestions: [],
	selectedMentionIndex: 0,
	currentMentionQuery: "",
	showSlashCommandDropdown: false,
	slashCommandSuggestions: [],
	selectedSlashCommandIndex: 0,
	currentSlashCommandQuery: "",
	isAutoMentionTemporarilyDisabled: false,
});

// ============================================================================
// Reducer
// ============================================================================

function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case "SET_MESSAGES":
			return { ...state, messages: action.messages };

		case "ADD_MESSAGE":
			return { ...state, messages: [...state.messages, action.message] };

		case "UPDATE_MESSAGE": {
			const messages = state.messages.map((msg) =>
				msg.id === action.id ? { ...msg, ...action.updates } : msg,
			);
			return { ...state, messages };
		}

		case "UPDATE_LAST_MESSAGE": {
			if (state.messages.length === 0) return state;
			const messages = [...state.messages];
			const lastIndex = messages.length - 1;
			messages[lastIndex] = { ...messages[lastIndex], ...action.updates };
			return { ...state, messages };
		}

		case "CLEAR_MESSAGES":
			return { ...state, messages: [] };

		case "SET_SESSION":
			return {
				...state,
				session: { ...state.session, ...action.session },
			};

		case "SET_ERROR":
			return { ...state, errorInfo: action.error };

		case "SET_SENDING":
			return { ...state, isSending: action.isSending };

		case "SET_LAST_USER_MESSAGE":
			return { ...state, lastUserMessage: action.message };

		case "SET_MENTION_DROPDOWN":
			return {
				...state,
				showMentionDropdown: action.show,
				mentionSuggestions:
					action.suggestions ?? state.mentionSuggestions,
				currentMentionQuery: action.query ?? state.currentMentionQuery,
				selectedMentionIndex: action.show
					? 0
					: state.selectedMentionIndex,
			};

		case "SET_MENTION_INDEX":
			return { ...state, selectedMentionIndex: action.index };

		case "SET_SLASH_COMMAND_DROPDOWN":
			return {
				...state,
				showSlashCommandDropdown: action.show,
				slashCommandSuggestions:
					action.suggestions ?? state.slashCommandSuggestions,
				currentSlashCommandQuery:
					action.query ?? state.currentSlashCommandQuery,
				selectedSlashCommandIndex: action.show
					? 0
					: state.selectedSlashCommandIndex,
			};

		case "SET_SLASH_COMMAND_INDEX":
			return { ...state, selectedSlashCommandIndex: action.index };

		case "SET_AVAILABLE_COMMANDS":
			return {
				...state,
				session: {
					...state.session,
					availableCommands: action.commands,
				},
			};

		case "SET_AUTO_MENTION_DISABLED":
			return {
				...state,
				isAutoMentionTemporarilyDisabled: action.disabled,
			};

		case "RESET_STATE":
			return createInitialState(state.session.agentId);

		default:
			return state;
	}
}

// ============================================================================
// Context
// ============================================================================

interface ChatContextValue {
	state: ChatState;
	dispatch: React.Dispatch<ChatAction>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Provider component for the chat context.
 */
export function ChatProvider({
	initialAgentId,
	children,
}: {
	initialAgentId: string;
	children: React.ReactNode;
}) {
	const [state, dispatch] = useReducer(
		chatReducer,
		initialAgentId,
		createInitialState,
	);

	const value = useMemo(() => ({ state, dispatch }), [state]);

	return (
		<ChatContext.Provider value={value}>{children}</ChatContext.Provider>
	);
}

/**
 * Hook to access chat state and dispatch.
 *
 * @throws Error if used outside of ChatProvider
 */
export function useChatContext(): ChatContextValue {
	const context = useContext(ChatContext);
	if (!context) {
		throw new Error("useChatContext must be used within a ChatProvider");
	}
	return context;
}

/**
 * Hook to access only chat state (for components that don't dispatch).
 */
export function useChatState(): ChatState {
	const { state } = useChatContext();
	return state;
}

/**
 * Hook to access only dispatch (for action-only components).
 */
export function useChatDispatch(): React.Dispatch<ChatAction> {
	const { dispatch } = useChatContext();
	return dispatch;
}

export { ChatContext };
