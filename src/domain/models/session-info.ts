import type { SessionModeState, SessionModelState } from "./chat-session";

/**
 * Session metadata from session/list response.
 * Matches ACP SessionInfo type.
 */
export interface SessionInfo {
	/** Unique session identifier */
	sessionId: string;
	/** Working directory for the session */
	cwd: string;
	/** Human-readable session title */
	title?: string;
	/** ISO 8601 timestamp of last update */
	updatedAt?: string;
}

/**
 * Result of session/list (unstable).
 */
export interface ListSessionsResult {
	/** Array of session metadata */
	sessions: SessionInfo[];
	/** Cursor for pagination (load more sessions) */
	nextCursor?: string;
}

/**
 * Result of session/load (stable).
 *
 * Note: Conversation history is received via session/update notifications
 * (user_message_chunk, agent_message_chunk, tool_call, etc.),
 * not in the response itself.
 */
export interface LoadSessionResult {
	/** Session ID */
	sessionId: string;
	/** Session modes (if available) */
	modes?: SessionModeState;
	/** Session models (if available) */
	models?: SessionModelState;
}

/**
 * Result of session/resume (unstable).
 *
 * Resumes a session without history replay.
 * Use when client manages its own history storage.
 */
export interface ResumeSessionResult {
	/** Session ID */
	sessionId: string;
	/** Session modes (if available) */
	modes?: SessionModeState;
	/** Session models (if available) */
	models?: SessionModelState;
}

/**
 * Result of session/fork (unstable).
 *
 * Creates a new session with inherited context from the original.
 */
export interface ForkSessionResult {
	/** New session ID (different from original) */
	sessionId: string;
	/** Session modes (if available) */
	modes?: SessionModeState;
	/** Session models (if available) */
	models?: SessionModelState;
}
