/**
 * Port interface for conversation persistence.
 * Allows storing and retrieving chat sessions and messages.
 */

import type { ChatMessage } from "../models/chat-message";

/**
 * A persisted session with metadata.
 */
export interface PersistedSession {
	sessionId: string;
	agentId: string;
	agentDisplayName: string;
	createdAt: Date;
	lastActivityAt: Date;
	messageCount: number;
	workingDirectory: string;
}

/**
 * Summary of a session for listing.
 */
export interface SessionSummary {
	sessionId: string;
	agentId: string;
	agentDisplayName: string;
	createdAt: Date;
	lastActivityAt: Date;
	messageCount: number;
	preview: string; // First user message snippet
}

/**
 * Options for listing sessions.
 */
export interface ListSessionsOptions {
	limit?: number;
	offset?: number;
	agentId?: string; // Filter by agent
}

/**
 * Persistence interface for chat sessions and messages.
 */
export interface IPersistence {
	/**
	 * Save a session's metadata.
	 */
	saveSession(session: PersistedSession): Promise<void>;

	/**
	 * Get a session by ID.
	 */
	getSession(sessionId: string): Promise<PersistedSession | null>;

	/**
	 * List all sessions with optional filtering.
	 */
	listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]>;

	/**
	 * Delete a session and its messages.
	 */
	deleteSession(sessionId: string): Promise<void>;

	/**
	 * Save messages for a session.
	 * This replaces all existing messages for the session.
	 */
	saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;

	/**
	 * Get all messages for a session.
	 */
	getMessages(sessionId: string): Promise<ChatMessage[]>;

	/**
	 * Append messages to a session.
	 */
	appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;

	/**
	 * Update session metadata (e.g., lastActivityAt, messageCount).
	 */
	updateSession(sessionId: string, updates: Partial<PersistedSession>): Promise<void>;

	/**
	 * Get the total number of stored sessions.
	 */
	getSessionCount(): Promise<number>;

	/**
	 * Clear all data (for testing or reset).
	 */
	clearAll(): Promise<void>;
}
