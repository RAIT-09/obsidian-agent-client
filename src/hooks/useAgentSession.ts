/**
 * Sub-hook for managing agent session lifecycle and configuration.
 *
 * Handles session creation, restart, close, config/mode/model management,
 * and session-level update processing.
 */

import * as React from "react";
const { useState, useCallback, useRef } = React;

import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionUpdate,
	SessionConfigOption,
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
import {
	applyLegacyValue,
	tryRestoreConfigOption,
	restoreLegacyConfig,
} from "../services/session-state";

// ============================================================================
// Types
// ============================================================================

export interface UseAgentSessionReturn {
	session: ChatSession;
	isReady: boolean;

	// Session lifecycle
	createSession: (
		overrideAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	restartSession: (
		newAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	closeSession: () => Promise<void>;
	forceRestartAgent: () => Promise<void>;
	cancelOperation: () => Promise<void>;
	getAvailableAgents: () => AgentDisplayInfo[];
	updateSessionFromLoad: (
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		configOptions?: SessionConfigOption[],
	) => Promise<void>;

	// Config
	setMode: (modeId: string) => Promise<void>;
	setModel: (modelId: string) => Promise<void>;
	setConfigOption: (configId: string, value: string) => Promise<void>;

	/** Handle session-level updates (commands, mode, config, usage, error) */
	handleSessionUpdate: (update: SessionUpdate) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAgentSession(
	agentClient: AcpClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
	setErrorInfo: (error: ErrorInfo | null) => void,
	initialAgentId?: string,
): UseAgentSessionReturn {
	// ============================================================
	// Session State
	// ============================================================

	const initialSettings = settingsAccess.getSnapshot();
	const effectiveInitialAgentId =
		initialAgentId || getDefaultAgentId(initialSettings);
	const initialAgent = getCurrentAgent(
		initialSettings,
		effectiveInitialAgentId,
	);

	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			effectiveInitialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	const isReady = session.state === "ready";

	// Ref for accessing latest session in callbacks without deps
	const sessionRef = useRef(session);
	sessionRef.current = session;

	// ============================================================
	// Session Update Handler (session-level only)
	// ============================================================

	const handleSessionUpdate = useCallback(
		(update: SessionUpdate) => {
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
							modes: {
								...prev.modes,
								currentModeId: update.currentModeId,
							},
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
			}
		},
		[setErrorInfo],
	);

	// ============================================================
	// Session Lifecycle
	// ============================================================

	const createSession = useCallback(
		async (overrideAgentId?: string, overrideCwd?: string) => {
			const effectiveCwd = overrideCwd || workingDirectory;
			const settings = settingsAccess.getSnapshot();
			const agentId = overrideAgentId || getDefaultAgentId(settings);
			const currentAgent = getCurrentAgent(settings, agentId);

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
				promptCapabilities: prev.promptCapabilities,
				agentCapabilities: prev.agentCapabilities,
				agentInfo: prev.agentInfo,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
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

				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					effectiveCwd,
				);

				const initResult =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== agentId
						? await agentClient.initialize(agentConfig)
						: null;

				const sessionResult =
					await agentClient.newSession(effectiveCwd);

				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					authMethods: initResult?.authMethods ?? [],
					modes: sessionResult.modes,
					models: sessionResult.models,
					configOptions: sessionResult.configOptions,
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
					await restoreLegacyConfig(
						agentClient,
						sessionResult,
						settings.lastUsedModels[agentId],
						settings.lastUsedModes[agentId],
						setSession,
					);
				}
			} catch (error) {
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Session Creation Failed",
					message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion:
						"Please check the agent configuration and try again.",
				});
			}
		},
		[agentClient, settingsAccess, workingDirectory, setErrorInfo],
	);

	const restartSession = useCallback(
		async (newAgentId?: string, overrideCwd?: string) => {
			await createSession(newAgentId, overrideCwd);
		},
		[createSession],
	);

	const closeSession = useCallback(async () => {
		const s = sessionRef.current;
		if (s.sessionId) {
			try {
				await agentClient.cancel(s.sessionId);
			} catch (error) {
				console.warn("Failed to cancel session:", error);
			}
		}
		try {
			await agentClient.disconnect();
		} catch (error) {
			console.warn("Failed to disconnect:", error);
		}
		setSession((prev) => ({
			...prev,
			sessionId: null,
			state: "disconnected",
		}));
	}, [agentClient]);

	const forceRestartAgent = useCallback(async () => {
		const currentAgentId = sessionRef.current.agentId;
		await agentClient.disconnect();
		await createSession(currentAgentId);
	}, [agentClient, createSession]);

	const cancelOperation = useCallback(async () => {
		const s = sessionRef.current;
		if (!s.sessionId) return;
		try {
			await agentClient.cancel(s.sessionId);
			setSession((prev) => ({ ...prev, state: "ready" }));
		} catch (error) {
			console.warn("Failed to cancel operation:", error);
			setSession((prev) => ({ ...prev, state: "ready" }));
		}
	}, [agentClient]);

	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	const updateSessionFromLoad = useCallback(
		async (
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

			// Restore last used config (model/mode) — same logic as createSession
			const s = sessionRef.current;
			const settings = settingsAccess.getSnapshot();
			const agentId = s.agentId;

			if (configOptions && sessionId) {
				let restored = configOptions;
				restored = await tryRestoreConfigOption(
					agentClient,
					sessionId,
					restored,
					"model",
					settings.lastUsedModels[agentId],
				);
				restored = await tryRestoreConfigOption(
					agentClient,
					sessionId,
					restored,
					"mode",
					settings.lastUsedModes[agentId],
				);
				if (restored !== configOptions) {
					setSession((prev) => ({
						...prev,
						configOptions: restored,
					}));
				}
			} else if (sessionId && modes) {
				await restoreLegacyConfig(
					agentClient,
					{ sessionId, modes, models, configOptions: undefined },
					settings.lastUsedModels[agentId],
					settings.lastUsedModes[agentId],
					setSession,
				);
			}
		},
		[agentClient, settingsAccess],
	);

	// ============================================================
	// Config (including legacy)
	// ============================================================

	const setLegacyConfigValue = useCallback(
		async (kind: "mode" | "model", value: string) => {
			const s = sessionRef.current;
			if (!s.sessionId) {
				console.warn(`Cannot set ${kind}: no active session`);
				return;
			}

			const previousValue =
				kind === "mode"
					? s.modes?.currentModeId
					: s.models?.currentModelId;

			setSession((prev) => applyLegacyValue(prev, kind, value));

			try {
				if (kind === "mode") {
					await agentClient.setSessionMode(s.sessionId, value);
				} else {
					await agentClient.setSessionModel(s.sessionId, value);
				}

				if (s.agentId) {
					const persistKey =
						kind === "mode" ? "lastUsedModes" : "lastUsedModels";
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						[persistKey]: {
							...currentSettings[persistKey],
							[s.agentId]: value,
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
		[agentClient, settingsAccess],
	);

	const setMode = useCallback(
		(modeId: string) => setLegacyConfigValue("mode", modeId),
		[setLegacyConfigValue],
	);

	const setModel = useCallback(
		(modelId: string) => setLegacyConfigValue("model", modelId),
		[setLegacyConfigValue],
	);

	const setConfigOption = useCallback(
		async (configId: string, value: string) => {
			const s = sessionRef.current;
			if (!s.sessionId) {
				console.warn("Cannot set config option: no active session");
				return;
			}

			const previousConfigOptions = s.configOptions;

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
					s.sessionId,
					configId,
					value,
				);
				setSession((prev) => ({
					...prev,
					configOptions: updatedOptions,
				}));

				const changedOption = updatedOptions.find(
					(o) => o.id === configId,
				);
				if (changedOption?.category === "model" && s.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModels: {
							...currentSettings.lastUsedModels,
							[s.agentId]: value,
						},
					});
				}
				if (changedOption?.category === "mode" && s.agentId) {
					const currentSettings = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						lastUsedModes: {
							...currentSettings.lastUsedModes,
							[s.agentId]: value,
						},
					});
				}
			} catch (error) {
				console.error("Failed to set config option:", error);
				if (previousConfigOptions) {
					setSession((prev) => ({
						...prev,
						configOptions: previousConfigOptions,
					}));
				}
			}
		},
		[agentClient, settingsAccess],
	);

	// ============================================================
	// Return
	// ============================================================

	return {
		session,
		isReady,
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
		handleSessionUpdate,
	};
}
