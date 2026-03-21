import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Notice, FileSystemAdapter, Platform } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { AttachedFile } from "../types/chat";
import { SessionHistoryModal } from "../ui/SessionHistoryModal";
import { ConfirmDeleteModal } from "../ui/ConfirmDeleteModal";

// Service imports
import { getLogger, Logger } from "../utils/logger";
import { ChatExporter } from "../services/chat-exporter";

// Adapter imports
import { VaultService } from "../services/vault-service";
import type { ITerminalClient } from "../acp/acp-client";

// Hooks imports
import { useSettings } from "./useSettings";
import { useMentions } from "./useMentions";
import { useSlashCommands } from "./useSlashCommands";
import { useSession } from "./useSession";
import { useMessages } from "./useMessages";
import { usePermission } from "./usePermission";
import { useSessionHistory } from "./useSessionHistory";

// Domain model imports
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
	SessionConfigOption,
	SessionConfigSelectOption,
	SessionConfigSelectGroup,
} from "../types/session";
import type {
	ChatMessage,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import { buildFileUri } from "../utils/path-utils";
import { convertWindowsPathToWsl } from "../utils/platform";
import type { AgentUpdateNotification } from "../services/update-checker";
import { checkAgentUpdate } from "../services/update-checker";

function flattenConfigSelectOptions(
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
	if (options.length === 0) return [];
	if ("value" in options[0]) return options as SessionConfigSelectOption[];
	return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
}

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
	terminalClient: ITerminalClient;
	vaultService: VaultService;

	// Settings & State
	settings: ReturnType<typeof useSettings>;
	session: ReturnType<typeof useSession>["session"];
	isSessionReady: boolean;
	messages: ReturnType<typeof useMessages>["messages"];
	isSending: boolean;
	isUpdateAvailable: boolean;
	isLoadingSessionHistory: boolean;

	// Hook returns
	permission: ReturnType<typeof usePermission>;
	mentions: ReturnType<typeof useMentions>;
	slashCommands: ReturnType<typeof useSlashCommands>;
	sessionHistory: ReturnType<typeof useSessionHistory>;
	exportChat: (
		messages: ChatMessage[],
		session: ChatSession,
	) => Promise<string | null>;

	// Computed values
	activeAgentLabel: string;
	availableAgents: AgentInfo[];
	errorInfo:
		| ReturnType<typeof useMessages>["errorInfo"]
		| ReturnType<typeof useSession>["errorInfo"];
	agentUpdateNotification: AgentUpdateNotification | null;

	// Core callbacks
	handleSendMessage: (
		content: string,
		attachments?: AttachedFile[],
	) => Promise<void>;
	handleStopGeneration: () => Promise<void>;
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleExportChat: () => Promise<void>;
	handleSwitchAgent: (agentId: string) => Promise<void>;
	handleRestartAgent: () => Promise<void>;
	handleClearError: () => void;
	handleClearAgentUpdate: () => void;
	handleRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	handleForkSession: (sessionId: string, cwd: string) => Promise<void>;
	handleDeleteSession: (sessionId: string) => void;
	handleOpenHistory: () => void;
	handleSetMode: (modeId: string) => Promise<void>;
	handleSetModel: (modelId: string) => Promise<void>;
	handleSetConfigOption: (configId: string, value: string) => Promise<void>;

	// Input state (for broadcast commands - sidebar only)
	inputValue: string;
	setInputValue: (value: string) => void;
	attachedFiles: AttachedFile[];
	setAttachedFiles: (files: AttachedFile[]) => void;
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

	const vaultService = useMemo(() => new VaultService(plugin), [plugin]);

	// Cleanup VaultService when component unmounts
	useEffect(() => {
		return () => {
			vaultService.destroy();
		};
	}, [vaultService]);

	const acpAdapter = useMemo(
		() => plugin.getOrCreateAdapter(viewId),
		[plugin, viewId],
	);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agentSession = useSession(
		acpAdapter,
		plugin.settingsService,
		vaultPath,
		initialAgentId,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chatMessages = useMessages(
		acpAdapter,
		vaultService,
		vaultService,
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

	const { messages, isSending } = chatMessages;

	const permission = usePermission(acpAdapter, messages);

	const mentions = useMentions(vaultService, plugin);
	
	const slashCommands = useSlashCommands(
		session.availableCommands || [],
		mentions.toggleAutoMention,
	);

	const autoExportIfEnabled = useCallback(
		async (
			trigger: "newChat" | "closeChat",
			triggerMessages: ChatMessage[],
			triggerSession: ChatSession,
		): Promise<void> => {
			const isEnabled =
				trigger === "newChat"
					? plugin.settings.exportSettings.autoExportOnNewChat
					: plugin.settings.exportSettings.autoExportOnCloseChat;
			if (!isEnabled) return;
			if (triggerMessages.length === 0) return;
			if (!triggerSession.sessionId) return;

			try {
				const exporter = new ChatExporter(plugin);
				const filePath = await exporter.exportToMarkdown(
					triggerMessages,
					triggerSession.agentDisplayName,
					triggerSession.agentId,
					triggerSession.sessionId,
					triggerSession.createdAt,
					false,
				);
				if (filePath) {
					const context =
						trigger === "newChat"
							? "new session"
							: "closing chat";
					new Notice(
						`[Agent Client] Chat exported to ${filePath}`,
					);
					logger.log(`Chat auto-exported before ${context}`);
				}
			} catch {
				new Notice("[Agent Client] Failed to export chat");
			}
		},
		[plugin, logger],
	);

	const exportChat = useCallback(
		async (
			exportMessages: ChatMessage[],
			exportSession: ChatSession,
		): Promise<string | null> => {
			if (exportMessages.length === 0) return null;
			if (!exportSession.sessionId) return null;
			try {
				const exporter = new ChatExporter(plugin);
				const openFile =
					plugin.settings.exportSettings.openFileAfterExport;
				return await exporter.exportToMarkdown(
					exportMessages,
					exportSession.agentDisplayName,
					exportSession.agentId,
					exportSession.sessionId,
					exportSession.createdAt,
					openFile,
				);
			} catch (error) {
				logger.error("Export failed:", error);
				throw error;
			}
		},
		[plugin, logger],
	);

	// Session history hook with callback for session load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			logger.log(
				`[useChatController] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
					configOptions,
				},
			);
			agentSession.updateSessionFromLoad(
				sessionId,
				modes,
				models,
				configOptions,
			);
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
		chatMessages.clearMessages();
	}, [logger, chatMessages]);

	const handleLoadEnd = useCallback(() => {
		logger.log(
			"[useChatController] session/load ended, resuming normal processing",
		);
		setIsLoadingSessionHistory(false);
	}, [logger]);

	const sessionHistory = useSessionHistory({
		agentClient: acpAdapter,
		session,
		settingsAccess: plugin.settingsService,
		cwd: vaultPath,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: chatMessages.setMessagesFromLocal,
		onLoadStart: handleLoadStart,
		onLoadEnd: handleLoadEnd,
	});

	// Combined error info (session errors take precedence)
	const errorInfo =
		sessionErrorInfo || chatMessages.errorInfo || permission.errorInfo;

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [agentUpdateNotification, setAgentUpdateNotification] =
		useState<AgentUpdateNotification | null>(null);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	// Input state (for broadcast commands - sidebar only)
	const [inputValue, setInputValue] = useState("");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

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
	const shouldConvertToWsl = Platform.isWin && settings.windowsWslMode;

	const handleSendMessage = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			// Dismiss overlays on send
			chatMessages.clearError();
			setAgentUpdateNotification(null);

			const isFirstMessage = messages.length === 0;

			// Split attachments by kind
			const images: ImagePromptContent[] = [];
			const resourceLinks: ResourceLinkPromptContent[] = [];

			if (attachments) {
				for (const file of attachments) {
					if (file.kind === "image" && file.data) {
						images.push({
							type: "image",
							data: file.data,
							mimeType: file.mimeType,
						});
					} else if (file.kind === "file" && file.path) {
						let filePath = file.path;
						if (shouldConvertToWsl) {
							filePath = convertWindowsPathToWsl(filePath);
						}
						resourceLinks.push({
							type: "resource_link",
							uri: buildFileUri(filePath),
							name:
								file.name ??
								file.path.split("/").pop() ??
								"file",
							mimeType: file.mimeType || undefined,
							size: file.size,
						});
					}
				}
			}

			await chatMessages.sendMessage(content, {
				activeNote: settings.autoMentionActiveNote
					? mentions.activeNote
					: null,
				vaultBasePath: vaultPath,
				isAutoMentionDisabled: mentions.isAutoMentionDisabled,
				images: images.length > 0 ? images : undefined,
				resourceLinks:
					resourceLinks.length > 0 ? resourceLinks : undefined,
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
			chatMessages,
			messages.length,
			session.sessionId,
			sessionHistory,
			logger,
			settings.autoMentionActiveNote,
			shouldConvertToWsl,
			vaultPath,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		const lastMessage = chatMessages.lastUserMessage;
		await agentSession.cancelOperation();
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chatMessages.lastUserMessage]);

	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const isAgentSwitch =
				requestedAgentId && requestedAgentId !== session.agentId;

			// Skip if already empty AND not switching agents
			if (messages.length === 0 && !isAgentSwitch) {
				new Notice("[Agent Client] Already a new session");
				return;
			}

			// Cancel ongoing generation before starting new chat
			if (chatMessages.isSending) {
				await agentSession.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExportIfEnabled("newChat", messages, session);
			}

			mentions.toggleAutoMention(false);
			chatMessages.clearMessages();

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
			autoExportIfEnabled,
			chatMessages,
			agentSession,
			sessionHistory,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] No messages to export");
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
			new Notice(`[Agent Client] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[Agent Client] Failed to export chat");
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
			await autoExportIfEnabled("newChat", messages, session);
		}

		// Clear messages for fresh start
		chatMessages.clearMessages();

		try {
			await agentSession.forceRestartAgent();
			new Notice("[Agent Client] Agent restarted");
		} catch (error) {
			new Notice("[Agent Client] Failed to restart agent");
			logger.error("Restart error:", error);
		}
	}, [logger, messages, session, autoExportIfEnabled, chatMessages, agentSession]);

	const handleClearError = useCallback(() => {
		chatMessages.clearError();
	}, [chatMessages]);

	const handleClearAgentUpdate = useCallback(() => {
		setAgentUpdateNotification(null);
	}, []);

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
				chatMessages.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice("[Agent Client] Session restored");
			} catch (error) {
				new Notice("[Agent Client] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger, chatMessages, sessionHistory],
	);

	const handleForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[useChatController] Forking session: ${sessionId}`);
				chatMessages.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice("[Agent Client] Session forked");
			} catch (error) {
				new Notice("[Agent Client] Failed to fork session");
				logger.error("Session fork error:", error);
			}
		},
		[logger, chatMessages, sessionHistory],
	);

	const handleDeleteSession = useCallback(
		(sessionId: string) => {
			const targetSession = sessionHistory.sessions.find(
				(s) => s.sessionId === sessionId,
			);
			const sessionTitle = targetSession?.title ?? "Untitled Session";

			const confirmModal = new ConfirmDeleteModal(
				plugin.app,
				sessionTitle,
				async () => {
					try {
						logger.log(
							`[useChatController] Deleting session: ${sessionId}`,
						);
						await sessionHistory.deleteSession(sessionId);
						new Notice("[Agent Client] Session deleted");
					} catch (error) {
						new Notice("[Agent Client] Failed to delete session");
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

	const handleSetConfigOption = useCallback(
		async (configId: string, value: string) => {
			await agentSession.setConfigOption(configId, value);
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
		logger.log("[Debug] Starting connection setup via useSession...");
		void agentSession.createSession(config?.agent || initialAgentId);
	}, [agentSession.createSession, config?.agent, initialAgentId]);

	// Apply configured model when session is ready
	useEffect(() => {
		if (!config?.model || !isSessionReady) return;

		// Prefer configOptions if available
		if (session.configOptions) {
			const modelOption = session.configOptions.find(
				(o) => o.category === "model",
			);
			if (modelOption && modelOption.currentValue !== config.model) {
				const valueExists = flattenConfigSelectOptions(
					modelOption.options,
				).some((o) => o.value === config.model);
				if (valueExists) {
					logger.log(
						"[useChatController] Applying configured model via configOptions:",
						config.model,
					);
					void agentSession.setConfigOption(
						modelOption.id,
						config.model,
					);
				}
			}
			return;
		}

		// Fallback to legacy models
		if (session.models) {
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
		session.configOptions,
		session.models,
		agentSession.setConfigOption,
		agentSession.setModel,
		logger,
	]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExportIfEnabled);
	const closeSessionRef = useRef(agentSession.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExportIfEnabled;
	closeSessionRef.current = agentSession.closeSession;

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log(
				"[useChatController] Cleanup: auto-export and close session",
			);
			void (async () => {
				await autoExportRef.current(
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
				} else if (update.type === "config_option_update") {
					agentSession.updateConfigOptions(update.configOptions);
				} else if (update.type === "usage_update") {
					agentSession.updateUsage({
						used: update.used,
						size: update.size,
						cost: update.cost ?? undefined,
					});
				}
				// Ignore all message-related updates (history replay)
				return;
			}

			// Route message-related updates to useMessages
			chatMessages.handleSessionUpdate(update);

			// Route session-level updates to useSession
			if (update.type === "available_commands_update") {
				agentSession.updateAvailableCommands(update.commands);
			} else if (update.type === "current_mode_update") {
				agentSession.updateCurrentMode(update.currentModeId);
			} else if (update.type === "config_option_update") {
				agentSession.updateConfigOptions(update.configOptions);
			} else if (update.type === "usage_update") {
				agentSession.updateUsage({
					used: update.used,
					size: update.size,
					cost: update.cost ?? undefined,
				});
			}
		});
	}, [
		acpAdapter,
		session.sessionId,
		logger,
		isLoadingSessionHistory,
		chatMessages.handleSessionUpdate,
		agentSession.updateAvailableCommands,
		agentSession.updateCurrentMode,
	]);

	// Register updateMessage callback for permission UI updates
	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chatMessages.updateMessage);
	}, [acpAdapter, chatMessages.updateMessage]);

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
	// Effects - Agent Update Check
	// ============================================================
	useEffect(() => {
		if (!isSessionReady || !session.agentInfo?.name) {
			return;
		}

		checkAgentUpdate(
			session.agentInfo as { name: string; version?: string },
		)
			.then(setAgentUpdateNotification)
			.catch((error) => {
				logger.error("Failed to check agent update:", error);
			});
	}, [isSessionReady, session.agentInfo, logger]);

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
			await mentions.updateActiveNote();
		};

		const unsubscribe = vaultService.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [mentions.updateActiveNote, vaultService]);

	// ============================================================
	// Return
	// ============================================================
	return {
		// Services & Adapters
		logger,
		vaultPath,
		terminalClient: acpAdapter,
		vaultService,

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
		slashCommands,
		sessionHistory,
		exportChat,

		// Computed values
		activeAgentLabel,
		availableAgents,
		errorInfo,
		agentUpdateNotification,

		// Core callbacks
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleOpenHistory,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,

		// Input state
		inputValue,
		setInputValue,
		attachedFiles,
		setAttachedFiles,
		restoredMessage,
		handleRestoredMessageConsumed,

		// History modal management
		historyModalRef,
	};
}
