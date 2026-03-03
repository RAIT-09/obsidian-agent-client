import { useState, useRef, useEffect, useMemo, useCallback } from "react";

import type { AttachedImage } from "../components/chat/ImagePreviewStrip";
import { pluginNotice } from "../shared/plugin-notice";

import { getLogger } from "../shared/logger";
import { resolveAgentDisplayName } from "../shared/agent-display-name";
import { resolveVaultBasePath } from "../shared/vault-path";
import { useModelFiltering } from "./useModelFiltering";

import { useSettings } from "./useSettings";
import { useMentions } from "./useMentions";
import { useSlashCommands } from "./useSlashCommands";
import { useAutoMention } from "./useAutoMention";
import { useAgentSession } from "./useAgentSession";
import { useChat } from "./useChat";
import { usePermission } from "./usePermission";
import { useSessionHistory } from "./useSessionHistory";
import {
	type UseChatControllerOptions,
	type UseChatControllerReturn,
} from "./chat-controller/types";
import { useSessionHistoryHandlers } from "./chat-controller/session-history-handlers";
import { useChatControllerEffects } from "./chat-controller/controller-effects";
import { useHistoryLoadState } from "./chat-controller/history-load-state";
import type { ImagePromptContent } from "../domain/models/prompt-content";

export function useChatController(
	options: UseChatControllerOptions,
): UseChatControllerReturn {
	const { plugin, viewId, initialAgentId, config } = options;

	const logger = getLogger();

	const vaultPath = useMemo(
		() => options.workingDirectory || resolveVaultBasePath(plugin.app),
		[plugin, options.workingDirectory],
	);

	const sessionKey = viewId;
	const { agentClient, vaultAccess, mentionService, dispose } = useMemo(
		() => plugin.createChatSessionDependencies(sessionKey),
		[plugin, sessionKey],
	);

	useEffect(() => {
		return dispose;
	}, [dispose]);

	const settings = useSettings(plugin);
	const resolveApiKeyForAgent = useCallback(
		(
			currentSettings: ReturnType<(typeof plugin.settingsStore)["getSnapshot"]>,
			agentId: string,
		): string =>
			plugin.getApiKeyForAgentId(agentId, currentSettings),
		[plugin],
	);
	const resolveSecretBindingEnvForAgent = useCallback(
		(
			currentSettings: ReturnType<(typeof plugin.settingsStore)["getSnapshot"]>,
			agentId: string,
		): Record<string, string> =>
			plugin.getSecretBindingEnvForAgentId(agentId, currentSettings),
		[plugin],
	);

	const agentSession = useAgentSession(
		agentClient,
		plugin.settingsStore,
		vaultPath,
		resolveApiKeyForAgent,
		resolveSecretBindingEnvForAgent,
		initialAgentId,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chat = useChat(
		agentClient,
		vaultAccess,
		mentionService,
		{
			sessionId: session.sessionId,
			authMethods: session.authMethods,
			promptCapabilities: session.promptCapabilities,
		},
		{
			windowsWslMode: settings.windowsWslMode,
			maxNoteLength: settings.displaySettings.maxNoteLength,
			maxSelectionLength: settings.displaySettings.maxSelectionLength,
		},
	);

	const { messages, isSending } = chat;

	// Ref to always read current messages (avoids stale closure in handleNewChat
	// when called via the tab-actions map, which may hold an older callback)
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	const [contextUsage, setContextUsage] = useState<{
		size: number;
		used: number;
	} | null>(null);

	const permission = usePermission(agentClient, messages);

	const mentions = useMentions(vaultAccess, plugin);
	const autoMention = useAutoMention(vaultAccess);
	const slashCommands = useSlashCommands(session.availableCommands || []);

	const {
		isLoadingSessionHistory,
		handleSessionLoad,
		handleLoadStart,
		handleLoadEnd,
	} = useHistoryLoadState({
		logger,
		updateSessionFromLoad: agentSession.updateSessionFromLoad,
		clearMessages: chat.clearMessages,
	});

	const sessionHistory = useSessionHistory({
		agentClient,
		session,
		settingsAccess: plugin.settingsStore,
		cwd: vaultPath,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: chat.setMessagesFromLocal,
		onLoadStart: handleLoadStart,
		onLoadEnd: handleLoadEnd,
	});

	const errorInfo = sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	const [inputValue, setInputValue] = useState("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	const activeAgentLabel = useMemo(
		() => resolveAgentDisplayName(plugin.settings, session.agentId),
		[session.agentId, plugin.settings],
	);

	const availableAgents = useMemo(() => {
		return plugin.getAvailableAgents();
	}, [plugin]);

	const handleSendMessage = useCallback(
		async (content: string, images?: ImagePromptContent[]) => {
			const isFirstMessage = messages.length === 0;

			await chat.sendMessage(content, {
				activeNote: autoMention.isDisabled ? null : autoMention.activeNote,
				vaultBasePath: vaultPath,
				isAutoMentionDisabled: autoMention.isDisabled,
				images,
			});

			if (isFirstMessage && session.sessionId) {
				await sessionHistory.saveSessionLocally(session.sessionId, content);
				logger.log(
					`[useChatController] Session saved locally: ${session.sessionId}`,
				);
			}
		},
		[
			chat,
			autoMention,
			plugin,
			messages.length,
			session.sessionId,
			sessionHistory,
			logger,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chat.lastUserMessage]);

	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const isAgentSwitch =
				requestedAgentId && requestedAgentId !== session.agentId;

			const hasInput = inputValue.trim() !== "" || attachedImages.length > 0;

			if (messagesRef.current.length === 0 && !isAgentSwitch && !hasInput) {
				pluginNotice("Already a new session");
				return;
			}

			if (chat.isSending) {
				await agentSession.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			autoMention.toggle(false);
			setInputValue("");
			setAttachedImages([]);
			setContextUsage(null);
			chat.clearMessages();

			const newAgentId = isAgentSwitch ? requestedAgentId : session.agentId;
			await agentSession.restartSession(newAgentId);

			sessionHistory.invalidateCache();
		},
		[
			session,
			logger,
			autoMention,
			chat,
			agentSession,
			sessionHistory,
			inputValue,
			attachedImages,
		],
	);

	const handleSwitchAgent = useCallback(
		async (agentId: string) => {
			if (agentId !== session.agentId) {
				await handleNewChat(agentId);
			}
		},
		[session.agentId, handleNewChat],
	);

	const handleRestartAgent = useCallback(async () => {
		logger.log("[useChatController] Restarting agent process...");

		chat.clearMessages();

		try {
			await agentSession.forceRestartAgent();
			pluginNotice("Agent restarted");
		} catch (error) {
			pluginNotice("Failed to restart agent");
			logger.error("Restart error:", error);
		}
	}, [logger, chat, agentSession]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	const {
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
		handleOpenHistory,
		handleCloseHistory,
		isHistoryPopoverOpen,
	} = useSessionHistoryHandlers({
		app: plugin.app,
		sessionHistory,
		logger,
		vaultPath,
		clearMessages: chat.clearMessages,
	});

	const handleSetMode = useCallback(
		async (modeId: string) => {
			await agentSession.setMode(modeId);

			if (!session.models || !session.agentId) return;

			const agentId = session.agentId;
			const modeDefaults = settings.modeModelDefaults?.[agentId];
			const lastModeModels = settings.lastModeModels?.[agentId];

			const targetModelId =
				modeDefaults?.[modeId] ??
				lastModeModels?.[modeId] ??
				session.models.availableModels[0]?.modelId;

			if (
				targetModelId &&
				targetModelId !== session.models.currentModelId &&
				session.models.availableModels.some((m) => m.modelId === targetModelId)
			) {
				logger.log(
					`[useChatController] Mode → model: switching to ${targetModelId} for mode ${modeId}`,
				);
				await agentSession.setModel(targetModelId);
			}
		},
		[
			agentSession,
			session.models,
			session.agentId,
			settings.modeModelDefaults,
			settings.lastModeModels,
			logger,
		],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			await agentSession.setModel(modelId);

			const agentId = session.agentId;
			const currentModeId = session.modes?.currentModeId;
			if (agentId && currentModeId) {
				void plugin.settingsStore.updateSettings({
					lastModeModels: {
						...settings.lastModeModels,
						[agentId]: {
							...settings.lastModeModels?.[agentId],
							[currentModeId]: modelId,
						},
					},
				});
			}
		},
		[
			agentSession,
			session.agentId,
			session.modes?.currentModeId,
			settings.lastModeModels,
			plugin.settingsStore,
		],
	);

	const filteredModels = useModelFiltering({
		sessionModels: session.models,
		agentId: session.agentId,
		sessionId: session.sessionId,
		candidateModels: settings.candidateModels,
		settingsAccess: plugin.settingsStore,
		setModel: agentSession.setModel,
	});

	useChatControllerEffects({
		logger,
		config,
		initialAgentId,
		isSessionReady,
		isLoadingSessionHistory,
		session,
		modeModelDefaults: settings.modeModelDefaults,
		lastModeModels: settings.lastModeModels,
		createSession: agentSession.createSession,
		setModel: agentSession.setModel,
		closeSession: agentSession.closeSession,
		updateAvailableCommands: agentSession.updateAvailableCommands,
		updateCurrentMode: agentSession.updateCurrentMode,
		handleSessionUpdate: chat.handleSessionUpdate,
		agentClient,
		setContextUsage,
		isSending,
		messages,
		saveSessionMessages: sessionHistory.saveSessionMessages,
		updateActiveNote: autoMention.updateActiveNote,
		vaultAccess,
	});

	return {
		logger,
		vaultPath,
		agentClient,
		vaultAccess,
		mentionService,

		settings,
		session,
		isSessionReady,
		messages,
		isSending,
		isLoadingSessionHistory,

		permission,
		mentions,
		autoMention,
		slashCommands,
		sessionHistory,

		activeAgentLabel,
		availableAgents,
		errorInfo,

		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleClearError,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
		handleOpenHistory,
		handleCloseHistory,
		isHistoryPopoverOpen,
		filteredModels,
		handleSetMode,
		handleSetModel,

		inputValue,
		setInputValue,
		attachedImages,
		setAttachedImages,
		restoredMessage,
		handleRestoredMessageConsumed,
		contextUsage,
	};
}
