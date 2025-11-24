/**
 * useSession Hook
 *
 * Manages chat session state and lifecycle.
 * Replaces the session-related functionality from ChatViewModel.
 */

import { useCallback, useReducer } from "react";
import type {
	ChatSession,
	SessionState,
	AuthenticationMethod,
	ErrorInfo,
} from "../types";

// ============================================================================
// State
// ============================================================================

export interface SessionHookState {
	/** Current session information */
	session: ChatSession;

	/** Current error information */
	errorInfo: ErrorInfo | null;

	/** Whether a message is currently being sent */
	isSending: boolean;
}

// ============================================================================
// Actions
// ============================================================================

type SessionAction =
	| { type: "SET_SESSION"; session: Partial<ChatSession> }
	| { type: "SET_SESSION_STATE"; state: SessionState }
	| { type: "SET_SESSION_ID"; sessionId: string | null }
	| {
			type: "SET_AUTH_METHODS";
			authMethods: AuthenticationMethod[];
	  }
	| {
			type: "SET_AVAILABLE_COMMANDS";
			commands: ChatSession["availableCommands"];
	  }
	| { type: "SET_ERROR"; error: ErrorInfo | null }
	| { type: "SET_SENDING"; isSending: boolean }
	| { type: "CLEAR_ERROR" }
	| { type: "UPDATE_ACTIVITY" };

// ============================================================================
// Reducer
// ============================================================================

function sessionReducer(
	state: SessionHookState,
	action: SessionAction,
): SessionHookState {
	switch (action.type) {
		case "SET_SESSION":
			return {
				...state,
				session: { ...state.session, ...action.session },
			};

		case "SET_SESSION_STATE":
			return {
				...state,
				session: { ...state.session, state: action.state },
			};

		case "SET_SESSION_ID":
			return {
				...state,
				session: { ...state.session, sessionId: action.sessionId },
			};

		case "SET_AUTH_METHODS":
			return {
				...state,
				session: { ...state.session, authMethods: action.authMethods },
			};

		case "SET_AVAILABLE_COMMANDS":
			return {
				...state,
				session: {
					...state.session,
					availableCommands: action.commands,
				},
			};

		case "SET_ERROR":
			return {
				...state,
				errorInfo: action.error,
			};

		case "SET_SENDING":
			return {
				...state,
				isSending: action.isSending,
			};

		case "CLEAR_ERROR":
			return {
				...state,
				errorInfo: null,
			};

		case "UPDATE_ACTIVITY":
			return {
				...state,
				session: { ...state.session, lastActivityAt: new Date() },
			};

		default:
			return state;
	}
}

// ============================================================================
// Hook
// ============================================================================

export interface UseSessionOptions {
	/** Initial agent ID */
	agentId: string;

	/** Initial agent display name */
	agentDisplayName: string;

	/** Working directory for the session */
	workingDirectory: string;
}

export function useSession(options: UseSessionOptions) {
	const initialState: SessionHookState = {
		session: {
			sessionId: null,
			state: "disconnected",
			agentId: options.agentId,
			agentDisplayName: options.agentDisplayName,
			authMethods: [],
			createdAt: new Date(),
			lastActivityAt: new Date(),
			workingDirectory: options.workingDirectory,
		},
		errorInfo: null,
		isSending: false,
	};

	const [state, dispatch] = useReducer(sessionReducer, initialState);

	// ========================================
	// Computed Properties
	// ========================================

	const isReady = state.session.state === "ready" && !state.isSending;

	const canSendMessage =
		state.session.sessionId !== null && state.session.state === "ready";

	// ========================================
	// Actions
	// ========================================

	const setSession = useCallback((session: Partial<ChatSession>) => {
		dispatch({ type: "SET_SESSION", session });
	}, []);

	const setSessionState = useCallback((sessionState: SessionState) => {
		dispatch({ type: "SET_SESSION_STATE", state: sessionState });
	}, []);

	const setSessionId = useCallback((sessionId: string | null) => {
		dispatch({ type: "SET_SESSION_ID", sessionId });
	}, []);

	const setAuthMethods = useCallback(
		(authMethods: AuthenticationMethod[]) => {
			dispatch({ type: "SET_AUTH_METHODS", authMethods });
		},
		[],
	);

	const setAvailableCommands = useCallback(
		(commands: ChatSession["availableCommands"]) => {
			dispatch({ type: "SET_AVAILABLE_COMMANDS", commands });
		},
		[],
	);

	const setError = useCallback((error: ErrorInfo | null) => {
		dispatch({ type: "SET_ERROR", error });
	}, []);

	const setSending = useCallback((isSending: boolean) => {
		dispatch({ type: "SET_SENDING", isSending });
	}, []);

	const clearError = useCallback(() => {
		dispatch({ type: "CLEAR_ERROR" });
	}, []);

	const updateActivity = useCallback(() => {
		dispatch({ type: "UPDATE_ACTIVITY" });
	}, []);

	/**
	 * Reset session to initial state (for new session).
	 */
	const resetSession = useCallback(
		(agentId: string, agentDisplayName: string) => {
			dispatch({
				type: "SET_SESSION",
				session: {
					sessionId: null,
					state: "initializing",
					agentId,
					agentDisplayName,
					authMethods: [],
					createdAt: new Date(),
					lastActivityAt: new Date(),
					availableCommands: undefined,
				},
			});
			dispatch({ type: "CLEAR_ERROR" });
		},
		[],
	);

	/**
	 * Mark session as ready with session ID.
	 */
	const markReady = useCallback(
		(sessionId: string, authMethods: AuthenticationMethod[]) => {
			dispatch({
				type: "SET_SESSION",
				session: {
					sessionId,
					state: "ready",
					authMethods,
					lastActivityAt: new Date(),
				},
			});
		},
		[],
	);

	/**
	 * Mark session as disconnected.
	 */
	const markDisconnected = useCallback(() => {
		dispatch({
			type: "SET_SESSION",
			session: {
				sessionId: null,
				state: "disconnected",
			},
		});
	}, []);

	return {
		// State
		session: state.session,
		errorInfo: state.errorInfo,
		isSending: state.isSending,

		// Computed
		isReady,
		canSendMessage,

		// Actions
		setSession,
		setSessionState,
		setSessionId,
		setAuthMethods,
		setAvailableCommands,
		setError,
		setSending,
		clearError,
		updateActivity,
		resetSession,
		markReady,
		markDisconnected,
	};
}

export type UseSessionReturn = ReturnType<typeof useSession>;
