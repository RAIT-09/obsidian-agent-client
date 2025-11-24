import { useState, useCallback } from "react";
import type {
	ChatSession,
	SessionState,
	SlashCommand,
} from "../core/domain/models/chat-session";
import type { ManageSessionUseCase } from "../core/use-cases/manage-session.use-case";
import type { ISettingsAccess } from "../core/domain/ports/settings-access.port";
import type { AgentClientPluginSettings } from "../infrastructure/obsidian-plugin/plugin";

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
 * @param manageSessionUseCase - Use case for session lifecycle operations
 * @param settingsAccess - Settings access for agent configuration
 * @param workingDirectory - Working directory for the session
 */
export function useAgentSession(
	manageSessionUseCase: ManageSessionUseCase,
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
	 */
	const createSession = useCallback(async () => {
		// Get current active agent info from settings
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
			createdAt: new Date(),
			lastActivityAt: new Date(),
		}));
		setErrorInfo(null);

		try {
			// Call use case to create session
			const result = await manageSessionUseCase.createSession({
				workingDirectory,
				agentId: activeAgentId,
			});

			if (result.success && result.sessionId) {
				// Success - update to ready state
				setSession((prev) => ({
					...prev,
					sessionId: result.sessionId!,
					state: "ready",
					authMethods: result.authMethods || [],
					lastActivityAt: new Date(),
				}));
			} else {
				// Use case returned error
				setSession((prev) => ({
					...prev,
					state: "error",
				}));
				setErrorInfo(
					result.error
						? {
								title: result.error.title,
								message: result.error.message,
								suggestion: result.error.suggestion,
							}
						: {
								title: "Session Creation Failed",
								message: "Failed to create new session",
								suggestion: "Please try again.",
							},
				);
			}
		} catch (error) {
			// Unexpected error
			setSession((prev) => ({
				...prev,
				state: "error",
			}));
			setErrorInfo({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [manageSessionUseCase, settingsAccess, workingDirectory]);

	/**
	 * Restart the current session.
	 */
	const restartSession = useCallback(async () => {
		await createSession();
	}, [createSession]);

	/**
	 * Cancel the current operation.
	 */
	const cancelOperation = useCallback(async () => {
		if (!session.sessionId) {
			return;
		}

		try {
			// Cancel via use case
			await manageSessionUseCase.closeSession(session.sessionId);

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
	}, [manageSessionUseCase, session.sessionId]);

	/**
	 * Switch to a different agent.
	 * Updates settings and local session state.
	 */
	const switchAgent = useCallback(
		async (agentId: string) => {
			// Update settings (persists the change)
			await settingsAccess.updateSettings({ activeAgentId: agentId });

			// Update session with new agent ID
			// Clear availableCommands (new agent will send its own)
			setSession((prev) => ({
				...prev,
				agentId,
				availableCommands: undefined,
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

	return {
		session,
		isReady,
		errorInfo,
		createSession,
		restartSession,
		cancelOperation,
		switchAgent,
		getAvailableAgents,
		updateAvailableCommands,
	};
}
