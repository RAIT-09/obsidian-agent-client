import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Notice, FileSystemAdapter } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { AttachedImage } from "../components/chat/ImagePreviewStrip";
import { SessionHistoryModal } from "../components/chat/SessionHistoryModal";
import { ConfirmDeleteModal } from "../components/chat/ConfirmDeleteModal";

// Service imports
import { NoteMentionService } from "../adapters/obsidian/mention-service";
import { getLogger, Logger } from "../shared/logger";
import { ChatExporter } from "../shared/chat-exporter";
import { tApp } from "../shared/i18n";

// Adapter imports
import { ObsidianVaultAdapter } from "../adapters/obsidian/vault.adapter";
import type { IAcpClient } from "../adapters/acp/acp.adapter";

// Hooks imports
import { useSettings } from "./useSettings";
import { useMentions } from "./useMentions";
import { useSlashCommands } from "./useSlashCommands";
import { useAutoMention } from "./useAutoMention";
import { useAgentSession } from "./useAgentSession";
import { useChat } from "./useChat";
import { usePermission } from "./usePermission";
import { useAutoExport } from "./useAutoExport";
import { useSessionHistory } from "./useSessionHistory";

// Domain model imports
import type {
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";
import type { ImagePromptContent } from "../domain/models/prompt-content";

// Agent info for display (from plugin.getAvailableAgents())
interface AgentInfo {
	id: string;
	displayName: string;
}

export interface UseChatControllerOptions {
	plugin: AgentClientPlugin;
	viewId: string;
	workingDirectory?: string;
	initialAgentId?: string;
	// TODO(code-block): Configuration for future code block chat view
	config?: {
		agent?: string;
		model?: string;
	};
}

export interface UseChatControllerReturn {
	// Memoized services/adapters
	logger: Logger;
	vaultPath: string;
	acpAdapter: IAcpClient;
	vaultAccessAdapter: ObsidianVaultAdapter;
	noteMentionService: NoteMentionService;

	// Settings & State
	settings: ReturnType<typeof useSettings>;
	session: ReturnType<typeof useAgentSession>["session"];
	isSessionReady: boolean;
	messages: ReturnType<typeof useChat>["messages"];
	isSending: boolean;
	isUpdateAvailable: boolean;
	isLoadingSessionHistory: boolean;

	// Hook returns
	permission: ReturnType<typeof usePermission>;
	mentions: ReturnType<typeof useMentions>;
	autoMention: ReturnType<typeof useAutoMention>;
	slashCommands: ReturnType<typeof useSlashCommands>;
	sessionHistory: ReturnType<typeof useSessionHistory>;
	autoExport: ReturnType<typeof useAutoExport>;

	// Computed values
	activeAgentLabel: string;
	availableAgents: AgentInfo[];
	errorInfo:
		| ReturnType<typeof useChat>["errorInfo"]
		| ReturnType<typeof useAgentSession>["errorInfo"];

	// Core callbacks
	handleSendMessage: (
		content: string,
		images?: ImagePromptContent[],
	) => Promise<void>;
	handleStopGeneration: () => Promise<void>;
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleExportChat: () => Promise<void>;
	handleSwitchAgent: (agentId: string) => Promise<void>;
	handleRestartAgent: () => Promise<void>;
	handleClearError: () => void;
	handleRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	handleForkSession: (sessionId: string, cwd: string) => Promise<void>;
	handleDeleteSession: (sessionId: string) => void;
	handleOpenHistory: () => void;
	handleSetMode: (modeId: string) => Promise<void>;
	handleSetModel: (modelId: string) => Promise<void>;

	// Input state (for broadcast commands - sidebar only)
	inputValue: string;
	setInputValue: (value: string) => void;
	attachedImages: AttachedImage[];
	setAttachedImages: (images: AttachedImage[]) => void;
	restoredMessage: string | null;
	handleRestoredMessageConsumed: () => void;

	// History modal management
	historyModalRef: React.RefObject<SessionHistoryModal | null>;
}

export function useChatController(
	options: UseChatControllerOptions,
): UseChatControllerReturn {
	const { plugin, viewId, initialAgentId, config } = options;

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = getLogger();

	const vaultPath = useMemo(() => {
		if (options.workingDirectory) {
			return options.workingDirectory;
		}
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		// Fallback for non-FileSystemAdapter (e.g., mobile)
		return process.cwd();
	}, [plugin, options.workingDirectory]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	// Cleanup NoteMentionService when component unmounts
	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const acpAdapter = useMemo(
		() => plugin.getOrCreateAdapter(viewId),
		[plugin, viewId],
	);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agentSession = useAgentSession(
		acpAdapter,
		plugin.settingsStore,
		vaultPath,
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

	const permission = usePermission(acpAdapter, messages);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const autoMention = useAutoMention(vaultAccessAdapter);
	const slashCommands = useSlashCommands(
		session.availableCommands || [],
		autoMention.toggle,
	);

	const autoExport = useAutoExport(plugin);

	// Session history hook with callback for session load
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

	const [isLoadingSessionHistory, setIsLoadingSessionHistory] =
		useState(false);

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

	// Combined error info (session errors take precedence)
	const errorInfo =
		sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	// Input state (for broadcast commands - sidebar only)
	const [inputValue, setInputValue] = useState("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	// ============================================================
	// Refs
	// ============================================================
	const historyModalRef = useRef<SessionHistoryModal | null>(null);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
			);
		}
		if (activeId === plugin.settings.codex.id) {
			return (
				plugin.settings.codex.displayName || plugin.settings.codex.id
			);
		}
		if (activeId === plugin.settings.gemini.id) {
			return (
				plugin.settings.gemini.displayName || plugin.settings.gemini.id
			);
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, plugin.settings]);

	const availableAgents = useMemo(() => {
		return plugin.getAvailableAgents();
	}, [plugin]);

	// ============================================================
	// Callbacks
	// ============================================================
	const handleSendMessage = useCallback(
		async (content: string, images?: ImagePromptContent[]) => {
			const isFirstMessage = messages.length === 0;

			await chat.sendMessage(content, {
				activeNote: settings.autoMentionActiveNote
					? autoMention.activeNote
					: null,
				vaultBasePath: vaultPath,
				isAutoMentionDisabled: autoMention.isDisabled,
				images,
			});

			// Save session metadata locally on first message
			if (isFirstMessage && session.sessionId) {
				await sessionHistory.saveSessionLocally(
					session.sessionId,
					content,
				);
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
			settings.autoMentionActiveNote,
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

			// Skip if already empty AND not switching agents
			if (messages.length === 0 && !isAgentSwitch) {
				new Notice(tApp(plugin.app, "alreadyNewSession"));
				return;
			}

			// Cancel ongoing generation before starting new chat
			if (chat.isSending) {
				await agentSession.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExport.autoExportIfEnabled(
					"newChat",
					messages,
					session,
				);
			}

			autoMention.toggle(false);
			chat.clearMessages();

			const newAgentId = isAgentSwitch
				? requestedAgentId
				: session.agentId;
			await agentSession.restartSession(newAgentId);

			// Invalidate session history cache when creating new session
			sessionHistory.invalidateCache();
		},
		[
			messages,
			session,
			logger,
			autoExport,
			autoMention,
			chat,
			agentSession,
			sessionHistory,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice(tApp(plugin.app, "noMessagesToExport"));
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(tApp(plugin.app, "chatExportedTo", { path: filePath }));
		} catch (error) {
			new Notice(tApp(plugin.app, "failedExportChat"));
			logger.error("Export error:", error);
		}
	}, [messages, session, plugin, logger]);

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

		// Auto-export current chat before restart (if has messages)
		if (messages.length > 0) {
			await autoExport.autoExportIfEnabled("newChat", messages, session);
		}

		// Clear messages for fresh start
		chat.clearMessages();

		try {
			await agentSession.forceRestartAgent();
			new Notice(tApp(plugin.app, "agentRestarted"));
		} catch (error) {
			new Notice(tApp(plugin.app, "failedRestartAgent"));
			logger.error("Restart error:", error);
		}
	}, [logger, messages, session, autoExport, chat, agentSession]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Session History Modal Callbacks
	// ============================================================
	const handleRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(
					`[useChatController] Restoring session: ${sessionId}`,
				);
				chat.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice(tApp(plugin.app, "sessionRestored"));
			} catch (error) {
				new Notice(tApp(plugin.app, "failedRestoreSession"));
				logger.error("Session restore error:", error);
			}
		},
		[logger, chat, sessionHistory, plugin.app],
	);

	const handleForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[useChatController] Forking session: ${sessionId}`);
				chat.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice(tApp(plugin.app, "sessionForked"));
			} catch (error) {
				new Notice(tApp(plugin.app, "failedForkSession"));
				logger.error("Session fork error:", error);
			}
		},
		[logger, chat, sessionHistory, plugin.app],
	);

	const handleDeleteSession = useCallback(
		(sessionId: string) => {
			const targetSession = sessionHistory.sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const sessionTitle =
				targetSession?.title ?? tApp(plugin.app, "untitledSession");

			const confirmModal = new ConfirmDeleteModal(
				plugin.app,
				sessionTitle,
				async () => {
					try {
						logger.log(
							`[useChatController] Deleting session: ${sessionId}`,
						);
						await sessionHistory.deleteSession(sessionId);
						new Notice(tApp(plugin.app, "sessionDeleted"));
					} catch (error) {
						new Notice(tApp(plugin.app, "failedDeleteSession"));
						logger.error("Session delete error:", error);
					}
				},
			);
			confirmModal.open();
		},
		[plugin.app, sessionHistory, logger],
	);

	const handleLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory]);

	const handleFetchSessions = useCallback(
		(cwd?: string) => {
			void sessionHistory.fetchSessions(cwd);
		},
		[sessionHistory],
	);

	const handleOpenHistory = useCallback(() => {
		// Create modal if it doesn't exist
		if (!historyModalRef.current) {
			historyModalRef.current = new SessionHistoryModal(plugin.app, {
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
		historyModalRef.current.open();
		void sessionHistory.fetchSessions(vaultPath);
	}, [
		plugin.app,
		sessionHistory,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
	]);

	const handleSetMode = useCallback(
		async (modeId: string) => {
			await agentSession.setMode(modeId);
		},
		[agentSession],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			await agentSession.setModel(modelId);
		},
		[agentSession],
	);

	// Update modal props when session history state changes
	useEffect(() => {
		if (historyModalRef.current) {
			historyModalRef.current.updateProps({
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
	}, [
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.canList,
		sessionHistory.canRestore,
		sessionHistory.canFork,
		sessionHistory.isUsingLocalSessions,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleLoadMore,
		handleFetchSessions,
	]);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession(config?.agent || initialAgentId);
	}, [agentSession.createSession, config?.agent, initialAgentId]);

	// TODO(code-block): Apply configured model when session is ready
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

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExport);
	const closeSessionRef = useRef(agentSession.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExport;
	closeSessionRef.current = agentSession.closeSession;

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log(
				"[useChatController] Cleanup: auto-export and close session",
			);
			void (async () => {
				await autoExportRef.current.autoExportIfEnabled(
					"closeChat",
					messagesRef.current,
					sessionRef.current,
				);
				await closeSessionRef.current();
			})();
		};
	}, [logger]);

	// ============================================================
	// Effects - ACP Adapter Callbacks
	// ============================================================
	// Register unified session update callback
	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			// Filter by sessionId - ignore updates from old sessions
			if (session.sessionId && update.sessionId !== session.sessionId) {
				logger.log(
					`[useChatController] Ignoring update for old session: ${update.sessionId} (current: ${session.sessionId})`,
				);
				return;
			}

			// During session/load, ignore history replay messages but process session-level updates
			if (isLoadingSessionHistory) {
				// Only process session-level updates during load
				if (update.type === "available_commands_update") {
					agentSession.updateAvailableCommands(update.commands);
				} else if (update.type === "current_mode_update") {
					agentSession.updateCurrentMode(update.currentModeId);
				}
				// Ignore all message-related updates (history replay)
				return;
			}

			// Route message-related updates to useChat
			chat.handleSessionUpdate(update);

			// Route session-level updates to useAgentSession
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

	// Register updateMessage callback for permission UI updates
	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	// ============================================================
	// Effects - Update Check
	// ============================================================
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((error) => {
				logger.error("Failed to check for updates:", error);
			});
	}, [plugin, logger]);

	// ============================================================
	// Effects - Save Session Messages on Turn End
	// ============================================================
	const prevIsSendingRef = useRef<boolean>(false);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		// Save when turn ends (isSending: true → false) and has messages
		if (
			wasSending &&
			!isSending &&
			session.sessionId &&
			messages.length > 0
		) {
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[useChatController] Session messages saved: ${session.sessionId}`,
			);
		}
	}, [isSending, session.sessionId, messages, sessionHistory, logger]);

	// ============================================================
	// Effects - Auto-mention Active Note Tracking
	// ============================================================
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

	// ============================================================
	// Return
	// ============================================================
	return {
		// Services & Adapters
		logger,
		vaultPath,
		acpAdapter,
		vaultAccessAdapter,
		noteMentionService,

		// Settings & State
		settings,
		session,
		isSessionReady,
		messages,
		isSending,
		isUpdateAvailable,
		isLoadingSessionHistory,

		// Hook returns
		permission,
		mentions,
		autoMention,
		slashCommands,
		sessionHistory,
		autoExport,

		// Computed values
		activeAgentLabel,
		availableAgents,
		errorInfo,

		// Core callbacks
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleClearError,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleOpenHistory,
		handleSetMode,
		handleSetModel,

		// Input state
		inputValue,
		setInputValue,
		attachedImages,
		setAttachedImages,
		restoredMessage,
		handleRestoredMessageConsumed,

		// History modal management
		historyModalRef,
	};
}
