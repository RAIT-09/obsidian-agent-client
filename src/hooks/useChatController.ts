import { useState, useRef, useEffect, useMemo, useCallback } from "react";

import type { AttachedImage } from "../components/chat/ImagePreviewStrip";
import { pluginNotice } from "../shared/plugin-notice";

import { NoteMentionService } from "../adapters/obsidian/mention-service";
import { getLogger } from "../shared/logger";
import { ObsidianVaultAdapter } from "../adapters/obsidian/vault.adapter";
import { resolveAgentDisplayName } from "../shared/agent-display-name";
import { getApiKeyForAgentId } from "../shared/secret-storage";
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

import type {
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";
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

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const sessionKey = viewId;
	const acpAdapter = useMemo(
		() => plugin.getOrCreateSessionAdapter(sessionKey),
		[plugin, sessionKey],
	);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	const settings = useSettings(plugin);
	const resolveApiKeyForAgent = useCallback(
		(
			currentSettings: ReturnType<(typeof plugin.settingsStore)["getSnapshot"]>,
			agentId: string,
		): string =>
			getApiKeyForAgentId(plugin.app.secretStorage, currentSettings, agentId),
		[plugin],
	);

	const agentSession = useAgentSession(
		acpAdapter,
		plugin.settingsStore,
		vaultPath,
		resolveApiKeyForAgent,
		initialAgentId,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chat = useChat(
		acpAdapter,
		vaultAccessAdapter,
		noteMentionService,
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

	const permission = usePermission(acpAdapter, messages);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const autoMention = useAutoMention(vaultAccessAdapter);
	const slashCommands = useSlashCommands(session.availableCommands || []);

	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			logger.log(
				`[useChatController] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
				},
			);
			agentSession.updateSessionFromLoad(sessionId, modes, models);
		},
		[logger, agentSession],
	);

	const [isLoadingSessionHistory, setIsLoadingSessionHistory] = useState(false);

	const handleLoadStart = useCallback(() => {
		logger.log(
			"[useChatController] session/load started, ignoring history replay",
		);
		setIsLoadingSessionHistory(true);
		chat.clearMessages();
	}, [logger, chat]);

	const handleLoadEnd = useCallback(() => {
		logger.log(
			"[useChatController] session/load ended, resuming normal processing",
		);
		setIsLoadingSessionHistory(false);
	}, [logger]);

	const sessionHistory = useSessionHistory({
		agentClient: acpAdapter,
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
			acpAdapter.forceDisconnectRuntime();
			await agentSession.forceRestartAgent();
			pluginNotice("Agent restarted");
		} catch (error) {
			pluginNotice("Failed to restart agent");
			logger.error("Restart error:", error);
		}
	}, [logger, chat, acpAdapter, agentSession]);

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

	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession(config?.agent || initialAgentId);
	}, [agentSession.createSession, config?.agent, initialAgentId]);

	useEffect(() => {
		if (config?.model && isSessionReady && session.models) {
			const modelExists = session.models.availableModels.some(
				(m) => m.modelId === config.model,
			);
			if (modelExists && session.models.currentModelId !== config.model) {
				logger.log(
					"[useChatController] Applying configured model:",
					config.model,
				);
				void agentSession.setModel(config.model);
			}
		}
	}, [
		config?.model,
		isSessionReady,
		session.models,
		agentSession.setModel,
		logger,
	]);

	const filteredModels = useModelFiltering({
		sessionModels: session.models,
		agentId: session.agentId,
		sessionId: session.sessionId,
		candidateModels: settings.candidateModels,
		settingsAccess: plugin.settingsStore,
		setModel: agentSession.setModel,
	});

	const closeSessionRef = useRef(agentSession.closeSession);
	closeSessionRef.current = agentSession.closeSession;

	useEffect(() => {
		return () => {
			logger.log("[useChatController] Cleanup: close session");
			void closeSessionRef.current();
		};
	}, [logger]);

	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			if (session.sessionId && update.sessionId !== session.sessionId) {
				logger.log(
					`[useChatController] Ignoring update for old session: ${update.sessionId} (current: ${session.sessionId})`,
				);
				return;
			}

			if (isLoadingSessionHistory) {
				if (update.type === "available_commands_update") {
					agentSession.updateAvailableCommands(update.commands);
				} else if (update.type === "current_mode_update") {
					agentSession.updateCurrentMode(update.currentModeId);
				}
				return;
			}

			if (update.type === "usage_update") {
				setContextUsage({ size: update.size, used: update.used });
				return;
			}

			chat.handleSessionUpdate(update);

			if (update.type === "available_commands_update") {
				agentSession.updateAvailableCommands(update.commands);
			} else if (update.type === "current_mode_update") {
				agentSession.updateCurrentMode(update.currentModeId);
			}
		});
	}, [
		acpAdapter,
		session.sessionId,
		logger,
		isLoadingSessionHistory,
		chat.handleSessionUpdate,
		agentSession.updateAvailableCommands,
		agentSession.updateCurrentMode,
	]);

	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	const prevIsSendingRef = useRef<boolean>(false);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		if (wasSending && !isSending && session.sessionId && messages.length > 0) {
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[useChatController] Session messages saved: ${session.sessionId}`,
			);
		}
	}, [isSending, session.sessionId, messages, sessionHistory, logger]);

	useEffect(() => {
		let isMounted = true;

		const refreshActiveNote = async () => {
			if (!isMounted) return;
			await autoMention.updateActiveNote();
		};

		const unsubscribe = vaultAccessAdapter.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [autoMention.updateActiveNote, vaultAccessAdapter]);

	return {
		logger,
		vaultPath,
		acpAdapter,
		vaultAccessAdapter,
		noteMentionService,

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
