import * as React from "react";
const { useState, useCallback, useEffect } = React;
import {
	flattenConfigSelectOptions,
	type ChatSession,
	type SessionModeState,
	type SessionModelState,
	type SessionUpdate,
	type SessionConfigOption,
	type SessionResult,
} from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import type { ISettingsAccess } from "../services/settings-service";
import type { ErrorInfo } from "../types/errors";
import {
	type AgentDisplayInfo,
	getDefaultAgentId,
	getAvailableAgentsFromSettings,
	getCurrentAgent,
	findAgentSettings,
	buildAgentConfigWithApiKey,
	createInitialSession,
} from "../services/session-helpers";

// ============================================================================
// Types
// ============================================================================

/**
 * Return type for useSession hook.
 */
export interface UseSessionReturn {
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;
	/** Error information if session operation failed */
	errorInfo: ErrorInfo | null;

	/**
	 * Create a new session with the specified or default agent.
	 * Resets session state and initializes connection.
	 * @param overrideAgentId - Optional agent ID to use instead of default
	 */
	createSession: (overrideAgentId?: string) => Promise<void>;

	/**
	 * Restart the current session.
	 * Alias for createSession (closes current and creates new).
	 * @param newAgentId - Optional agent ID to switch to
	 */
	restartSession: (newAgentId?: string) => Promise<void>;

	/**
	 * Close the current session and disconnect from agent.
	 * Cancels any running operation and kills the agent process.
	 */
	closeSession: () => Promise<void>;

	/**
	 * Force restart the agent process.
	 * Unlike restartSession, this ALWAYS kills and respawns the process.
	 * Use when: environment variables changed, agent became unresponsive, etc.
	 */
	forceRestartAgent: () => Promise<void>;

	/**
	 * Cancel the current agent operation.
	 * Stops ongoing message generation without disconnecting.
	 */
	cancelOperation: () => Promise<void>;

	/**
	 * Get list of available agents.
	 * @returns Array of agent info with id and displayName
	 */
	getAvailableAgents: () => AgentDisplayInfo[];

	/**
	 * Update session state after loading/resuming/forking a session.
	 * Called by useSessionHistory after a successful session operation.
	 * @param sessionId - New session ID
	 * @param modes - Session modes (optional)
	 * @param models - Session models (optional)
	 * @param configOptions - Session config options (optional)
	 */
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	) => void;

	/**
	 * DEPRECATED: Use setConfigOption instead.
	 *
	 * Set the session mode.
	 * Sends a request to the agent to change the mode.
	 * @param modeId - ID of the mode to set
	 */
	setMode: (modeId: string) => Promise<void>;

	/**
	 * DEPRECATED: Use setConfigOption instead.
	 *
	 * Set the session model (experimental).
	 * Sends a request to the agent to change the model.
	 * @param modelId - ID of the model to set
	 */
	setModel: (modelId: string) => Promise<void>;

	/**
	 * Set a session configuration option.
	 * Sends a config option change to the agent.
	 * @param configId - ID of the config option to change
	 * @param value - New value to set
	 */
	setConfigOption: (configId: string, value: string) => Promise<void>;
}

// ============================================================================
// Legacy Config Helpers
// ============================================================================

/**
 * Apply a legacy mode/model value to the session state.
 * Used for both optimistic updates and rollbacks.
 */
function applyLegacyValue(
	prev: ChatSession,
	kind: "mode" | "model",
	value: string,
): ChatSession {
	if (kind === "mode") {
		if (!prev.modes) return prev;
		return { ...prev, modes: { ...prev.modes, currentModeId: value } };
	}
	if (!prev.models) return prev;
	return { ...prev, models: { ...prev.models, currentModelId: value } };
}

// ============================================================================
// Config Restore Helpers
// ============================================================================

/**
 * Try to restore a saved config option value by category.
 * Returns updated configOptions if restored, or the original if unchanged.
 */
async function tryRestoreConfigOption(
	agentClient: AcpClient,
	sessionId: string,
	configOptions: SessionConfigOption[],
	category: string,
	savedValue: string | undefined,
): Promise<SessionConfigOption[]> {
	if (!savedValue) return configOptions;

	const option = configOptions.find((o) => o.category === category);
	if (!option) return configOptions;
	if (savedValue === option.currentValue) return configOptions;
	if (
		!flattenConfigSelectOptions(option.options).some(
			(o) => o.value === savedValue,
		)
	)
		return configOptions;

	try {
		return await agentClient.setSessionConfigOption(
			sessionId,
			option.id,
			savedValue,
		);
	} catch {
		return configOptions;
	}
}

/**
 * Restore last used mode/model via legacy APIs.
 * Only called when configOptions is not available.
 */
async function restoreLegacyConfig(
	agentClient: AcpClient,
	sessionResult: SessionResult,
	savedModelId: string | undefined,
	savedModeId: string | undefined,
	setSession: React.Dispatch<React.SetStateAction<ChatSession>>,
): Promise<void> {
	if (!sessionResult.sessionId) return;

	// Legacy model restore
	if (sessionResult.models && savedModelId) {
		if (
			savedModelId !== sessionResult.models.currentModelId &&
			sessionResult.models.availableModels.some(
				(m) => m.modelId === savedModelId,
			)
		) {
			try {
				await agentClient.setSessionModel(
					sessionResult.sessionId,
					savedModelId,
				);
				setSession((prev) =>
					applyLegacyValue(prev, "model", savedModelId),
				);
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	// Legacy mode restore
	if (sessionResult.modes && savedModeId) {
		if (
			savedModeId !== sessionResult.modes.currentModeId &&
			sessionResult.modes.availableModes.some(
				(m) => m.id === savedModeId,
			)
		) {
			try {
				await agentClient.setSessionMode(
					sessionResult.sessionId,
					savedModeId,
				);
				setSession((prev) =>
					applyLegacyValue(prev, "mode", savedModeId),
				);
			} catch {
				// Agent default is fine as fallback
			}
		}
	}
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
 * @param initialAgentId - Optional initial agent ID (from view persistence)
 */
export function useSession(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
	initialAgentId?: string,
): UseSessionReturn {
	// Get initial agent info from settings
	const initialSettings = settingsAccess.getSnapshot();
	const effectiveInitialAgentId =
		initialAgentId || getDefaultAgentId(initialSettings);
	const initialAgent = getCurrentAgent(
		initialSettings,
		effectiveInitialAgentId,
	);

	// Session state
	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			effectiveInitialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	// Error state
	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	// Derived state
	const isReady = session.state === "ready";

	/**
	 * Create a new session with the active agent.
	 * (Inlined from ManageSessionUseCase.createSession)
	 */
	const createSession = useCallback(
		async (overrideAgentId?: string) => {
			// Get current settings and agent info
			const settings = settingsAccess.getSnapshot();
			const agentId = overrideAgentId || getDefaultAgentId(settings);
			const currentAgent = getCurrentAgent(settings, agentId);

			// Reset to initializing state immediately
			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				agentId: agentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				configOptions: undefined,
				usage: undefined,
				// Keep capabilities/info from previous session if same agent
				// They will be updated if re-initialization is needed
				promptCapabilities: prev.promptCapabilities,
				agentCapabilities: prev.agentCapabilities,
				agentInfo: prev.agentInfo,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
				// Find agent settings
				const agentSettings = findAgentSettings(settings, agentId);

				if (!agentSettings) {
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${agentId}" not found in settings`,
						suggestion:
							"Please check your agent configuration in settings.",
					});
					return;
				}

				// Build AgentConfig with API key injection
				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					workingDirectory,
				);

				// Initialize connection if needed
				// (agent not initialized OR agent ID has changed)
				const initResult =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== agentId
						? await agentClient.initialize(agentConfig)
						: null;

				// Create new session (lightweight operation)
				const sessionResult =
					await agentClient.newSession(workingDirectory);

				// Success - update to ready state
				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					authMethods: initResult?.authMethods ?? [],
					modes: sessionResult.modes,
					models: sessionResult.models,
					configOptions: sessionResult.configOptions,
					// Only update capabilities/info if we re-initialized
					// Otherwise, keep the previous value (from the same agent)
					promptCapabilities: initResult
						? initResult.promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: initResult
						? initResult.agentCapabilities
						: prev.agentCapabilities,
					agentInfo: initResult
						? initResult.agentInfo
						: prev.agentInfo,
					lastActivityAt: new Date(),
				}));

				// Restore last used config (model/mode)
				if (sessionResult.configOptions && sessionResult.sessionId) {
					// Modern path: restore via configOptions
					let configOptions = sessionResult.configOptions;
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"model",
						settings.lastUsedModels[agentId],
					);
					configOptions = await tryRestoreConfigOption(
						agentClient,
						sessionResult.sessionId,
						configOptions,
						"mode",
						settings.lastUsedModes[agentId],
					);
					if (configOptions !== sessionResult.configOptions) {
						setSession((prev) => ({
							...prev,
							configOptions,
						}));
					}
				} else if (sessionResult.sessionId) {
					// Legacy path: restore via setSessionMode/setSessionModel
					await restoreLegacyConfig(
						agentClient,
						sessionResult,
						settings.lastUsedModels[agentId],
						settings.lastUsedModes[agentId],
						setSession,
					);
				}
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
		},
		[agentClient, settingsAccess, workingDirectory],
	);

	/**
	 * Restart the current session.
	 * @param newAgentId - Optional agent ID to switch to
	 */
	const restartSession = useCallback(
		async (newAgentId?: string) => {
			await createSession(newAgentId);
		},
		[createSession],
	);

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
	 * Force restart the agent process.
	 * Disconnects (kills process) then creates a new session (spawns new process).
	 *
	 * Note: All state reset (modes, models, availableCommands, etc.) is handled
	 * by createSession() internally, so this function is intentionally simple.
	 */
	const forceRestartAgent = useCallback(async () => {
		const currentAgentId = session.agentId;

		// 1. Disconnect - kills process, sets isInitialized to false
		await agentClient.disconnect();

		// 2. Create new session - handles ALL state reset internally:
		//    - sessionId, state, authMethods
		//    - modes, models (reset to undefined, then set from newSession result)
		//    - availableCommands (reset to undefined)
		//    - createdAt, lastActivityAt
		//    - promptCapabilities, agentCapabilities, agentInfo (updated if re-initialized)
		await createSession(currentAgentId);
	}, [agentClient, session.agentId, createSession]);

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
	 * Get list of available agents.
	 */
	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	/**
	 * Handle a session-level update from the agent.
	 * Processes session-level update types; ignores message-level updates
	 * (those are handled by useMessages).
	 */
	const handleSessionUpdate = useCallback((update: SessionUpdate) => {
		switch (update.type) {
			case "available_commands_update":
				setSession((prev) => ({
					...prev,
					availableCommands: update.commands,
				}));
				break;
			case "current_mode_update":
				setSession((prev) => {
					if (!prev.modes) return prev;
					return {
						...prev,
						modes: { ...prev.modes, currentModeId: update.currentModeId },
					};
				});
				break;
			case "config_option_update":
				setSession((prev) => ({
					...prev,
					configOptions: update.configOptions,
				}));
				break;
			case "usage_update":
				setSession((prev) => ({
					...prev,
					usage: {
						used: update.used,
						size: update.size,
						cost: update.cost ?? undefined,
					},
				}));
				break;
			case "process_error":
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: update.error.title || "Agent Error",
					message: update.error.message || "An error occurred",
					suggestion: update.error.suggestion,
				});
				break;
			// Message-level updates (agent_message_chunk, tool_call, etc.)
			// are ignored here — useMessages handles them.
		}
	}, []);

	// Subscribe to session-level updates from agent
	useEffect(() => {
		const unsubscribe = agentClient.onSessionUpdate(handleSessionUpdate);
		return unsubscribe;
	}, [agentClient, handleSessionUpdate]);

	/**
	 * Set a legacy session mode or model.
	 * Optimistic update with rollback on error.
	 *
	 * DEPRECATED: Legacy API for agents that don't support configOptions.
	 */
	const setLegacyConfigValue = useCallback(
		async (kind: "mode" | "model", value: string) => {
			if (!session.sessionId) {
				console.warn(`Cannot set ${kind}: no active session`);
				return;
			}

			const previousValue =
				kind === "mode"
					? session.modes?.currentModeId
					: session.models?.currentModelId;

			// Optimistic update
			setSession((prev) => applyLegacyValue(prev, kind, value));

			try {
				if (kind === "mode") {
					await agentClient.setSessionMode(
						session.sessionId,
						value,
					);
				} else {
					await agentClient.setSessionModel(
						session.sessionId,
						value,
					);
				}

				// Persist last used value for this agent
				if (session.agentId) {
					const persistKey =
						kind === "mode"
							? "lastUsedModes"
							: "lastUsedModels";
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						[persistKey]: {
							...currentSettings[persistKey],
							[session.agentId]: value,
						},
					});
				}
			} catch (error) {
				console.error(`Failed to set ${kind}:`, error);
				if (previousValue) {
					setSession((prev) =>
						applyLegacyValue(prev, kind, previousValue),
					);
				}
			}
		},
		[
			agentClient,
			session.sessionId,
			session.modes?.currentModeId,
			session.models?.currentModelId,
			settingsAccess,
			session.agentId,
		],
	);

	/**
	 * DEPRECATED: Use setConfigOption instead.
	 * Set the session mode.
	 */
	const setMode = useCallback(
		(modeId: string) => setLegacyConfigValue("mode", modeId),
		[setLegacyConfigValue],
	);

	/**
	 * DEPRECATED: Use setConfigOption instead.
	 * Set the session model.
	 */
	const setModel = useCallback(
		(modelId: string) => setLegacyConfigValue("model", modelId),
		[setLegacyConfigValue],
	);

	/**
	 * Set a session configuration option.
	 * Optimistic update with rollback on error.
	 */
	const setConfigOption = useCallback(
		async (configId: string, value: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set config option: no active session");
				return;
			}

			// Store previous configOptions for rollback on error
			const previousConfigOptions = session.configOptions;

			// Optimistic update - update only the specific option's currentValue
			setSession((prev) => {
				if (!prev.configOptions) return prev;
				return {
					...prev,
					configOptions: prev.configOptions.map((opt) =>
						opt.id === configId
							? { ...opt, currentValue: value }
							: opt,
					),
				};
			});

			try {
				const updatedOptions = await agentClient.setSessionConfigOption(
					session.sessionId,
					configId,
					value,
				);
				// Replace with server response (handles cascading changes)
				setSession((prev) => ({
					...prev,
					configOptions: updatedOptions,
				}));

				// Persist last used value for config options with 'model' or 'mode' category
				const changedOption = updatedOptions.find(
					(o) => o.id === configId,
				);
				if (changedOption?.category === "model" && session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModels: {
							...currentSettings.lastUsedModels,
							[session.agentId]: value,
						},
					});
				}
				if (changedOption?.category === "mode" && session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModes: {
							...currentSettings.lastUsedModes,
							[session.agentId]: value,
						},
					});
				}
			} catch (error) {
				console.error("Failed to set config option:", error);
				// Rollback to previous state on error
				if (previousConfigOptions) {
					setSession((prev) => ({
						...prev,
						configOptions: previousConfigOptions,
					}));
				}
			}
		},
		[
			agentClient,
			session.sessionId,
			session.configOptions,
			settingsAccess,
			session.agentId,
		],
	);


	/**
	 * Update session state after loading/resuming/forking a session.
	 * Called by useSessionHistory after a successful session operation.
	 */
	const updateSessionFromLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			setSession((prev) => ({
				...prev,
				sessionId,
				state: "ready",
				modes: modes ?? prev.modes,
				models: models ?? prev.models,
				configOptions: configOptions ?? prev.configOptions,
				lastActivityAt: new Date(),
			}));
		},
		[],
	);

	return {
		session,
		isReady,
		errorInfo,
		createSession,
		restartSession,
		closeSession,
		forceRestartAgent,
		cancelOperation,
		getAvailableAgents,
		updateSessionFromLoad,
		setMode,
		setModel,
		setConfigOption,
	};
}
