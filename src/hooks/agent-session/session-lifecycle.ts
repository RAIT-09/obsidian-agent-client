import type { AuthenticationMethod, ChatSession } from "../../domain/models/chat-session";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import type { SessionErrorInfo } from "./types";
import {
	buildAgentConfigWithApiKey,
	findAgentSettings,
	getCurrentAgent,
	getDefaultAgentId,
	resolveExistingAgentId,
} from "./helpers";

interface AgentCapabilitiesSnapshot {
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

interface PromptCapabilitiesSnapshot {
	image?: boolean;
	audio?: boolean;
	embeddedContext?: boolean;
}

interface SharedLifecycleDeps {
	creationId: number;
	creationCounterRef: { current: number };
	agentClient: IAgentClient;
	settingsAccess: ISettingsAccess;
	workingDirectory: string;
	setSession: (updater: (prev: ChatSession) => ChatSession) => void;
	setErrorInfo: (next: SessionErrorInfo | null) => void;
	getApiKeyForAgentId: (
		settings: ReturnType<ISettingsAccess["getSnapshot"]>,
		agentId: string,
	) => string;
	getSecretBindingEnvForAgentId: (
		settings: ReturnType<ISettingsAccess["getSnapshot"]>,
		agentId: string,
	) => Record<string, string>;
}

interface CreateSessionLifecycleArgs extends SharedLifecycleDeps {
	overrideAgentId?: string;
}

export async function createSessionLifecycle({
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
}: CreateSessionLifecycleArgs): Promise<void> {
	const settings = settingsAccess.getSnapshot();
	const agentId = resolveExistingAgentId(settings, overrideAgentId);
	const currentAgent = getCurrentAgent(settings, agentId);

	setSession((prev) => ({
		...prev,
		sessionId: null,
		state: "initializing",
		agentId,
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
			getApiKeyForAgentId(settings, agentId),
			getSecretBindingEnvForAgentId(settings, agentId),
		);

		const needsInitialize =
			!agentClient.isInitialized() || agentClient.getCurrentAgentId() !== agentId;

		let authMethods: AuthenticationMethod[] = [];
		let promptCapabilities: PromptCapabilitiesSnapshot | undefined;
		let agentCapabilities: AgentCapabilitiesSnapshot | undefined;
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
			authMethods,
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
						? sessionResult.models.availableModels.map((model) => ({
								modelId: model.modelId,
								name: model.name,
								description: model.description,
							}))
						: [],
				},
				cachedAgentModes: {
					...snap.cachedAgentModes,
					[agentId]: sessionResult.modes
						? sessionResult.modes.availableModes.map((mode) => ({
								id: mode.id,
								name: mode.name,
								description: mode.description,
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
					(model) => model.modelId === savedModelId,
				)
			) {
				try {
					await agentClient.setSessionModel(sessionResult.sessionId, savedModelId);
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
}

interface LoadSessionLifecycleArgs extends SharedLifecycleDeps {
	sessionId: string;
}

export async function loadSessionLifecycle({
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
}: LoadSessionLifecycleArgs): Promise<void> {
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
			getApiKeyForAgentId(settings, defaultAgentId),
			getSecretBindingEnvForAgentId(settings, defaultAgentId),
		);

		const needsInitialize =
			!agentClient.isInitialized() ||
			agentClient.getCurrentAgentId() !== defaultAgentId;

		let authMethods: AuthenticationMethod[] = [];
		let promptCapabilities: PromptCapabilitiesSnapshot | undefined;
		let agentCapabilities: AgentCapabilitiesSnapshot | undefined;

		if (needsInitialize) {
			const initResult = await agentClient.initialize(agentConfig);
			if (creationCounterRef.current !== creationId) return;
			authMethods = initResult.authMethods;
			promptCapabilities = initResult.promptCapabilities;
			agentCapabilities = initResult.agentCapabilities;
		}

		const loadResult = await agentClient.loadSession(sessionId, workingDirectory);
		if (creationCounterRef.current !== creationId) return;

		{
			const snap = settingsAccess.getSnapshot();
			void settingsAccess.updateSettings({
				cachedAgentModels: {
					...snap.cachedAgentModels,
					[defaultAgentId]: loadResult.models
						? loadResult.models.availableModels.map((model) => ({
								modelId: model.modelId,
								name: model.name,
								description: model.description,
							}))
						: [],
				},
				cachedAgentModes: {
					...snap.cachedAgentModes,
					[defaultAgentId]: loadResult.modes
						? loadResult.modes.availableModes.map((mode) => ({
								id: mode.id,
								name: mode.name,
								description: mode.description,
							}))
						: [],
				},
			});
		}

		setSession((prev) => ({
			...prev,
			sessionId: loadResult.sessionId,
			state: "ready",
			authMethods,
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
}
