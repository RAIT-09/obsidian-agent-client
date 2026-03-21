import { useState, useCallback, useEffect } from "react";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionUsage,
	SlashCommand,
	AuthenticationMethod,
} from "../types/session";
import type {
	SessionConfigOption,
	SessionConfigSelectOption,
	SessionConfigSelectGroup,
} from "../types/session";
import type { IAgentClient } from "../acp/acp-client";
import type { ISettingsAccess } from "../services/settings-service";
import {
	type AgentInfo,
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
 * Error information specific to session operations.
 */
export interface SessionErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
}

/**
 * Return type for useSession hook.
 */
export interface UseSessionReturn {
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;
	/** Error information if session operation failed */
	errorInfo: SessionErrorInfo | null;

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
	getAvailableAgents: () => AgentInfo[];

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
	 * Callback to update available slash commands.
	 * Called by AcpAdapter when agent sends available_commands_update.
	 */
	updateAvailableCommands: (commands: SlashCommand[]) => void;

	/**
	 * DEPRECATED: Use updateConfigOptions instead.
	 *
	 * Callback to update current mode.
	 * Called by AcpAdapter when agent sends current_mode_update.
	 */
	updateCurrentMode: (modeId: string) => void;

	/**
	 * Callback to update config options.
	 * Called when agent sends config_option_update notification.
	 */
	updateConfigOptions: (configOptions: SessionConfigOption[]) => void;

	/**
	 * Callback to update context window usage.
	 * Called when agent sends usage_update notification.
	 */
	updateUsage: (usage: SessionUsage) => void;

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
// Helpers
// ============================================================================

function flattenConfigSelectOptions(
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
	if (options.length === 0) return [];
	if ("value" in options[0]) return options as SessionConfigSelectOption[];
	return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
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
	agentClient: IAgentClient,
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
	const [errorInfo, setErrorInfo] = useState<SessionErrorInfo | null>(null);

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

				// Check if initialization is needed
				// Only initialize if agent is not initialized OR agent ID has changed
				const needsInitialize =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== agentId;

				let authMethods: AuthenticationMethod[] = [];
				let promptCapabilities:
					| {
							image?: boolean;
							audio?: boolean;
							embeddedContext?: boolean;
					  }
					| undefined;
				let agentCapabilities:
					| {
							loadSession?: boolean;
							mcpCapabilities?: {
								http?: boolean;
								sse?: boolean;
							};
							promptCapabilities?: {
								image?: boolean;
								audio?: boolean;
								embeddedContext?: boolean;
							};
					  }
					| undefined;
				let agentInfo:
					| {
							name: string;
							title?: string;
							version?: string;
					  }
					| undefined;

				if (needsInitialize) {
					// Initialize connection to agent (spawn process + protocol handshake)
					const initResult =
						await agentClient.initialize(agentConfig);
					authMethods = initResult.authMethods;
					promptCapabilities = initResult.promptCapabilities;
					agentCapabilities = initResult.agentCapabilities;
					agentInfo = initResult.agentInfo;
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
					models: sessionResult.models,
					configOptions: sessionResult.configOptions,
					// Only update capabilities/info if we re-initialized
					// Otherwise, keep the previous value (from the same agent)
					promptCapabilities: needsInitialize
						? promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: needsInitialize
						? agentCapabilities
						: prev.agentCapabilities,
					agentInfo: needsInitialize ? agentInfo : prev.agentInfo,
					lastActivityAt: new Date(),
				}));

				// Restore last used model via configOptions if available
				if (sessionResult.configOptions && sessionResult.sessionId) {
					const modelOption = sessionResult.configOptions.find(
						(o) => o.category === "model",
					);
					if (modelOption) {
						const savedModelId = settings.lastUsedModels[agentId];
						if (
							savedModelId &&
							savedModelId !== modelOption.currentValue &&
							flattenConfigSelectOptions(
								modelOption.options,
							).some((o) => o.value === savedModelId)
						) {
							try {
								const updatedOptions =
									await agentClient.setSessionConfigOption(
										sessionResult.sessionId,
										modelOption.id,
										savedModelId,
									);
								setSession((prev) => ({
									...prev,
									configOptions: updatedOptions,
								}));
							} catch {
								// Agent default is fine as fallback
							}
						}
					}

					// Restore last used mode via configOptions
					const modeOption = sessionResult.configOptions.find(
						(o) => o.category === "mode",
					);
					if (modeOption) {
						const savedModeId = settings.lastUsedModes[agentId];
						if (
							savedModeId &&
							savedModeId !== modeOption.currentValue &&
							flattenConfigSelectOptions(modeOption.options).some(
								(o) => o.value === savedModeId,
							)
						) {
							try {
								const updatedOptions =
									await agentClient.setSessionConfigOption(
										sessionResult.sessionId,
										modeOption.id,
										savedModeId,
									);
								setSession((prev) => ({
									...prev,
									configOptions: updatedOptions,
								}));
							} catch {
								// Agent default is fine as fallback
							}
						}
					}
				} else if (sessionResult.models && sessionResult.sessionId) {
					// Legacy fallback: restore model via setSessionModel
					const savedModelId = settings.lastUsedModels[agentId];
					if (
						savedModelId &&
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
							setSession((prev) => {
								if (!prev.models) return prev;
								return {
									...prev,
									models: {
										...prev.models,
										currentModelId: savedModelId,
									},
								};
							});
						} catch {
							// Agent default model is fine as fallback
						}
					}
				}

				// Legacy fallback: restore mode via setSessionMode
				if (
					sessionResult.modes &&
					sessionResult.sessionId &&
					!sessionResult.configOptions
				) {
					const savedModeId = settings.lastUsedModes[agentId];
					if (
						savedModeId &&
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
							setSession((prev) => {
								if (!prev.modes) return prev;
								return {
									...prev,
									modes: {
										...prev.modes,
										currentModeId: savedModeId,
									},
								};
							});
						} catch {
							// Agent default mode is fine as fallback
						}
					}
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

				// Persist last used mode for this agent
				if (session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModes: {
							...currentSettings.lastUsedModes,
							[session.agentId]: modeId,
						},
					});
				}
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
		[
			agentClient,
			session.sessionId,
			session.modes?.currentModeId,
			settingsAccess,
			session.agentId,
		],
	);

	/**
	 * Set the session model (experimental).
	 * Sends a request to the agent to change the model.
	 */
	const setModel = useCallback(
		async (modelId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set model: no active session");
				return;
			}

			// Store previous model for rollback on error
			const previousModelId = session.models?.currentModelId;

			// Optimistic update - update UI immediately
			setSession((prev) => {
				if (!prev.models) return prev;
				return {
					...prev,
					models: {
						...prev.models,
						currentModelId: modelId,
					},
				};
			});

			try {
				await agentClient.setSessionModel(session.sessionId, modelId);
				// Note: Unlike modes, there is no dedicated notification for model changes.
				// UI is already updated optimistically above.

				// Persist last used model for this agent
				if (session.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModels: {
							...currentSettings.lastUsedModels,
							[session.agentId]: modelId,
						},
					});
				}
			} catch (error) {
				console.error("Failed to set model:", error);
				// Rollback to previous model on error
				if (previousModelId) {
					setSession((prev) => {
						if (!prev.models) return prev;
						return {
							...prev,
							models: {
								...prev.models,
								currentModelId: previousModelId,
							},
						};
					});
				}
			}
		},
		[
			agentClient,
			session.sessionId,
			session.models?.currentModelId,
			settingsAccess,
			session.agentId,
		],
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
	 * Update config options from agent notification.
	 */
	const updateConfigOptions = useCallback(
		(configOptions: SessionConfigOption[]) => {
			setSession((prev) => ({
				...prev,
				configOptions,
			}));
		},
		[],
	);

	/**
	 * Update context window usage.
	 * Called when agent sends usage_update notification.
	 */
	const updateUsage = useCallback((usage: SessionUsage) => {
		setSession((prev) => ({
			...prev,
			usage,
		}));
	}, []);

	// Register error callback for process-level errors
	useEffect(() => {
		agentClient.onError((error) => {
			setSession((prev) => ({ ...prev, state: "error" }));
			setErrorInfo({
				title: error.title || "Agent Error",
				message: error.message || "An error occurred",
				suggestion: error.suggestion,
			});
		});
	}, [agentClient]);

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
		updateAvailableCommands,
		updateCurrentMode,
		updateConfigOptions,
		updateUsage,
		setMode,
		setModel,
		setConfigOption,
	};
}
