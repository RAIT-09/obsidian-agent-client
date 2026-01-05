/**
 * Session metadata for session history.
 */
export interface SessionInfo {
	/** Unique session identifier */
	sessionId: string;
	/** Human-readable session title */
	title: string;
	/** Working directory for the session */
	cwd: string;
	/** Working directory (alias for cwd, for backward compatibility) */
	workingDirectory?: string;
	/** ISO 8601 timestamp of last update */
	updatedAt: string;
}

/**
 * Result of listing sessions.
 */
export interface ListSessionsResult {
	/** Array of session metadata */
	sessions: SessionInfo[];
	/** Cursor for pagination (load more sessions) */
	nextCursor?: string;
}

/**
 * Message from conversation history.
 */
export interface ConversationMessage {
	/** Message role (user or assistant) */
	role: string;
	/** Message content */
	content: Array<{ type: string; text: string }>;
	/** Message timestamp */
	timestamp: string;
}

/**
 * Result of loading a session.
 */
export interface LoadSessionResult {
	/** Original session ID that was loaded */
	sessionId: string;
	/** New session ID for future prompts (if different from original) */
	newSessionId?: string;
	/** Session modes (if available) */
	modes?: any;
	/** Session models (if available) */
	models?: any;
	/** Conversation history from the loaded session */
	conversationHistory?: ConversationMessage[];
}
