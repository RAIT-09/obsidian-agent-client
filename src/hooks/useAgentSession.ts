import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SlashCommand,
	AuthenticationMethod,
} from "../domain/models/chat-session";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import type {
	SessionErrorInfo,
	UseAgentSessionReturn,
} from "./agent-session/types";
import {
	buildAgentConfigWithApiKey,
	createInitialSession,
	findAgentSettings,
	getAvailableAgentsFromSettings,
	getCurrentAgent,
	getDefaultAgentId,
	resolveExistingAgentId,
} from "./agent-session/helpers";
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
			const settings = settingsAccess.getSnapshot();
			const agentId = resolveExistingAgentId(settings, overrideAgentId);
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
					if (creationCounterRef.current !== creationId) return;
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${agentId}" not found in settings`,
						suggestion: "Please check your agent configuration in settings.",
					});
					return;
				}

				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					agentId,
					workingDirectory,
				);

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
					const initResult = await agentClient.initialize(agentConfig);
					if (creationCounterRef.current !== creationId) return;
					authMethods = initResult.authMethods;
					promptCapabilities = initResult.promptCapabilities;
					agentCapabilities = initResult.agentCapabilities;
					agentInfo = initResult.agentInfo;
				}

				const sessionResult = await agentClient.newSession(workingDirectory);
				if (creationCounterRef.current !== creationId) return;

				setSession((prev) => ({
					...prev,
					sessionId: sessionResult.sessionId,
					state: "ready",
					authMethods: authMethods,
					modes: sessionResult.modes,
					models: sessionResult.models,
					promptCapabilities: needsInitialize
						? promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: needsInitialize
						? agentCapabilities
						: prev.agentCapabilities,
					agentInfo: needsInitialize ? agentInfo : prev.agentInfo,
					lastActivityAt: new Date(),
				}));

				{
					const snap = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						cachedAgentModels: {
							...snap.cachedAgentModels,
							[agentId]: sessionResult.models
								? sessionResult.models.availableModels.map((m) => ({
										modelId: m.modelId,
										name: m.name,
										description: m.description,
									}))
								: [],
						},
						cachedAgentModes: {
							...snap.cachedAgentModes,
							[agentId]: sessionResult.modes
								? sessionResult.modes.availableModes.map((m) => ({
										id: m.id,
										name: m.name,
										description: m.description,
									}))
								: [],
						},
					});
				}

				if (sessionResult.models && sessionResult.sessionId) {
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
							if (creationCounterRef.current !== creationId) return;
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
							void 0;
						}
					}
				}
			} catch (error) {
				if (creationCounterRef.current !== creationId) return;
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Session Creation Failed",
					message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion: "Please check the agent configuration and try again.",
				});
			}
		},
		[agentClient, settingsAccess, workingDirectory],
	);

	const loadSession = useCallback(
		async (sessionId: string) => {
			const creationId = ++creationCounterRef.current;
			const settings = settingsAccess.getSnapshot();
			const defaultAgentId = getDefaultAgentId(settings);
			const currentAgent = getCurrentAgent(settings);

			setSession((prev) => ({
				...prev,
				sessionId: null,
				state: "initializing",
				agentId: defaultAgentId,
				agentDisplayName: currentAgent.displayName,
				authMethods: [],
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
				promptCapabilities: prev.promptCapabilities,
				createdAt: new Date(),
				lastActivityAt: new Date(),
			}));
			setErrorInfo(null);

			try {
				const agentSettings = findAgentSettings(settings, defaultAgentId);

				if (!agentSettings) {
					if (creationCounterRef.current !== creationId) return;
					setSession((prev) => ({ ...prev, state: "error" }));
					setErrorInfo({
						title: "Agent Not Found",
						message: `Agent with ID "${defaultAgentId}" not found in settings`,
						suggestion: "Please check your agent configuration in settings.",
					});
					return;
				}

				const agentConfig = buildAgentConfigWithApiKey(
					settings,
					agentSettings,
					defaultAgentId,
					workingDirectory,
				);

				const needsInitialize =
					!agentClient.isInitialized() ||
					agentClient.getCurrentAgentId() !== defaultAgentId;

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
							sessionCapabilities?: {
								resume?: Record<string, unknown>;
								fork?: Record<string, unknown>;
								list?: Record<string, unknown>;
							};
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

				if (needsInitialize) {
					const initResult = await agentClient.initialize(agentConfig);
					if (creationCounterRef.current !== creationId) return;
					authMethods = initResult.authMethods;
					promptCapabilities = initResult.promptCapabilities;
					agentCapabilities = initResult.agentCapabilities;
				}

				const loadResult = await agentClient.loadSession(
					sessionId,
					workingDirectory,
				);
				if (creationCounterRef.current !== creationId) return;

				{
					const snap = settingsAccess.getSnapshot();
					void settingsAccess.updateSettings({
						cachedAgentModels: {
							...snap.cachedAgentModels,
							[defaultAgentId]: loadResult.models
								? loadResult.models.availableModels.map((m) => ({
										modelId: m.modelId,
										name: m.name,
										description: m.description,
									}))
								: [],
						},
						cachedAgentModes: {
							...snap.cachedAgentModes,
							[defaultAgentId]: loadResult.modes
								? loadResult.modes.availableModes.map((m) => ({
										id: m.id,
										name: m.name,
										description: m.description,
									}))
								: [],
						},
					});
				}

				setSession((prev) => ({
					...prev,
					sessionId: loadResult.sessionId,
					state: "ready",
					authMethods: authMethods,
					modes: loadResult.modes,
					models: loadResult.models,
					promptCapabilities: needsInitialize
						? promptCapabilities
						: prev.promptCapabilities,
					agentCapabilities: needsInitialize
						? agentCapabilities
						: prev.agentCapabilities,
					lastActivityAt: new Date(),
				}));
			} catch (error) {
				if (creationCounterRef.current !== creationId) return;
				setSession((prev) => ({ ...prev, state: "error" }));
				setErrorInfo({
					title: "Session Loading Failed",
					message: `Failed to load session: ${error instanceof Error ? error.message : String(error)}`,
					suggestion: "Please try again or create a new session.",
				});
			}
		},
		[agentClient, settingsAccess, workingDirectory],
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
