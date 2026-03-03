import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SlashCommand,
} from "../domain/models/chat-session";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type {
	SessionErrorInfo,
	UseAgentSessionReturn,
} from "./agent-session/types";
import {
	createInitialSession,
	getAvailableAgentsFromSettings,
	getCurrentAgent,
	resolveExistingAgentId,
} from "./agent-session/helpers";
import {
	createSessionLifecycle,
	loadSessionLifecycle,
} from "./agent-session/session-lifecycle";
import { createInitialSessionState } from "./state/session.actions";
import { sessionReducer } from "./state/session.reducer";
export type {
	SessionErrorInfo,
	UseAgentSessionReturn,
} from "./agent-session/types";

export function useAgentSession(
	agentClient: IAgentClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
	getApiKeyForAgentId: (
		settings: ReturnType<ISettingsAccess["getSnapshot"]>,
		agentId: string,
	) => string,
	getSecretBindingEnvForAgentId: (
		settings: ReturnType<ISettingsAccess["getSnapshot"]>,
		agentId: string,
	) => Record<string, string>,
	initialAgentId?: string,
): UseAgentSessionReturn {
	const initialSettings = settingsAccess.getSnapshot();
	const effectiveInitialAgentId = resolveExistingAgentId(
		initialSettings,
		initialAgentId,
	);
	const initialAgent = getCurrentAgent(
		initialSettings,
		effectiveInitialAgentId,
	);

	const [state, dispatch] = useReducer(
		sessionReducer,
		createInitialSession(
			effectiveInitialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
		createInitialSessionState,
	);
	const session = state.session;
	const errorInfo = state.errorInfo;
	const setSession = useCallback(
		(updater: (prev: ChatSession) => ChatSession): void => {
			dispatch({ type: "set_session", updater });
		},
		[],
	);
	const setErrorInfo = useCallback((nextError: SessionErrorInfo | null) => {
		if (nextError) {
			dispatch({ type: "set_error", error: nextError });
			return;
		}
		dispatch({ type: "clear_error" });
	}, []);

	const isReady = session.state === "ready";

	// Guards against stale createSession completions when switching agents rapidly.
	// Each call increments the counter; on completion, if the counter has moved on,
	// the result is discarded so the UI never shows a previous agent's models.
	const creationCounterRef = useRef(0);

	const createSession = useCallback(
		async (overrideAgentId?: string) => {
			const creationId = ++creationCounterRef.current;
			await createSessionLifecycle({
				creationId,
				creationCounterRef,
				overrideAgentId,
				agentClient,
				settingsAccess,
				workingDirectory,
				setSession,
				setErrorInfo,
				getApiKeyForAgentId,
				getSecretBindingEnvForAgentId,
			});
		},
		[
			agentClient,
			settingsAccess,
			workingDirectory,
			getApiKeyForAgentId,
			getSecretBindingEnvForAgentId,
		],
	);

	const loadSession = useCallback(
		async (sessionId: string) => {
			const creationId = ++creationCounterRef.current;
			await loadSessionLifecycle({
				creationId,
				creationCounterRef,
				sessionId,
				agentClient,
				settingsAccess,
				workingDirectory,
				setSession,
				setErrorInfo,
				getApiKeyForAgentId,
				getSecretBindingEnvForAgentId,
			});
		},
		[
			agentClient,
			settingsAccess,
			workingDirectory,
			getApiKeyForAgentId,
			getSecretBindingEnvForAgentId,
		],
	);

	const restartSession = useCallback(
		async (newAgentId?: string) => {
			await createSession(newAgentId);
		},
		[createSession],
	);

	const closeSession = useCallback(async () => {
		if (session.sessionId) {
			try {
				await agentClient.cancel(session.sessionId);
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
	}, [agentClient, session.sessionId]);

	const forceRestartAgent = useCallback(async () => {
		const currentAgentId = session.agentId;

		await agentClient.disconnect();

		await createSession(currentAgentId);
	}, [agentClient, session.agentId, createSession]);

	const cancelOperation = useCallback(async () => {
		if (!session.sessionId) {
			return;
		}

		try {
			await agentClient.cancel(session.sessionId);

			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		} catch (error) {
			console.warn("Failed to cancel operation:", error);

			setSession((prev) => ({
				...prev,
				state: "ready",
			}));
		}
	}, [agentClient, session.sessionId]);

	const getAvailableAgents = useCallback(() => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	const updateAvailableCommands = useCallback((commands: SlashCommand[]) => {
		setSession((prev) => ({
			...prev,
			availableCommands: commands,
		}));
	}, []);

	const updateCurrentMode = useCallback((modeId: string) => {
		setSession((prev) => {
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

	const setMode = useCallback(
		async (modeId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set mode: no active session");
				return;
			}

			const previousModeId = session.modes?.currentModeId;

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
			} catch (error) {
				console.error("Failed to set mode:", error);
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

	const setModel = useCallback(
		async (modelId: string) => {
			if (!session.sessionId) {
				console.warn("Cannot set model: no active session");
				return;
			}

			const previousModelId = session.models?.currentModelId;

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

	const updateSessionFromLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			setSession((prev) => ({
				...prev,
				sessionId,
				state: "ready",
				modes: modes ?? prev.modes,
				models: models ?? prev.models,
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
		loadSession,
		restartSession,
		closeSession,
		forceRestartAgent,
		cancelOperation,
		getAvailableAgents,
		updateSessionFromLoad,
		updateAvailableCommands,
		updateCurrentMode,
		setMode,
		setModel,
	};
}
