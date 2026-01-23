import { ItemView, WorkspaceLeaf, Platform, Notice } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../plugin";
import type { ChatInputState } from "../../domain/models/chat-input-state";

// Component imports
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { AttachedImage } from "./ImagePreviewStrip";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { HeaderMenu } from "./HeaderMenu";

// Service imports
import { NoteMentionService } from "../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../shared/logger";
import { ChatExporter } from "../../shared/chat-exporter";

// Adapter imports
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../../adapters/obsidian/vault.adapter";

// Hooks imports
import { useSettings } from "../../hooks/useSettings";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAutoMention } from "../../hooks/useAutoMention";
import { useAgentSession } from "../../hooks/useAgentSession";
import { useChat } from "../../hooks/useChat";
import { usePermission } from "../../hooks/usePermission";
import { useAutoExport } from "../../hooks/useAutoExport";
import { useSessionHistory } from "../../hooks/useSessionHistory";

// Domain model imports
import type {
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { ImagePromptContent } from "../../domain/models/prompt-content";

// Type definitions for Obsidian internal APIs
interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

function ChatComponent({
	plugin,
	view,
	viewId,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
}) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

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

	// Track this view as the last active when it receives focus or interaction
	useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = view.containerEl;
		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		// Set as active on mount (first opened view becomes active)
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, view.containerEl]);

	const acpAdapter = useMemo(
		() => plugin.getOrCreateAdapter(viewId),
		[plugin, viewId],
	);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	// ============================================================
	// Agent ID State (synced with Obsidian view state)
	// ============================================================
	// Start with view's current value (may be null on initial mount before setState)
	const [restoredAgentId, setRestoredAgentId] = useState<string | undefined>(
		view.getInitialAgentId() ?? undefined,
	);

	// Subscribe to agentId restoration from Obsidian's setState
	useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			logger.log(
				`[ChatView] Agent ID restored from workspace: ${agentId}`,
			);
			setRestoredAgentId(agentId);
		});
		return unsubscribe;
	}, [view, logger]);

	const agentSession = useAgentSession(
		acpAdapter,
		plugin.settingsStore,
		vaultPath,
		restoredAgentId,
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
	// Session load callback - called when a session is loaded/resumed/forked from history
	// Note: Conversation history is received via session/update notifications for load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			// Log that session was loaded
			logger.log(
				`[ChatView] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
				},
			);

			// Update session state with new session ID and modes/models
			// This is critical for session/update notifications to be accepted
			agentSession.updateSessionFromLoad(sessionId, modes, models);

			// Conversation history for load is received via session/update notifications
			// but we ignore them and use local history instead (see handleLoadStart/handleLoadEnd)
		},
		[logger, agentSession],
	);

	/**
	 * Called when session/load starts.
	 * Sets flag to ignore history replay messages from agent.
	 */
	const handleLoadStart = useCallback(() => {
		logger.log("[ChatView] session/load started, ignoring history replay");
		setIsLoadingSessionHistory(true);
		// Clear existing messages before loading local history
		chat.clearMessages();
	}, [logger, chat]);

	/**
	 * Called when session/load ends.
	 * Clears flag to resume normal message processing.
	 */
	const handleLoadEnd = useCallback(() => {
		logger.log("[ChatView] session/load ended, resuming normal processing");
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
	/** Flag to ignore history replay messages during session/load */
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] =
		useState(false);
	/** Whether the settings menu is open */
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	// ============================================================
	// Input State (lifted from ChatInput for broadcast commands)
	// ============================================================
	const [inputValue, setInputValue] = useState("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	// ============================================================
	// Refs
	// ============================================================
	/** Ref for session history modal (persisted across renders) */
	const historyModalRef = useRef<SessionHistoryModal | null>(null);
	/** Ref for settings button (for menu positioning) */
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	/** Track if initial agent restoration has been performed (prevent re-triggering) */
	const hasRestoredAgentRef = useRef(false);

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

	// ============================================================
	// Callbacks
	// ============================================================
	/**
	 * Handle new chat request.
	 * @param requestedAgentId - If provided, switch to this agent (from "New chat with [Agent]" command)
	 */
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

			// Persist agent ID for this view (survives Obsidian restart)
			if (newAgentId) {
				view.setAgentId(newAgentId);
			}

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
			view,
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

	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	// ============================================================
	// Header Menu Callbacks
	// ============================================================
	const handleToggleMenu = useCallback(() => {
		setIsMenuOpen((prev) => !prev);
	}, []);

	const handleCloseMenu = useCallback(() => {
		setIsMenuOpen(false);
	}, []);

	const handleSwitchAgent = useCallback(
		(agentId: string) => {
			setIsMenuOpen(false);
			if (agentId !== session.agentId) {
				void handleNewChat(agentId);
			}
		},
		[session.agentId, handleNewChat],
	);

	const handleOpenNewView = useCallback(() => {
		setIsMenuOpen(false);
		void plugin.openNewChatViewWithAgent(plugin.settings.defaultAgentId);
	}, [plugin]);

	/** Get available agents for settings menu */
	const availableAgents = useMemo(() => {
		return plugin.getAvailableAgents();
	}, [plugin]);

	// ============================================================
	// Session History Modal Callbacks
	// ============================================================
	const handleHistoryRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatView] Restoring session: ${sessionId}`);
				chat.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice("[Agent Client] Session restored");
			} catch (error) {
				new Notice("[Agent Client] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger, chat, sessionHistory],
	);

	const handleHistoryForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatView] Forking session: ${sessionId}`);
				chat.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice("[Agent Client] Session forked");
			} catch (error) {
				new Notice("[Agent Client] Failed to fork session");
				logger.error("Session fork error:", error);
			}
		},
		[logger, chat, sessionHistory],
	);

	const handleHistoryDeleteSession = useCallback(
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
						logger.log(`[ChatView] Deleting session: ${sessionId}`);
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

	const handleHistoryLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory]);

	const handleHistoryFetchSessions = useCallback(
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
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleHistoryRestoreSession,
				onForkSession: handleHistoryForkSession,
				onDeleteSession: handleHistoryDeleteSession,
				onLoadMore: handleHistoryLoadMore,
				onFetchSessions: handleHistoryFetchSessions,
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
		handleHistoryRestoreSession,
		handleHistoryForkSession,
		handleHistoryDeleteSession,
		handleHistoryLoadMore,
		handleHistoryFetchSessions,
	]);

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
				isAgentReady: isSessionReady,
				debugMode: settings.debugMode,
				onRestoreSession: handleHistoryRestoreSession,
				onForkSession: handleHistoryForkSession,
				onDeleteSession: handleHistoryDeleteSession,
				onLoadMore: handleHistoryLoadMore,
				onFetchSessions: handleHistoryFetchSessions,
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
		handleHistoryRestoreSession,
		handleHistoryForkSession,
		handleHistoryDeleteSession,
		handleHistoryLoadMore,
		handleHistoryFetchSessions,
	]);

	const handleSendMessage = useCallback(
		async (content: string, images?: ImagePromptContent[]) => {
			const isFirstMessage = messages.length === 0;

			await chat.sendMessage(content, {
				activeNote: autoMention.activeNote,
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
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
					`[ChatView] Session saved locally: ${session.sessionId}`,
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
		// Save last user message before cancel (to restore it)
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		// Restore the last user message to input field
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chat.lastUserMessage]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Broadcast Command Callbacks
	// ============================================================
	/** Get current input state for broadcast commands */
	const getInputState = useCallback((): ChatInputState | null => {
		return {
			text: inputValue,
			images: attachedImages,
		};
	}, [inputValue, attachedImages]);

	/** Set input state from broadcast commands */
	const setInputState = useCallback((state: ChatInputState) => {
		setInputValue(state.text);
		setAttachedImages(state.images);
	}, []);

	/** Send message for broadcast commands (returns true if sent) */
	const sendMessageForBroadcast = useCallback(async (): Promise<boolean> => {
		// Allow sending if there's text OR images
		if (!inputValue.trim() && attachedImages.length === 0) {
			return false;
		}
		if (!isSessionReady || sessionHistory.loading) {
			return false;
		}
		if (isSending) {
			return false;
		}

		// Convert attached images to ImagePromptContent format
		const imagesToSend: ImagePromptContent[] = attachedImages.map(
			(img) => ({
				type: "image",
				data: img.data,
				mimeType: img.mimeType,
			}),
		);

		// Clear input before sending
		const messageToSend = inputValue.trim();
		setInputValue("");
		setAttachedImages([]);

		await handleSendMessage(
			messageToSend,
			imagesToSend.length > 0 ? imagesToSend : undefined,
		);
		return true;
	}, [
		inputValue,
		attachedImages,
		isSessionReady,
		sessionHistory.loading,
		isSending,
		handleSendMessage,
	]);

	/** Check if this view can send a message */
	const canSendForBroadcast = useCallback((): boolean => {
		const hasContent =
			inputValue.trim() !== "" || attachedImages.length > 0;
		return (
			hasContent &&
			isSessionReady &&
			!sessionHistory.loading &&
			!isSending
		);
	}, [
		inputValue,
		attachedImages,
		isSessionReady,
		sessionHistory.loading,
		isSending,
	]);

	/** Cancel current operation for broadcast commands */
	const cancelForBroadcast = useCallback(async (): Promise<void> => {
		if (isSending) {
			await handleStopGeneration();
		}
	}, [isSending, handleStopGeneration]);

	// Register callbacks with ChatView class for broadcast commands
	useEffect(() => {
		view.registerInputCallbacks({
			getInputState,
			setInputState,
			sendMessage: sendMessageForBroadcast,
			canSend: canSendForBroadcast,
			cancel: cancelForBroadcast,
		});

		return () => {
			view.unregisterInputCallbacks();
		};
	}, [
		view,
		getInputState,
		setInputState,
		sendMessageForBroadcast,
		canSendForBroadcast,
		cancelForBroadcast,
	]);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession(restoredAgentId);
	}, [agentSession.createSession, restoredAgentId]);

	// Re-create session when agentId is restored from workspace state
	// This handles the case where setState() is called after onOpen()
	// Only runs ONCE for initial restoration (prevents re-triggering on agent switch)
	useEffect(() => {
		// Only run once for initial restoration
		if (hasRestoredAgentRef.current) {
			return;
		}

		// Skip if no restored agentId (initial mount with null)
		if (!restoredAgentId) {
			return;
		}

		// Skip if session is still initializing (wait for it to be ready)
		if (session.state === "initializing") {
			return;
		}

		// Mark as handled once we can make a decision
		hasRestoredAgentRef.current = true;

		// Skip if already using the correct agent
		if (session.agentId === restoredAgentId) {
			return;
		}

		logger.log(
			`[ChatView] Switching to restored agent: ${restoredAgentId} (current: ${session.agentId})`,
		);
		void agentSession.restartSession(restoredAgentId);
	}, [restoredAgentId, session.state, session.agentId, agentSession, logger]);

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
			logger.log("[ChatView] Cleanup: auto-export and close session");
			// Use refs to get latest values (avoid stale closures)
			void (async () => {
				await autoExportRef.current.autoExportIfEnabled(
					"closeChat",
					messagesRef.current,
					sessionRef.current,
				);
				await closeSessionRef.current();
			})();
		};
		// Empty dependency array - only run on unmount
	}, []);

	// Note: Previously monitored settings.activeAgentId to auto-switch agents.
	// Removed for multi-session support - each view manages its own agentId locally.
	// Agent switching is now done explicitly via Settings Menu.

	// ============================================================
	// Effects - ACP Adapter Callbacks
	// ============================================================
	// Register unified session update callback
	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			// Filter by sessionId - ignore updates from old sessions
			if (session.sessionId && update.sessionId !== session.sessionId) {
				logger.log(
					`[ChatView] Ignoring update for old session: ${update.sessionId} (current: ${session.sessionId})`,
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
				console.error("Failed to check for updates:", error);
			});
	}, [plugin]);

	// ============================================================
	// Effects - Save Session Messages on Turn End
	// ============================================================
	// Track previous isSending state to detect turn completion
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
			// Fire-and-forget save via sessionHistory hook
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[ChatView] Session messages saved: ${session.sessionId}`,
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
	// Effects - Workspace Events (Hotkeys)
	// ============================================================
	// Custom event type with targetViewId parameter
	type CustomEventCallback = (targetViewId?: string) => void;

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:toggle-auto-mention", (targetViewId?: string) => {
			// Only respond if this view is the target (or no target specified)
			if (targetViewId && targetViewId !== viewId) {
				return;
			}
			autoMention.toggle();
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, autoMention.toggle, viewId]);

	// Handle new chat request from plugin commands (e.g., "New chat with [Agent]")
	useEffect(() => {
		const workspace = plugin.app.workspace;

		// Cast to any to bypass Obsidian's type constraints for custom events
		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:new-chat-requested", (agentId?: string) => {
			// Note: new-chat-requested targets the last active view, which is handled
			// by plugin.lastActiveChatViewId - only respond if we are that view
			if (
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			void handleNewChat(agentId);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		handleNewChat,
		viewId,
	]);

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const approveRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:approve-active-permission",
			(targetViewId?: string) => {
				// Only respond if this view is the target (or no target specified)
				if (targetViewId && targetViewId !== viewId) {
					return;
				}
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		const rejectRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:reject-active-permission",
			(targetViewId?: string) => {
				// Only respond if this view is the target (or no target specified)
				if (targetViewId && targetViewId !== viewId) {
					return;
				}
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		const cancelRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:cancel-message", (targetViewId?: string) => {
			// Only respond if this view is the target (or no target specified)
			if (targetViewId && targetViewId !== viewId) {
				return;
			}
			void handleStopGeneration();
		});

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
		handleStopGeneration,
		viewId,
	]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div className="agent-client-chat-view-container">
			<ChatHeader
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				hasHistoryCapability={sessionHistory.canShowSessionHistory}
				onNewChat={() => void handleNewChat()}
				onExportChat={() => void handleExportChat()}
				onToggleMenu={handleToggleMenu}
				onOpenHistory={handleOpenHistory}
				menuButtonRef={menuButtonRef}
			/>

			{isMenuOpen && (
				<HeaderMenu
					anchorRef={menuButtonRef}
					currentAgentId={session.agentId || ""}
					availableAgents={availableAgents}
					onSwitchAgent={handleSwitchAgent}
					onOpenNewView={handleOpenNewView}
					onOpenPluginSettings={handleOpenSettings}
					onClose={handleCloseMenu}
					plugin={plugin}
					view={view}
				/>
			)}

			<ChatMessages
				messages={messages}
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				autoMentionEnabled={settings.autoMentionActiveNote}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
				modes={session.modes}
				onModeChange={(modeId) => void agentSession.setMode(modeId)}
				models={session.models}
				onModelChange={(modelId) => void agentSession.setModel(modelId)}
				supportsImages={session.promptCapabilities?.image ?? false}
				agentId={session.agentId}
				// Controlled component props (for broadcast commands)
				inputValue={inputValue}
				onInputChange={setInputValue}
				attachedImages={attachedImages}
				onAttachedImagesChange={setAttachedImages}
				// Error overlay props
				errorInfo={errorInfo}
				onClearError={handleClearError}
			/>
		</div>
	);
}

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

// Callback types for input state access (broadcast commands)
type GetInputStateCallback = () => ChatInputState | null;
type SetInputStateCallback = (state: ChatInputState) => void;
type SendMessageCallback = () => Promise<boolean>;
type CanSendCallback = () => boolean;
type CancelCallback = () => Promise<void>;

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	/** Unique identifier for this view instance (for multi-session support) */
	readonly viewId: string;
	/** Initial agent ID passed via state (for openNewChatViewWithAgent) */
	private initialAgentId: string | null = null;
	/** Callbacks to notify React when agentId is restored from workspace state */
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> =
		new Set();

	// Callbacks for input state access (broadcast commands)
	private getInputStateCallback: GetInputStateCallback | null = null;
	private setInputStateCallback: SetInputStateCallback | null = null;
	private sendMessageCallback: SendMessageCallback | null = null;
	private canSendCallback: CanSendCallback | null = null;
	private cancelCallback: CancelCallback | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = new Logger(plugin);
		// Use leaf.id if available, otherwise generate UUID
		this.viewId = (leaf as { id?: string }).id ?? crypto.randomUUID();
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Agent client";
	}

	getIcon() {
		return "bot-message-square";
	}

	/**
	 * Get the view state for persistence.
	 */
	getState(): ChatViewState {
		return {
			initialAgentId: this.initialAgentId ?? undefined,
		};
	}

	/**
	 * Restore the view state from persistence.
	 * Notifies React when agentId is restored so it can re-create the session.
	 */
	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		const previousAgentId = this.initialAgentId;
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);

		// Notify React when agentId is restored and differs from previous value
		if (this.initialAgentId && this.initialAgentId !== previousAgentId) {
			this.agentIdRestoredCallbacks.forEach((cb) =>
				cb(this.initialAgentId!),
			);
		}
	}

	/**
	 * Get the initial agent ID for this view.
	 * Used by ChatComponent to determine which agent to initialize.
	 */
	getInitialAgentId(): string | null {
		return this.initialAgentId;
	}

	/**
	 * Set the agent ID for this view.
	 * Called when agent is switched to persist the change.
	 */
	setAgentId(agentId: string): void {
		this.initialAgentId = agentId;
		// Request workspace to save the updated state
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * Register a callback to be notified when agentId is restored from workspace state.
	 * Used by React components to sync with Obsidian's setState lifecycle.
	 * @returns Unsubscribe function
	 */
	onAgentIdRestored(callback: (agentId: string) => void): () => void {
		this.agentIdRestoredCallbacks.add(callback);
		return () => {
			this.agentIdRestoredCallbacks.delete(callback);
		};
	}

	// ============================================================
	// Input State Callbacks (for broadcast commands)
	// ============================================================

	/**
	 * Register callbacks for input state access.
	 * Called by ChatComponent on mount.
	 */
	registerInputCallbacks(callbacks: {
		getInputState: GetInputStateCallback;
		setInputState: SetInputStateCallback;
		sendMessage: SendMessageCallback;
		canSend: CanSendCallback;
		cancel: CancelCallback;
	}): void {
		this.getInputStateCallback = callbacks.getInputState;
		this.setInputStateCallback = callbacks.setInputState;
		this.sendMessageCallback = callbacks.sendMessage;
		this.canSendCallback = callbacks.canSend;
		this.cancelCallback = callbacks.cancel;
	}

	/**
	 * Unregister callbacks when component unmounts.
	 */
	unregisterInputCallbacks(): void {
		this.getInputStateCallback = null;
		this.setInputStateCallback = null;
		this.sendMessageCallback = null;
		this.canSendCallback = null;
		this.cancelCallback = null;
	}

	/**
	 * Get current input state (text + images).
	 * Returns null if React component not mounted.
	 */
	getInputState(): ChatInputState | null {
		return this.getInputStateCallback?.() ?? null;
	}

	/**
	 * Set input state (text + images).
	 */
	setInputState(state: ChatInputState): void {
		this.setInputStateCallback?.(state);
	}

	/**
	 * Trigger send message. Returns true if message was sent.
	 */
	async sendMessage(): Promise<boolean> {
		return (await this.sendMessageCallback?.()) ?? false;
	}

	/**
	 * Check if this view can send a message.
	 */
	canSend(): boolean {
		return this.canSendCallback?.() ?? false;
	}

	/**
	 * Cancel current operation.
	 */
	async cancelOperation(): Promise<void> {
		await this.cancelCallback?.();
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);
		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");
		// Cleanup is handled by React useEffect cleanup in ChatComponent
		// which performs auto-export and closeSession
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		// Remove adapter for this view (disconnect process)
		await this.plugin.removeAdapter(this.viewId);
	}
}
