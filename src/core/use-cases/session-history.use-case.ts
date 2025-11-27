/**
 * Use case for managing session history.
 */

import type {
	IPersistence,
	PersistedSession,
	SessionSummary,
	ListSessionsOptions,
} from "../domain/ports/persistence.port";
import type { ChatMessage } from "../domain/models/chat-message";

export interface RestoreSessionResult {
	session: PersistedSession;
	messages: ChatMessage[];
}

/**
 * Manages session persistence and history.
 */
export class SessionHistoryUseCase {
	constructor(private persistence: IPersistence) {}

	/**
	 * Save the current session state.
	 */
	async saveSession(
		sessionId: string,
		agentId: string,
		agentDisplayName: string,
		workingDirectory: string,
		messages: ChatMessage[],
		createdAt: Date,
	): Promise<void> {
		const session: PersistedSession = {
			sessionId,
			agentId,
			agentDisplayName,
			createdAt,
			lastActivityAt: new Date(),
			messageCount: messages.length,
			workingDirectory,
		};

		await this.persistence.saveSession(session);
		await this.persistence.saveMessages(sessionId, messages);
	}

	/**
	 * List available sessions.
	 */
	async listSessions(
		options?: ListSessionsOptions,
	): Promise<SessionSummary[]> {
		return this.persistence.listSessions(options);
	}

	/**
	 * Restore a session's messages.
	 */
	async restoreSession(
		sessionId: string,
	): Promise<RestoreSessionResult | null> {
		const session = await this.persistence.getSession(sessionId);
		if (!session) return null;

		const messages = await this.persistence.getMessages(sessionId);
		return { session, messages };
	}

	/**
	 * Delete a session.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		await this.persistence.deleteSession(sessionId);
	}

	/**
	 * Update session activity timestamp and message count.
	 */
	async updateSessionActivity(
		sessionId: string,
		messageCount: number,
	): Promise<void> {
		await this.persistence.updateSession(sessionId, {
			lastActivityAt: new Date(),
			messageCount,
		});
	}

	/**
	 * Get total session count.
	 */
	async getSessionCount(): Promise<number> {
		return this.persistence.getSessionCount();
	}
}
