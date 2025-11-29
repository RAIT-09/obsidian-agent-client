import { useState, useCallback } from "react";
import type {
	ChatSession,
	SessionState,
	SlashCommand,
	AuthenticationMethod,
	SessionModeState,
} from "../domain/models/chat-session";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type { AgentClientPluginSettings } from "../plugin";
import type {
	BaseAgentSettings,
	ClaudeAgentSettings,
	GeminiAgentSettings,
	CodexAgentSettings,
} from "../domain/models/agent-config";
import { toAgentConfig } from "../shared/settings-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent information for display.
 * (Inlined from SwitchAgentUseCase)
 */
export interface AgentInfo {
	/** Unique agent ID */
	id: string;
	/** Display name for UI */
	displayName: string;
}

/**
 * Error information specific to session operations.
 */
export interface SessionErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
}

/**
 * Return type for useAgentSession hook.
 */
export interface UseAgentSessionReturn {
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;
	/** Error information if session operation failed */
	errorInfo: SessionErrorInfo | null;

	/**
	 * Create a new session with the current active agent.
	 * Resets session state and initializes connection.
	 */
	createSession: () => Promise<void>;

	/**
	 * Restart the current session.
	 * Alias for createSession (closes current and creates new).
	 */
	restartSession: () => Promise<void>;

	/**
	 * Close the current session and disconnect from agent.
	 * Cancels any running operation and kills the agent process.
	 */
	closeSession: () => Promise<void>;

	/**
	 * Cancel the current agent operation.
	 * Stops ongoing message generation without disconnecting.
	 */
	cancelOperation: () => Promise<void>;

	/**
	 * Switch to a different agent.
	 * Updates the active agent ID in session state.
	 * @param agentId - ID of the agent to switch to
	 */
	switchAgent: (agentId: string) => Promise<void>;

	/**
	 * Get list of available agents.
	 * @returns Array of agent info with id and displayName
	 */
	getAvailableAgents: () => AgentInfo[];

	/**
	 * Callback to update available slash commands.
	 * Called by AcpAdapter when agent sends available_commands_update.
	 */
	updateAvailableCommands: (commands: SlashCommand[]) => void;

	/**
	 * Callback to update current mode.
	 * Called by AcpAdapter when agent sends current_mode_update.
	 */
	updateCurrentMode: (modeId: string) => void;

	/**
	 * Set the session mode.
	 * Sends a request to the agent to change the mode.
	 * @param modeId - ID of the mode to set
	 */
	setMode: (modeId: string) => Promise<void>;
}

// ============================================================================
// Helper Functions (Inlined from SwitchAgentUseCase)
// ============================================================================

/**
 * Get the currently active agent ID from settings.
 */
function getActiveAgentId(settings: AgentClientPluginSettings): string {
	return settings.activeAgentId || settings.claude.id;
}

/**
 * Get list of all available agents from settings.
 */
function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentInfo[] {
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

/**
 * Get the currently active agent information from settings.
 */
function getCurrentAgent(settings: AgentClientPluginSettings): AgentInfo {
	const activeId = getActiveAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

// ============================================================================
// Helper Functions (Inlined from ManageSessionUseCase)
// ============================================================================

/**
 * Find agent settings by ID from plugin settings.
 */
function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Build AgentConfig with API key injection for known agents.
 */
function buildAgentConfigWithApiKey(
	settings: AgentClientPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);

	// Add API keys to environment for Claude, Codex, and Gemini
	if (agentId === settings.claude.id) {
		const claudeSettings = agentSettings as ClaudeAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				ANTHROPIC_API_KEY: claudeSettings.apiKey,
			},
		};
	}
	if (agentId === settings.codex.id) {
		const codexSettings = agentSettings as CodexAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				OPENAI_API_KEY: codexSettings.apiKey,
			},
		};
	}
	if (agentId === settings.gemini.id) {
		const geminiSettings = agentSettings as GeminiAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				GOOGLE_API_KEY: geminiSettings.apiKey,
			},
		};
	}

	// Custom agents - no API key injection
	return baseConfig;
}

// ============================================================================
// Initial State
// ============================================================================

/**
 * Create initial session state.
 */
function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected" as SessionState,
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing agent session lifecycle.
 *
 * Handles session creation, restart, cancellation, and agent switching.
 * This hook owns the session state independently.
 *
 * @param agentClient - Agent client for communication
 * @param settingsAccess - Settings access for agent configuration
 * @param workingDirectory - Working directory for the session
 */
export function useAgentSession(
	agentClient: IAgentClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
): UseAgentSessionReturn {
	// Get initial agent info from settings
	const initialSettings = settingsAccess.getSnapshot();
	const initialAgentId = getActiveAgentId(initialSettings);
	const initialAgent = getCurrentAgent(initialSettings);

	// Session state
	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			initialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	// Error state
	const [errorInfo, setErrorInfo] = useState<SessionErrorInfo | null>(null);

	// Derived state
	const isReady = session.state === "ready";

	/**
	 * Create a new session with the active agent.
	 * (Inlined from ManageSessionUseCase.createSession)
	 */
	const createSession = useCallback(async () => {
		// Get current settings and agent info
		const settings = settingsAccess.getSnapshot();
		const activeAgentId = getActiveAgentId(settings);
		const currentAgent = getCurrentAgent(settings);

		// Reset to initializing state immediately
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "initializing",
			agentId: activeAgentId,
			agentDisplayName: currentAgent.displayName,
			authMethods: [],
			availableCommands: undefined,
			modes: undefined,
			createdAt: new Date(),
			lastActivityAt: new Date(),
		}));
		setErrorInfo(null);

		try {
			// Find agent settings
			const agentSettings = findAgentSettings(settings, activeAgentId);

			if (!agentSettings) {
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Agent Not Found",
					message: `Agent with ID "${activeAgentId}" not found in settings`,
					suggestion:
						"Please check your agent configuration in settings.",
				});
				return;
			}

			// Build AgentConfig with API key injection
			const agentConfig = buildAgentConfigWithApiKey(
				settings,
				agentSettings,
				activeAgentId,
				workingDirectory,
			);

			// Check if initialization is needed
			// Only initialize if agent is not initialized OR agent ID has changed
			const needsInitialize =
				!agentClient.isInitialized() ||
				agentClient.getCurrentAgentId() !== activeAgentId;

			let authMethods: AuthenticationMethod[] = [];

			if (needsInitialize) {
				// Initialize connection to agent (spawn process + protocol handshake)
				const initResult = await agentClient.initialize(agentConfig);
				authMethods = initResult.authMethods;
			}

			// Create new session (lightweight operation)
			const sessionResult =
				await agentClient.newSession(workingDirectory);

			// Success - update to ready state
			setSession((prev) => ({
				...prev,
				sessionId: sessionResult.sessionId,
				state: "ready",
				authMethods: authMethods,
				modes: sessionResult.modes,
				lastActivityAt: new Date(),
			}));
		} catch (error) {
			// Error - update to error state
			setSession((prev) => ({ ...prev, state: "error" }));
			setErrorInfo({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [agentClient, settingsAccess, workingDirectory]);

	/**
	 * Restart the current session.
	 */
	const restartSession = useCallback(async () => {
		await createSession();
	}, [createSession]);

	/**
	 * Close the current session and disconnect from agent.
	 * Cancels any running operation and kills the agent process.
	 */
	const closeSession = useCallback(async () => {
		// Cancel current session if active
		if (session.sessionId) {
			try {
				await agentClient.cancel(session.sessionId);
			} catch (error) {
				// Ignore errors - session might already be closed
				console.warn("Failed to cancel session:", error);
			}
		}

		// Disconnect from agent (kill process)
		try {
			await agentClient.disconnect();
		} catch (error) {
			console.warn("Failed to disconnect:", error);
		}

		// Update to disconnected state
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "disconnected",
		}));
	}, [agentClient, session.sessionId]);

	/**
	 * Cancel the current operation.
	 */
	const cancelOperation = useCallback(async () => {
		if (!session.sessionId) {
			return;
		}

		try {
			// Cancel via agent client
			await agentClient.cancel(session.sessionId);

			// Update to ready state
			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		} catch (error) {
			// If cancel fails, log but still update UI
			console.warn("Failed to cancel operation:", error);

			// Still update to ready state
			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		}
	}, [agentClient, session.sessionId]);

	/**
	 * Switch to a different agent.
	 * Updates settings and local session state.
	 */
	const switchAgent = useCallback(
		async (agentId: string) => {
			// Update settings (persists the change)
			await settingsAccess.updateSettings({ activeAgentId: agentId });

			// Update session with new agent ID
			// Clear availableCommands and modes (new agent will send its own)
			setSession((prev) => ({
				...prev,
				agentId,
				availableCommands: undefined,
				modes: undefined,
			}));
		},
		[settingsAccess],
	);

	/**
	 * Get list of available agents.
	 */
	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	/**
	 * Update available slash commands.
	 * Called by AcpAdapter when receiving available_commands_update.
	 */
	const updateAvailableCommands = useCallback((commands: SlashCommand[]) => {
		setSession((prev) => ({
			...prev,
			availableCommands: commands,
		}));
	}, []);

	/**
	 * Update current mode.
	 * Called by AcpAdapter when receiving current_mode_update.
	 */
	const updateCurrentMode = useCallback((modeId: string) => {
		setSession((prev) => {
			// Only update if modes exist
			if (!prev.modes) {
				return prev;
			}
			return {
				...prev,
				modes: {
					...prev.modes,
					currentModeId: modeId,
				},
			};
		});
	}, []);

	/**
	 * Set the session mode.
	 * Sends a request to the agent to change the mode.
	 */
	const setMode = useCallback(
		async (modeId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set mode: no active session");
				return;
			}

			// Store previous mode for rollback on error
			const previousModeId = session.modes?.currentModeId;

			// Optimistic update - update UI immediately
			setSession((prev) => {
				if (!prev.modes) return prev;
				return {
					...prev,
					modes: {
						...prev.modes,
						currentModeId: modeId,
					},
				};
			});

			try {
				await agentClient.setSessionMode(session.sessionId, modeId);
				// Per ACP protocol, current_mode_update is only sent when the agent
				// changes its own mode, not in response to client's setSessionMode.
				// UI is already updated optimistically above.
			} catch (error) {
				console.error("Failed to set mode:", error);
				// Rollback to previous mode on error
				if (previousModeId) {
					setSession((prev) => {
						if (!prev.modes) return prev;
						return {
							...prev,
							modes: {
								...prev.modes,
								currentModeId: previousModeId,
							},
						};
					});
				}
			}
		},
		[agentClient, session.sessionId, session.modes?.currentModeId],
	);

	return {
		session,
		isReady,
		errorInfo,
		createSession,
		restartSession,
		closeSession,
		cancelOperation,
		switchAgent,
		getAvailableAgents,
		updateAvailableCommands,
		updateCurrentMode,
		setMode,
	};
}
