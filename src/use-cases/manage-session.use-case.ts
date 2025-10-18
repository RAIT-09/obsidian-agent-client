/**
 * Manage Session Use Case
 *
 * Handles session lifecycle management for AI agents.
 * Responsibilities:
 * - Create new chat sessions
 * - Restart existing sessions
 * - Close sessions and cleanup resources
 */

import type { IAgentClient } from "../ports/agent-client.port";
import type { ISettingsAccess } from "../ports/settings-access.port";
import type { AgentError } from "../domain/models/agent-error";
import type { AuthenticationMethod } from "../domain/models/chat-session";

// ============================================================================
// Input/Output Types
// ============================================================================

/**
 * Input for creating a new session
 */
export interface CreateSessionInput {
	/** Working directory for the session */
	workingDirectory: string;
}

/**
 * Result of creating a new session
 */
export interface CreateSessionResult {
	/** Whether session creation succeeded */
	success: boolean;

	/** New session ID */
	sessionId?: string;

	/** Error information if creation failed */
	error?: AgentError;
}

/**
 * Input for restarting a session
 */
export interface RestartSessionInput {
	/** Working directory for the new session */
	workingDirectory: string;

	/** Current session ID to close (if any) */
	currentSessionId?: string | null;
}

/**
 * Result of restarting a session
 */
export interface RestartSessionResult {
	/** Whether restart succeeded */
	success: boolean;

	/** New session ID */
	sessionId?: string;

	/** Error information if restart failed */
	error?: AgentError;
}

// ============================================================================
// Use Case Implementation
// ============================================================================

export class ManageSessionUseCase {
	constructor(
		private agentClient: IAgentClient,
		private settingsAccess: ISettingsAccess,
	) {}

	/**
	 * Create a new chat session
	 */
	async createSession(
		input: CreateSessionInput,
	): Promise<CreateSessionResult> {
		try {
			const result = await this.agentClient.newSession(
				input.workingDirectory,
			);

			return {
				success: true,
				sessionId: result.sessionId,
			};
		} catch (error) {
			return {
				success: false,
				error: {
					id: crypto.randomUUID(),
					category: "connection",
					severity: "error",
					title: "Session Creation Failed",
					message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion:
						"Please try disconnecting and reconnecting to the agent.",
					occurredAt: new Date(),
					originalError: error,
				},
			};
		}
	}

	/**
	 * Restart the current session
	 *
	 * Creates a new session and optionally cancels the old one.
	 * This is useful when switching agents or resetting the conversation.
	 */
	async restartSession(
		input: RestartSessionInput,
	): Promise<RestartSessionResult> {
		// Cancel old session if it exists
		if (input.currentSessionId) {
			try {
				await this.agentClient.cancel(input.currentSessionId);
			} catch (error) {
				// Ignore cancellation errors - session might already be closed
				console.warn("Failed to cancel old session:", error);
			}
		}

		// Create new session
		const result = await this.createSession({
			workingDirectory: input.workingDirectory,
		});

		return {
			success: result.success,
			sessionId: result.sessionId,
			error: result.error,
		};
	}

	/**
	 * Close the current session
	 *
	 * Cancels any ongoing operations and disconnects from the agent.
	 */
	async closeSession(sessionId: string | null): Promise<void> {
		if (!sessionId) {
			return; // No session to close
		}

		try {
			await this.agentClient.cancel(sessionId);
		} catch (error) {
			// Ignore errors - session might already be closed
			console.warn("Failed to close session:", error);
		}
	}
}
