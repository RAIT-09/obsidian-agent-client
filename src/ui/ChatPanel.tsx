import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { Notice, FileSystemAdapter, Platform, Menu, type MenuItem } from "obsidian";

import type { AttachedFile, ChatInputState } from "../types/chat";
import { SessionHistoryModal } from "./SessionHistoryModal";

// Service imports
import { getLogger } from "../utils/logger";
import { ChatExporter } from "../services/chat-exporter";

// Adapter imports
import type { AcpClient } from "../acp/acp-client";

// Context imports
import { useChatContext } from "./ChatContext";

// Hooks imports
import { useSettings } from "../hooks/useSettings";
import { useSuggestions } from "../hooks/useSuggestions";
import { useAgent } from "../hooks/useAgent";
import { useSessionHistory } from "../hooks/useSessionHistory";

// Domain model imports
import {
	flattenConfigSelectOptions,
	type ChatSession,
	type SessionModeState,
	type SessionModelState,
	type SessionConfigOption,
} from "../types/session";
import type {
	ChatMessage,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import { buildFileUri } from "../utils/paths";
import { convertWindowsPathToWsl } from "../utils/platform";
import type { AgentUpdateNotification } from "../services/update-checker";
import { checkAgentUpdate } from "../services/update-checker";

// Component imports
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import type { IChatViewHost } from "./view-host";

// ============================================================================
// ChatPanelCallbacks - interface for class-level delegation
// ============================================================================

/**
 * Callbacks that ChatPanel registers with its parent container class.
 * Used by ChatView / FloatingViewContainer to implement IChatViewContainer
 * by delegating to the React component's state and handlers.
 */
export interface ChatPanelCallbacks {
	getDisplayName: () => string;
	getInputState: () => ChatInputState | null;
	setInputState: (state: ChatInputState) => void;
	canSend: () => boolean;
	sendMessage: () => Promise<boolean>;
	cancelOperation: () => Promise<void>;
}

// ============================================================================
// ChatPanelProps
// ============================================================================

export interface ChatPanelProps {
	variant: "sidebar" | "floating";
	viewId: string;
	workingDirectory?: string;
	initialAgentId?: string;
	config?: { agent?: string; model?: string };
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
	/** Called when agent ID changes (sidebar only — persists in Obsidian state) */
	onAgentIdChanged?: (agentId: string) => void;
	// Floating-specific
	onMinimize?: () => void;
	onClose?: () => void;
	onOpenNewWindow?: () => void;
	/** Mouse down handler for floating header drag area */
	onFloatingHeaderMouseDown?: (e: React.MouseEvent) => void;
	// Sidebar-specific: Obsidian view host for DOM event registration
	viewHost?: IChatViewHost;
	/** External container element for focus tracking (floating uses parent's container) */
	containerEl?: HTMLElement | null;
}

// ============================================================================
// State Definitions
// ============================================================================

// Type definitions for Obsidian internal APIs (sidebar menu)
interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

// Custom event type with targetViewId parameter
type CustomEventCallback = (targetViewId?: string) => void;

// ============================================================================
// ChatPanel Component
// ============================================================================

/**
 * Core chat panel component that encapsulates all chat logic.
 *
 * This is the single source of truth for chat state and behavior,
 * shared between sidebar (ChatView) and floating (FloatingChatView) variants.
 * It is a 1:1 migration of useChatController into a React component,
 * with workspace event handlers moved from ChatComponent/FloatingChatComponent.
 */
export function ChatPanel({
	variant,
	viewId,
	workingDirectory,
	initialAgentId,
	config,
	onRegisterCallbacks,
	onAgentIdChanged,
	onMinimize,
	onClose,
	onOpenNewWindow,
	onFloatingHeaderMouseDown,
	viewHost: viewHostProp,
	containerEl: containerElProp,
}: ChatPanelProps) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// ============================================================
	// Context
	// ============================================================
	const { plugin, acpClient, vaultService } = useChatContext();

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = getLogger();

	const vaultPath = useMemo(() => {
		if (workingDirectory) {
			return workingDirectory;
		}
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		// Fallback for non-FileSystemAdapter (e.g., mobile)
		return process.cwd();
	}, [plugin, workingDirectory]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agent = useAgent(
		acpClient,
		plugin.settingsService,
		vaultService,
		vaultPath,
		initialAgentId,
	);

	const {
		session,
		isReady: isSessionReady,
		messages,
		isSending,
		errorInfo,
	} = agent;


	const suggestions = useSuggestions(
		vaultService,
		plugin,
		session.availableCommands || [],
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

	// Session history hook with callback for session load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
			configOptions?: SessionConfigOption[],
		) => {
			logger.log(
				`[ChatPanel] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					models,
					configOptions,
				},
			);
			agent.updateSessionFromLoad(
				sessionId,
				modes,
				models,
				configOptions,
			);
		},
		[logger, agent],
	);

	const sessionHistory = useSessionHistory({
		agentClient: acpClient,
		session,
		settingsAccess: plugin.settingsService,
		cwd: vaultPath,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: agent.setMessagesFromLocal,
		onIgnoreUpdates: agent.setIgnoreUpdates,
		onClearMessages: agent.clearMessages,
	});



	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [agentUpdateNotification, setAgentUpdateNotification] =
		useState<AgentUpdateNotification | null>(null);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	// Input state (for broadcast commands)
	const [inputValue, setInputValue] = useState("");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

	// ============================================================
	// Refs
	// ============================================================
	const historyModalRef = useRef<SessionHistoryModal | null>(null);
	const terminalClientRef = useRef<AcpClient>(acpClient);

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
			agent.clearError();
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

			await agent.sendMessage(content, {
				activeNote: settings.autoMentionActiveNote
					? suggestions.mentions.activeNote
					: null,
				vaultBasePath: vaultPath,
				isAutoMentionDisabled: suggestions.mentions.isAutoMentionDisabled,
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
					`[ChatPanel] Session saved locally: ${session.sessionId}`,
				);
			}
		},
		[
			agent,
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
		const lastMessage = agent.lastUserMessage;
		await agent.cancelOperation();
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agent, agent.lastUserMessage]);

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
			if (agent.isSending) {
				await agent.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExportIfEnabled("newChat", messages, session);
			}

			suggestions.mentions.toggleAutoMention(false);
			agent.clearMessages();

			const newAgentId = isAgentSwitch
				? requestedAgentId
				: session.agentId;
			await agent.restartSession(newAgentId);

			// Invalidate session history cache when creating new session
			sessionHistory.invalidateCache();
		},
		[
			messages,
			session,
			logger,
			autoExportIfEnabled,
			agent,
			agent,
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
		logger.log("[ChatPanel] Restarting agent process...");

		// Auto-export current chat before restart (if has messages)
		if (messages.length > 0) {
			await autoExportIfEnabled("newChat", messages, session);
		}

		// Clear messages for fresh start
		agent.clearMessages();

		try {
			await agent.forceRestartAgent();
			new Notice("[Agent Client] Agent restarted");
		} catch (error) {
			new Notice("[Agent Client] Failed to restart agent");
			logger.error("Restart error:", error);
		}
	}, [logger, messages, session, autoExportIfEnabled, agent, agent]);

	const handleClearError = useCallback(() => {
		agent.clearError();
	}, [agent]);

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
					`[ChatPanel] Restoring session: ${sessionId}`,
				);
				agent.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				new Notice("[Agent Client] Session restored");
			} catch (error) {
				new Notice("[Agent Client] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger, agent, sessionHistory],
	);

	const handleForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatPanel] Forking session: ${sessionId}`);
				agent.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				new Notice("[Agent Client] Session forked");
			} catch (error) {
				new Notice("[Agent Client] Failed to fork session");
				logger.error("Session fork error:", error);
			}
		},
		[logger, agent, sessionHistory],
	);

	const handleDeleteSession = useCallback(
		async (sessionId: string) => {
			try {
				logger.log(
					`[ChatPanel] Deleting session: ${sessionId}`,
				);
				await sessionHistory.deleteSession(sessionId);
				new Notice("[Agent Client] Session deleted");
			} catch (error) {
				new Notice("[Agent Client] Failed to delete session");
				logger.error("Session delete error:", error);
			}
		},
		[sessionHistory, logger],
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
			await agent.setMode(modeId);
		},
		[agent],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			await agent.setModel(modelId);
		},
		[agent],
	);

	const handleSetConfigOption = useCallback(
		async (configId: string, value: string) => {
			await agent.setConfigOption(configId, value);
		},
		[agent],
	);

	// ============================================================
	// Sidebar-specific: handleNewChat wrapper that persists agent ID
	// ============================================================
	const handleNewChatWithPersist = useCallback(
		async (requestedAgentId?: string) => {
			await handleNewChat(requestedAgentId);
			// Persist agent ID for this view (survives Obsidian restart)
			if (requestedAgentId) {
				onAgentIdChanged?.(requestedAgentId);
			}
		},
		[handleNewChat, onAgentIdChanged],
	);

	// ============================================================
	// Sidebar-specific: Header Menu (Obsidian native Menu API)
	// ============================================================
	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleShowMenu = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const menu = new Menu();

			// -- Switch agent section --
			menu.addItem((item: MenuItem) => {
				item.setTitle("Switch agent").setIsLabel(true);
			});

			for (const agent of availableAgents) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(agent.displayName)
						.setChecked(agent.id === (session.agentId || ""))
						.onClick(() => {
							void handleNewChatWithPersist(agent.id);
						});
				});
			}

			menu.addSeparator();

			// -- Actions section --
			menu.addItem((item: MenuItem) => {
				item.setTitle("Open new view")
					.setIcon("plus")
					.onClick(() => {
						void plugin.openNewChatViewWithAgent(
							plugin.settings.defaultAgentId,
						);
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Restart agent")
					.setIcon("refresh-cw")
					.onClick(() => {
						void handleRestartAgent();
					});
			});

			menu.addSeparator();

			menu.addItem((item: MenuItem) => {
				item.setTitle("Plugin settings")
					.setIcon("settings")
					.onClick(() => {
						handleOpenSettings();
					});
			});

			menu.showAtMouseEvent(e.nativeEvent);
		},
		[
			availableAgents,
			session.agentId,
			handleNewChatWithPersist,
			plugin,
			handleRestartAgent,
			handleOpenSettings,
		],
	);

	// ============================================================
	// viewHost creation for child components
	// ============================================================
	// Track registered listeners for cleanup (floating variant)
	const registeredListenersRef = useRef<
		{ target: Window | Document | HTMLElement; type: string; callback: EventListenerOrEventListenerObject }[]
	>([]);

	const viewHost: IChatViewHost = useMemo(() => {
		// Sidebar: use the provided viewHost from the ChatView class
		if (viewHostProp) {
			return viewHostProp;
		}
		// Floating: create a shim with listener tracking
		return {
			app: plugin.app,
			registerDomEvent: ((
				target: Window | Document | HTMLElement,
				type: string,
				callback: EventListenerOrEventListenerObject,
			) => {
				target.addEventListener(type, callback);
				registeredListenersRef.current.push({ target, type, callback });
			}) as IChatViewHost["registerDomEvent"],
		};
	}, [viewHostProp, plugin.app]);

	// Cleanup registered listeners on unmount (floating variant)
	useEffect(() => {
		return () => {
			for (const {
				target,
				type,
				callback,
			} of registeredListenersRef.current) {
				target.removeEventListener(type, callback);
			}
			registeredListenersRef.current = [];
		};
	}, []);

	// ============================================================
	// Effects - History Modal Props Sync
	// ============================================================
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
		void agent.createSession(config?.agent || initialAgentId);
	}, [agent.createSession, config?.agent, initialAgentId]);

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
						"[ChatPanel] Applying configured model via configOptions:",
						config.model,
					);
					void agent.setConfigOption(
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
					"[ChatPanel] Applying configured model:",
					config.model,
				);
				void agent.setModel(config.model);
			}
		}
	}, [
		config?.model,
		isSessionReady,
		session.configOptions,
		session.models,
		agent.setConfigOption,
		agent.setModel,
		logger,
	]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExportIfEnabled);
	const closeSessionRef = useRef(agent.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExportIfEnabled;
	closeSessionRef.current = agent.closeSession;

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log(
				"[ChatPanel] Cleanup: auto-export and close session",
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

		// Save when turn ends (isSending: true -> false) and has messages
		if (
			wasSending &&
			!isSending &&
			session.sessionId &&
			messages.length > 0
		) {
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[ChatPanel] Session messages saved: ${session.sessionId}`,
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
			await suggestions.mentions.updateActiveNote();
		};

		const unsubscribe = vaultService.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [suggestions.mentions.updateActiveNote, vaultService]);

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================

	// 1. Toggle auto-mention
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
			suggestions.mentions.toggleAutoMention();
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, suggestions.mentions.toggleAutoMention, viewId]);

	// 2. New chat requested (from "New chat with [Agent]" command)
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:new-chat-requested", (agentId?: string) => {
			// For sidebar variant, only respond if we are the last active view
			if (
				variant === "sidebar" &&
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			// For floating variant, same check
			if (
				variant === "floating" &&
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			if (variant === "sidebar") {
				void handleNewChatWithPersist(agentId);
			} else {
				void handleNewChat(agentId);
			}
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		handleNewChatWithPersist,
		handleNewChat,
		viewId,
		variant,
	]);

	// 3. Permission commands + cancel + export
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
					const success = await agent.approveActivePermission();
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
					const success = await agent.rejectActivePermission();
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

		const exportRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:export-chat", (targetViewId?: string) => {
			// Only respond if this view is the target (or no target specified)
			if (targetViewId && targetViewId !== viewId) {
				return;
			}
			void handleExportChat();
		});

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
			workspace.offref(exportRef);
		};
	}, [
		plugin.app.workspace,
		agent.approveActivePermission,
		agent.rejectActivePermission,
		handleStopGeneration,
		handleExportChat,
		viewId,
	]);

	// ============================================================
	// Effects - Focus Tracking
	// ============================================================
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = containerElProp ?? containerRef.current;
		if (!container) return;

		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		// Set as active on mount (first opened view becomes active)
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, containerElProp]);

	// ============================================================
	// Callback Registration for IChatViewContainer
	// ============================================================
	// Use refs so callbacks always access latest values
	const inputValueRef = useRef(inputValue);
	const attachedFilesRef = useRef(attachedFiles);
	const isSessionReadyRef = useRef(isSessionReady);
	const isSendingRef = useRef(isSending);
	const sessionHistoryLoadingRef = useRef(sessionHistory.loading);
	const handleSendMessageRef = useRef(handleSendMessage);
	const handleStopGenerationRef = useRef(handleStopGeneration);
	inputValueRef.current = inputValue;
	attachedFilesRef.current = attachedFiles;
	isSessionReadyRef.current = isSessionReady;
	isSendingRef.current = isSending;
	sessionHistoryLoadingRef.current = sessionHistory.loading;
	handleSendMessageRef.current = handleSendMessage;
	handleStopGenerationRef.current = handleStopGeneration;

	useEffect(() => {
		onRegisterCallbacks?.({
			getDisplayName: () => activeAgentLabel,
			getInputState: () => ({
				text: inputValueRef.current,
				files: attachedFilesRef.current,
			}),
			setInputState: (state) => {
				setInputValue(state.text);
				setAttachedFiles(state.files);
			},
			canSend: () => {
				const hasContent =
					inputValueRef.current.trim() !== "" ||
					attachedFilesRef.current.length > 0;
				return (
					hasContent &&
					isSessionReadyRef.current &&
					!sessionHistoryLoadingRef.current &&
					!isSendingRef.current
				);
			},
			sendMessage: async () => {
				const currentInput = inputValueRef.current;
				const currentFiles = attachedFilesRef.current;
				// Allow sending if there's text OR attachments
				if (!currentInput.trim() && currentFiles.length === 0) {
					return false;
				}
				if (
					!isSessionReadyRef.current ||
					sessionHistoryLoadingRef.current
				) {
					return false;
				}
				if (isSendingRef.current) {
					return false;
				}

				// Clear input before sending
				const messageToSend = currentInput.trim();
				const filesToSend =
					currentFiles.length > 0 ? [...currentFiles] : undefined;
				setInputValue("");
				setAttachedFiles([]);

				await handleSendMessageRef.current(messageToSend, filesToSend);
				return true;
			},
			cancelOperation: async () => {
				if (isSendingRef.current) {
					await handleStopGenerationRef.current();
				}
			},
		});
	}, [onRegisterCallbacks, activeAgentLabel]);

	// ============================================================
	// Render
	// ============================================================
	const chatFontSizeStyle =
		settings.displaySettings.fontSize !== null
			? ({
					"--ac-chat-font-size": `${settings.displaySettings.fontSize}px`,
				} as React.CSSProperties)
			: undefined;

	const headerElement =
		variant === "sidebar" ? (
			<ChatHeader
				variant="sidebar"
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				hasHistoryCapability={sessionHistory.canShowSessionHistory}
				onNewChat={() => void handleNewChatWithPersist()}
				onExportChat={() => void handleExportChat()}
				onShowMenu={handleShowMenu}
				onOpenHistory={handleOpenHistory}
			/>
		) : (
			<ChatHeader
				variant="floating"
				agentLabel={activeAgentLabel}
				availableAgents={availableAgents}
				currentAgentId={session.agentId}
				isUpdateAvailable={isUpdateAvailable}
				hasMessages={messages.length > 0}
				onAgentChange={(agentId) => void handleSwitchAgent(agentId)}
				onNewSession={() => void handleNewChat()}
				onOpenHistory={() => void handleOpenHistory()}
				onExportChat={() => void handleExportChat()}
				onRestartAgent={() => void handleRestartAgent()}
				onOpenNewWindow={onOpenNewWindow}
				onMinimize={onMinimize}
				onClose={onClose}
			/>
		);

	const messageListElement = (
		<MessageList
			messages={messages}
			isSending={isSending}
			isSessionReady={isSessionReady}
			isRestoringSession={sessionHistory.loading}
			agentLabel={activeAgentLabel}
			plugin={plugin}
			view={viewHost}
			terminalClient={terminalClientRef.current}
			onApprovePermission={agent.approvePermission}
			hasActivePermission={agent.hasActivePermission}
		/>
	);

	const inputAreaElement = (
		<InputArea
			isSending={isSending}
			isSessionReady={isSessionReady}
			isRestoringSession={sessionHistory.loading}
			agentLabel={activeAgentLabel}
			availableCommands={session.availableCommands || []}
			autoMentionEnabled={settings.autoMentionActiveNote}
			restoredMessage={restoredMessage}
			suggestions={suggestions}
			plugin={plugin}
			view={viewHost}
			onSendMessage={handleSendMessage}
			onStopGeneration={handleStopGeneration}
			onRestoredMessageConsumed={handleRestoredMessageConsumed}
			modes={session.modes}
			onModeChange={(modeId) => void handleSetMode(modeId)}
			models={session.models}
			onModelChange={(modelId) => void handleSetModel(modelId)}
			configOptions={session.configOptions}
			onConfigOptionChange={(configId, value) =>
				void handleSetConfigOption(configId, value)
			}
			usage={session.usage}
			supportsImages={session.promptCapabilities?.image ?? false}
			agentId={session.agentId}
			// Controlled component props (for broadcast commands)
			inputValue={inputValue}
			onInputChange={setInputValue}
			attachedFiles={attachedFiles}
			onAttachedFilesChange={setAttachedFiles}
			// Error overlay props
			errorInfo={errorInfo}
			onClearError={handleClearError}
			// Agent update notification props
			agentUpdateNotification={agentUpdateNotification}
			onClearAgentUpdate={handleClearAgentUpdate}
			messages={messages}
		/>
	);

	if (variant === "floating") {
		// Floating layout: no wrapper div. Parent agent-client-floating-window is the flex container.
		// Focus tracking uses containerElProp (from FloatingChatView's containerRef).
		return (
			<>
				<div
					className="agent-client-floating-header"
					onMouseDown={onFloatingHeaderMouseDown}
				>
					{headerElement}
				</div>
				<div className="agent-client-floating-content">
					<div className="agent-client-floating-messages-container">
						{messageListElement}
					</div>
					{inputAreaElement}
				</div>
			</>
		);
	}

	// Sidebar layout
	return (
		<div
			ref={containerRef}
			className="agent-client-chat-view-container"
			style={chatFontSizeStyle}
		>
			{headerElement}
			{messageListElement}
			{inputAreaElement}
		</div>
	);
}
