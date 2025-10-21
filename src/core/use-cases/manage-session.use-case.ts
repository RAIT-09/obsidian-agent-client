/**
 * Manage Session Use Case
 *
 * Handles session lifecycle management for AI agents.
 * Responsibilities:
 * - Create new chat sessions
 * - Restart existing sessions
 * - Close sessions and cleanup resources
 */

import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type { AgentError } from "../domain/models/agent-error";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import type {
	BaseAgentSettings,
	ClaudeAgentSettings,
	GeminiAgentSettings,
	CodexAgentSettings,
} from "../domain/models/agent-config";
import { toAgentConfig } from "../../shared/settings-utils";

// ============================================================================
// Input/Output Types
// ============================================================================

/**
 * Input for creating a new session
 */
export interface CreateSessionInput {
	/** Working directory for the session */
	workingDirectory: string;

	/** Agent ID to connect to */
	agentId: string;
}

/**
 * Result of creating a new session
 */
export interface CreateSessionResult {
	/** Whether session creation succeeded */
	success: boolean;

	/** New session ID */
	sessionId?: string;

	/** Authentication methods supported by the agent */
	authMethods?: AuthenticationMethod[];

	/** Error information if creation failed */
	error?: AgentError;
}

/**
 * Input for restarting a session
 */
export interface RestartSessionInput {
	/** Working directory for the new session */
	workingDirectory: string;

	/** Agent ID to connect to */
	agentId: string;

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

	/** Authentication methods supported by the agent */
	authMethods?: AuthenticationMethod[];

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
	 *
	 * This method:
	 * 1. Gets agent settings from settings store
	 * 2. Converts settings to AgentConfig
	 * 3. Conditionally calls agentClient.initialize() only if:
	 *    - Agent is not initialized, OR
	 *    - Agent ID has changed (switching agents)
	 * 4. Calls agentClient.newSession() to create a chat session
	 */
	async createSession(
		input: CreateSessionInput,
	): Promise<CreateSessionResult> {
		try {
			// Get agent settings from settings store
			const settings = this.settingsAccess.getSnapshot();
			let agentSettings: BaseAgentSettings | null = null;

			// Find the agent by ID
			if (input.agentId === settings.claude.id) {
				agentSettings = settings.claude;
			} else if (input.agentId === settings.codex.id) {
				agentSettings = settings.codex;
			} else if (input.agentId === settings.gemini.id) {
				agentSettings = settings.gemini;
			} else {
				// Search in custom agents
				const customAgent = settings.customAgents.find(
					(agent) => agent.id === input.agentId,
				);
				if (customAgent) {
					agentSettings = customAgent;
				}
			}

			if (!agentSettings) {
				return {
					success: false,
					error: {
						id: crypto.randomUUID(),
						category: "configuration",
						severity: "error",
						title: "Agent Not Found",
						message: `Agent with ID "${input.agentId}" not found in settings`,
						suggestion:
							"Please check your agent configuration in settings.",
						occurredAt: new Date(),
					},
				};
			}

			// Build AgentConfig with API key handling
			const baseConfig = toAgentConfig(
				agentSettings,
				input.workingDirectory,
			);

			// Add API keys to environment for Claude, Codex, and Gemini
			let agentConfig = baseConfig;
			if (input.agentId === settings.claude.id) {
				const claudeSettings = agentSettings as ClaudeAgentSettings;
				agentConfig = {
					...baseConfig,
					env: {
						...baseConfig.env,
						ANTHROPIC_API_KEY: claudeSettings.apiKey,
					},
				};
			} else if (input.agentId === settings.codex.id) {
				const codexSettings = agentSettings as CodexAgentSettings;
				agentConfig = {
					...baseConfig,
					env: {
						...baseConfig.env,
						OPENAI_API_KEY: codexSettings.apiKey,
					},
				};
			} else if (input.agentId === settings.gemini.id) {
				const geminiSettings = agentSettings as GeminiAgentSettings;
				agentConfig = {
					...baseConfig,
					env: {
						...baseConfig.env,
						GOOGLE_API_KEY: geminiSettings.apiKey,
					},
				};
			}

			// Check if initialization is needed
			// Only initialize if:
			// 1. Agent is not initialized yet, OR
			// 2. Agent ID has changed (switching agents)
			const needsInitialize =
				!this.agentClient.isInitialized() ||
				this.agentClient.getCurrentAgentId() !== input.agentId;

			let authMethods: AuthenticationMethod[] = [];

			if (needsInitialize) {
				// Initialize connection to agent (spawn process + protocol handshake)
				const initResult =
					await this.agentClient.initialize(agentConfig);
				authMethods = initResult.authMethods;
			}

			// Create new session (lightweight operation)
			const sessionResult = await this.agentClient.newSession(
				input.workingDirectory,
			);

			return {
				success: true,
				sessionId: sessionResult.sessionId,
				authMethods: authMethods,
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
						"Please check the agent configuration and try again.",
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
			agentId: input.agentId,
		});

		return {
			success: result.success,
			sessionId: result.sessionId,
			authMethods: result.authMethods,
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
