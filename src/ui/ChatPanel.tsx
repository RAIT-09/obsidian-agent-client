import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import {
	Notice,
	FileSystemAdapter,
	Platform,
	Menu,
	setIcon,
	TFile,
	type MenuItem,
} from "obsidian";

import type { AttachedFile, ChatInputState, ChatMessage } from "../types/chat";
import type { NoteMetadata } from "../services/vault-service";
import { isSameDirectory } from "../utils/platform";
import {
	computeSessionTitle,
	getDefaultAgentId,
} from "../services/session-helpers";
import {
	countPendingPermissions,
	findLatestPlan,
	summarizePlan,
} from "../services/message-state";
import { PlanStrip } from "./PlanStrip";
import { useHistoryModal } from "../hooks/useHistoryModal";
import { useChatActions } from "../hooks/useChatActions";
import { ChangeDirectoryModal } from "./ChangeDirectoryModal";
import { addRenameSessionMenuItem } from "./EditTitleModal";

// Service imports
import { getLogger } from "../utils/logger";

// Adapter imports
import type { AcpClient } from "../acp/acp-client";
import type { AgentClientPluginSettings } from "../plugin";

// Context imports
import { useChatContext } from "./ChatContext";

// Hooks imports
import { useSettingsSelector } from "../hooks/useSettings";
import { useSuggestions } from "../hooks/useSuggestions";
import { useAgent } from "../hooks/useAgent";
import { useSessionHistory } from "../hooks/useSessionHistory";

// Domain model imports
import {
	flattenConfigSelectOptions,
	type SlashCommand,
	type SessionModeState,
	type SessionConfigOption,
} from "../types/session";
import { checkAgentUpdate } from "../services/update-checker";
import type { SessionStatus } from "../services/view-registry";
import { buildGeminiDeprecationNotice } from "../services/session-helpers";
import { PRESET_AGENTS, GEMINI_PRESET_ID } from "../services/preset-agents";

/** Stable empty array for useSuggestions when no commands available */
const EMPTY_COMMANDS: SlashCommand[] = [];

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
	getSessionStatus: () => SessionStatus;
	getSessionTitle: () => string;
	getSessionId: () => string | null;
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
	variant: "sidebar" | "floating" | "embedded";
	viewId: string;
	workingDirectory?: string;
	initialAgentId?: string;
	config?: {
		agent?: string;
		model?: string;
	};
	/** Embedded variant only (meaningful when variant === "embedded"). */
	embeddedConfig?: {
		persist?: boolean;
		noteContext?: "hosting";
		sourcePath?: string;
		/** Stable block id (from AgentChatBlockConfig.id; used as embedId). */
		id?: string;
	};
	onRegisterCallbacks?: (callbacks: ChatPanelCallbacks) => void;
	/** Called when agent ID changes (sidebar only — persists in Obsidian state) */
	onAgentIdChanged?: (agentId: string) => void;
	/**
	 * Called when the derived session title may have changed (sidebar only —
	 * triggers Obsidian to re-read getDisplayText() and update the tab header).
	 */
	onSessionTitleChanged?: () => void;
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

// ============================================================================
// ChatPanel Component
// ============================================================================

/** Debounce (ms) for re-saving when trailing chunks arrive after a turn ends (#320). */
const TRAILING_SAVE_DEBOUNCE_MS = 800;

// Settings slice actually consumed by ChatPanel. Subscribing to just these
// fields (rather than the whole settings object) prevents a re-render on every
// unrelated settings write for every mounted panel — multiple embedded blocks
// especially (#20).
function selectChatPanelSettings(s: AgentClientPluginSettings) {
	return {
		autoMentionActiveNote: s.autoMentionActiveNote,
		debugMode: s.debugMode,
		// Read by useChatActions (WSL path conversion); rarely changes.
		windowsWslMode: s.windowsWslMode,
		enableSystemNotifications: s.enableSystemNotifications,
		savedSessions: s.savedSessions,
		// Agent identity fields back activeAgentLabel + availableAgents (#341/#4).
		// These change rarely (only via SettingsTab), so adding them to the slice
		// does not erode the #20 narrow-subscription intent (no high-frequency
		// fields here).
		presetAgents: s.presetAgents,
		customAgents: s.customAgents,
		displaySettings: {
			fontSize: s.displaySettings.fontSize,
			showEmojis: s.displaySettings.showEmojis,
		},
	};
}

type ChatPanelSettings = ReturnType<typeof selectChatPanelSettings>;

function chatPanelSettingsEqual(
	a: ChatPanelSettings,
	b: ChatPanelSettings,
): boolean {
	return (
		a.autoMentionActiveNote === b.autoMentionActiveNote &&
		a.debugMode === b.debugMode &&
		a.windowsWslMode === b.windowsWslMode &&
		a.enableSystemNotifications === b.enableSystemNotifications &&
		// SessionStorage always writes a fresh array; reference compare suffices.
		a.savedSessions === b.savedSessions &&
		// SettingsTab.updatePresetAgent emits a fresh presetAgents record and
		// flushSettings emits a fresh customAgents array on edit, so a
		// reference compare detects agent changes (and only those).
		a.presetAgents === b.presetAgents &&
		a.customAgents === b.customAgents &&
		a.displaySettings.fontSize === b.displaySettings.fontSize &&
		a.displaySettings.showEmojis === b.displaySettings.showEmojis
	);
}

/**
 * Core chat panel component that encapsulates all chat logic.
 *
 * This is the single source of truth for chat state and behavior,
 * shared between sidebar (ChatView) and floating (FloatingChatView) variants.
 * It is a 1:1 migration of useChatController into a React component,
 * with workspace event handlers moved from ChatComponent/FloatingChatComponent.
 */
export const ChatPanel = React.memo(function ChatPanel({
	variant,
	viewId,
	workingDirectory,
	initialAgentId,
	config,
	embeddedConfig,
	onRegisterCallbacks,
	onAgentIdChanged,
	onSessionTitleChanged,
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

	// Agent working directory — defaults to vault path.
	// Can be changed independently via "New chat in directory..." action.
	const [agentCwd, setAgentCwd] = useState(vaultPath);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettingsSelector(
		plugin,
		selectChatPanelSettings,
		chatPanelSettingsEqual,
	);

	const agent = useAgent(
		acpClient,
		plugin.settingsService,
		vaultService,
		agentCwd,
		initialAgentId,
	);

	const {
		session,
		isReady: isSessionReady,
		messages,
		isSending,
		errorInfo,
	} = agent;

	const pinnedActiveNote = useMemo<NoteMetadata | null>(() => {
		if (
			embeddedConfig?.noteContext !== "hosting" ||
			!embeddedConfig.sourcePath
		) {
			return null;
		}
		const file = plugin.app.vault.getAbstractFileByPath(
			embeddedConfig.sourcePath,
		);
		if (!(file instanceof TFile)) return null;
		return {
			path: file.path,
			name: file.basename,
			extension: file.extension,
			created: file.stat.ctime,
			modified: file.stat.mtime,
		};
	}, [plugin, embeddedConfig?.noteContext, embeddedConfig?.sourcePath]);

	const suggestions = useSuggestions(
		vaultService,
		plugin,
		session.availableCommands || EMPTY_COMMANDS,
		settings.autoMentionActiveNote,
		pinnedActiveNote,
	);

	// Session history hook with callback for session load
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			configOptions?: SessionConfigOption[],
		) => {
			logger.log(
				`[ChatPanel] Session loaded/resumed/forked: ${sessionId}`,
				{
					modes,
					configOptions,
				},
			);
			void agent.updateSessionFromLoad(sessionId, modes, configOptions);
		},
		[logger, agent.updateSessionFromLoad],
	);

	const sessionHistory = useSessionHistory({
		agentClient: acpClient,
		session,
		settingsAccess: plugin.settingsService,
		cwd: vaultPath,
		agentCwd,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: agent.setMessagesFromLocal,
		onIgnoreUpdates: agent.setIgnoreUpdates,
		onClearMessages: agent.clearMessages,
	});

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

	// Input state (for broadcast commands)
	const [inputValue, setInputValue] = useState("");
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

	// Which tool calls are expanded. Held here rather than inside the rows
	// because the virtualized list unmounts anything scrolled out of view.
	const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(
		() => new Set(),
	);
	const toggleToolCall = useCallback((toolCallId: string) => {
		setExpandedToolCalls((prev) => {
			const next = new Set(prev);
			if (!next.delete(toolCallId)) next.add(toolCallId);
			return next;
		});
	}, []);
	// Plan strip: collapsed by default, derived from the transcript.
	const [planExpanded, setPlanExpanded] = useState(false);
	const togglePlan = useCallback(() => setPlanExpanded((v) => !v), []);
	const planEntries = useMemo(() => findLatestPlan(messages), [messages]);
	const planSummary = useMemo(
		() =>
			planEntries && planEntries.length > 0
				? summarizePlan(planEntries)
				: null,
		[planEntries],
	);

	// Start every session collapsed; ids are only meaningful within one.
	useEffect(() => {
		setExpandedToolCalls(new Set());
		setPlanExpanded(false);
	}, [session.sessionId]);

	// Requests waiting behind the active one, for the dialog's queue badge.
	const queuedPermissionCount = useMemo(
		() => Math.max(0, countPendingPermissions(messages) - 1),
		[messages],
	);

	// Pending auto-send queued by the pending-prompt handler (drained when ready)
	const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);
	const persistRestoreAttemptedRef = useRef(false);
	// Tracks whether we've already re-spawned the agent to match a saved
	// conversation before restoring it (prevents a restart loop).
	const persistRestartedRef = useRef(false);
	// Gate the mount-init session-creation effect: run on first mount, then
	// re-run ONLY when an explicit directive (embedded config pin or the
	// view state's initialAgentId) names a different agent than the last
	// launch. The sidebar mounts after Obsidian delivers its view state
	// (ChatView.renderPanel), so initialAgentId is normally static — but a
	// late setState after the fallback mount can still change it, and the
	// guard must keep ignoring agentCwd-driven agent.createSession reference
	// churn (the persist-restore re-spawn race). A bare run-once boolean
	// would break the late-setState path.
	const hasInitializedRef = useRef(false);
	const lastInitAgentRef = useRef<string | undefined>(undefined);

	// ============================================================
	// Refs
	// ============================================================
	const terminalClientRef = useRef<AcpClient>(acpClient);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (PRESET_AGENTS.some((def) => def.presetId === activeId)) {
			const preset = settings.presetAgents[activeId];
			if (preset) {
				return preset.displayName || preset.id;
			}
		}
		const custom = settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, settings.presetAgents, settings.customAgents]);

	const availableAgents = useMemo(() => {
		return plugin.getAvailableAgents();
		// Depend on just the agent identity fields (not the whole slice), so
		// unrelated slice changes (e.g. savedSessions on every turn save)
		// don't rebuild the header dropdown.
	}, [plugin, settings.presetAgents, settings.customAgents]);

	// ============================================================
	// Chat Actions
	// ============================================================
	const actions = useChatActions(
		plugin,
		agent,
		sessionHistory,
		suggestions,
		session,
		messages,
		settings,
		vaultPath,
		embeddedConfig?.persist ? embeddedConfig.id : undefined,
	);

	const {
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleSetMode,
		handleSetConfigOption,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoredMessageConsumed,
		restoredMessage,
		agentUpdateNotification,
		setAgentUpdateNotification,
		autoExportIfEnabled,
	} = actions;

	// ============================================================
	// Gemini CLI deprecation notice (static, agent-id driven)
	// ============================================================
	// Independent channel from the npm-backed agentUpdateNotification:
	// derived synchronously from the active agent id (no network).
	const geminiNotice = useMemo(
		() =>
			session.agentId === GEMINI_PRESET_ID
				? buildGeminiDeprecationNotice()
				: null,
		[session.agentId],
	);

	// Dismiss state lives locally in ChatPanel so it never races with the
	// async setAgentUpdateNotification owned by useChatActions.
	const [geminiNoticeDismissed, setGeminiNoticeDismissed] = useState(false);

	// Re-show the notice when switching agents (e.g. away and back to Gemini).
	useEffect(() => {
		setGeminiNoticeDismissed(false);
	}, [session.agentId]);

	const effectiveGeminiNotice =
		geminiNotice && !geminiNoticeDismissed ? geminiNotice : null;

	const handleClearGeminiNotice = useCallback(
		() => setGeminiNoticeDismissed(true),
		[],
	);

	// Wrap send so the Gemini notice also dismisses on send, mirroring how
	// useChatActions clears agentUpdateNotification inside handleSendMessage.
	const handleSendMessageWithGeminiDismiss = useCallback(
		(content: string, attachments?: AttachedFile[]) => {
			setGeminiNoticeDismissed(true);
			return handleSendMessage(content, attachments);
		},
		[handleSendMessage],
	);

	const { handleOpenHistory } = useHistoryModal(
		plugin,
		agent,
		sessionHistory,
		vaultPath,
		isSessionReady,
		settings.debugMode,
		setAgentCwd,
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

	const handleNewChatInDirectory = useCallback(
		async (directory: string) => {
			// Auto-export current chat before switching
			if (messages.length > 0) {
				await autoExportIfEnabled("newChat", messages, session);
			}
			agent.clearMessages();
			setAgentCwd(directory);
			await agent.restartSession(undefined, directory);
			sessionHistory.invalidateCache();
		},
		[
			messages,
			session,
			autoExportIfEnabled,
			agent.clearMessages,
			agent.restartSession,
			sessionHistory.invalidateCache,
		],
	);

	const handleShowSidebarMenu = useCallback(
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
			addRenameSessionMenuItem(
				menu,
				plugin,
				session.sessionId,
				plugin.settingsService
					.getSavedSessions()
					.find((s) => s.sessionId === session.sessionId)?.title ??
					"New session",
			);

			menu.addItem((item: MenuItem) => {
				item.setTitle("Open new view")
					.setIcon("copy-plus")
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

			menu.addItem((item: MenuItem) => {
				item.setTitle("New chat in directory...")
					.setIcon("folder-open")
					.onClick(() => {
						const modal = new ChangeDirectoryModal(
							plugin.app,
							agentCwd,
							(directory) => {
								void handleNewChatInDirectory(directory);
							},
						);
						modal.open();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Open session manager")
					.setIcon("layout-list")
					.onClick(() => {
						void plugin.activateSessionManager();
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
			agentCwd,
			handleNewChatInDirectory,
			handleOpenSettings,
		],
	);

	const handleShowFloatingMenu = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			const menu = new Menu();

			menu.addItem((item: MenuItem) => {
				item.setTitle("New chat")
					.setIcon("plus")
					.onClick(() => {
						void handleNewChat();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Session history")
					.setIcon("history")
					.onClick(() => {
						void handleOpenHistory();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Export chat to Markdown")
					.setIcon("save")
					.onClick(() => {
						void handleExportChat();
					});
			});

			menu.addSeparator();

			addRenameSessionMenuItem(
				menu,
				plugin,
				session.sessionId,
				plugin.settingsService
					.getSavedSessions()
					.find((s) => s.sessionId === session.sessionId)?.title ??
					"New session",
			);

			if (onOpenNewWindow) {
				menu.addItem((item: MenuItem) => {
					item.setTitle("Open new floating chat")
						.setIcon("copy-plus")
						.onClick(() => {
							onOpenNewWindow();
						});
				});
			}

			menu.addItem((item: MenuItem) => {
				item.setTitle("Restart agent")
					.setIcon("refresh-cw")
					.onClick(() => {
						void handleRestartAgent();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("New chat in directory...")
					.setIcon("folder-open")
					.onClick(() => {
						const modal = new ChangeDirectoryModal(
							plugin.app,
							agentCwd,
							(directory) => {
								void handleNewChatInDirectory(directory);
							},
						);
						modal.open();
					});
			});

			menu.addItem((item: MenuItem) => {
				item.setTitle("Open session manager")
					.setIcon("layout-list")
					.onClick(() => {
						void plugin.activateSessionManager();
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
			handleNewChat,
			handleOpenHistory,
			handleExportChat,
			onOpenNewWindow,
			handleRestartAgent,
			agentCwd,
			handleNewChatInDirectory,
			handleOpenSettings,
			session.sessionId,
		],
	);

	// ============================================================
	// viewHost creation for child components
	// ============================================================
	// Track registered listeners for cleanup (floating variant)
	const registeredListenersRef = useRef<
		{
			target: Window | Document | HTMLElement;
			type: string;
			callback: EventListenerOrEventListenerObject;
		}[]
	>([]);

	const viewHost: IChatViewHost = useMemo(() => {
		// Sidebar: use the provided viewHost from the ChatView class
		if (viewHostProp) {
			return viewHostProp;
		}
		// Floating: create a shim with listener tracking
		return {
			app: plugin.app,
			registerDomEvent: (
				target: Window | Document | HTMLElement,
				type: string,
				callback: EventListenerOrEventListenerObject,
			) => {
				target.addEventListener(type, callback);
				registeredListenersRef.current.push({ target, type, callback });
			},
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
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount
	useEffect(() => {
		// Only an explicit directive — the embedded config pin or the view
		// state's initialAgentId — may re-run init after mount, and only
		// when it names a different agent than the one this effect last
		// launched. The ambient default is resolved once, at launch; it must
		// NOT be re-resolved for the comparison, or a settings change (new
		// or disabled default agent) would turn an unrelated effect re-run —
		// agentCwd churn from restoring a session in another directory —
		// into a rogue createSession that kills the live session. The
		// directive comparison still covers the fallback-mount path: a late
		// setState delivering the id the default already resolved to
		// compares equal to lastInitAgentRef and is skipped.
		const directive = config?.agent || initialAgentId;
		if (
			hasInitializedRef.current &&
			(!directive || directive === lastInitAgentRef.current)
		) {
			return;
		}
		const resolvedAgent =
			directive ||
			getDefaultAgentId(plugin.settingsService.getSnapshot());
		hasInitializedRef.current = true;
		lastInitAgentRef.current = resolvedAgent;
		logger.log("[Debug] Starting connection setup via useSession...");
		void agent.createSession(resolvedAgent);
	}, [agent.createSession, config?.agent, initialAgentId]);

	useEffect(() => {
		if (variant !== "embedded") return;
		if (!embeddedConfig?.persist || !embeddedConfig.id) return;
		if (!isSessionReady || !session.sessionId || !session.agentId) return;
		if (persistRestoreAttemptedRef.current) return;

		// Resolve by the device-neutral embedId ALONE — not filtered by the
		// current agent/cwd — so an unpinned block that switched agents, or one
		// whose conversation lives under a custom "New chat in directory…" cwd,
		// still finds its last session (#5, #11).
		const savedSession = plugin.settingsService.getSavedSessionByEmbedId(
			embeddedConfig.id,
		);
		if (!savedSession || savedSession.sessionId === session.sessionId) {
			persistRestoreAttemptedRef.current = true;
			return;
		}

		// restoreSession loads against the CURRENT agent process and cannot
		// switch agents (loadSession/resumeSession run on the live connection).
		// If the saved conversation used a different agent, re-spawn under it
		// first (adopting its cwd), then let this effect re-run to perform the
		// load. setAgentCwd is safe here because the mount-init effect is
		// guarded to run once (hasInitializedRef).
		if (
			savedSession.agentId !== session.agentId &&
			!persistRestartedRef.current
		) {
			persistRestartedRef.current = true;
			setAgentCwd(savedSession.cwd);
			void agent.restartSession(savedSession.agentId, savedSession.cwd);
			return;
		}

		if (!sessionHistory.canRestore) {
			persistRestoreAttemptedRef.current = true;
			return;
		}

		persistRestoreAttemptedRef.current = true;
		// Align agentCwd with the restored conversation so the cwd banner and
		// later first-message saves reflect its real directory (restoreSession
		// itself does not touch agentCwd). Safe under the mount-init guard.
		setAgentCwd(savedSession.cwd);
		void sessionHistory.restoreSession(
			savedSession.sessionId,
			savedSession.cwd,
		);
	}, [
		variant,
		embeddedConfig?.persist,
		embeddedConfig?.id,
		isSessionReady,
		session.sessionId,
		session.agentId,
		sessionHistory.canRestore,
		sessionHistory.restoreSession,
		plugin.settingsService,
		agent.restartSession,
	]);

	// Apply configured model (a select config option with category "model")
	// when session is ready.
	useEffect(() => {
		if (!config?.model || !isSessionReady) return;

		if (session.configOptions) {
			const modelOption = session.configOptions.find(
				(o) => o.category === "model",
			);
			if (
				modelOption &&
				modelOption.type === "select" &&
				modelOption.currentValue !== config.model
			) {
				const valueExists = flattenConfigSelectOptions(
					modelOption.options,
				).some((o) => o.value === config.model);
				if (valueExists) {
					logger.log(
						"[ChatPanel] Applying configured model via configOptions:",
						config.model,
					);
					void agent.setConfigOption(modelOption.id, config.model);
				}
			}
		}
	}, [
		config?.model,
		isSessionReady,
		session.configOptions,
		agent.setConfigOption,
		logger,
	]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExportIfEnabled);
	const closeSessionRef = useRef(agent.closeSession);
	const saveSessionMessagesRef = useRef(sessionHistory.saveSessionMessages);
	// True once the user has actually run a turn in THIS session. The
	// trailing-chunk re-save and close-time flush are armed only after a real
	// turn, so messages that were merely loaded/replayed are never re-saved
	// (which would bump updatedAt and corrupt "last used" ordering). (#320 review)
	const sentThisSessionRef = useRef(false);
	// Reference identity of the messages array last persisted to disk. Used to
	// de-duplicate the turn-end save, the trailing-chunk re-save, and the
	// close-time flush.
	const lastSavedMessagesRef = useRef<ChatMessage[] | null>(null);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExportIfEnabled;
	closeSessionRef.current = agent.closeSession;
	saveSessionMessagesRef.current = sessionHistory.saveSessionMessages;

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log("[ChatPanel] Cleanup: auto-export and close session");
			// Flush trailing-chunk content the debounced save may not have
			// persisted yet (view closed within the debounce window). Only when a
			// real turn ran this session and there is unsaved content. (#320 review)
			const latest = messagesRef.current;
			const sid = sessionRef.current.sessionId;
			if (
				sentThisSessionRef.current &&
				sid &&
				latest.length > 0 &&
				lastSavedMessagesRef.current !== latest
			) {
				saveSessionMessagesRef.current(sid, latest);
			}
			void (async () => {
				await autoExportRef.current(
					"closeChat",
					latest,
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

	// Re-loading/switching sessions disarms the trailing-chunk save & flush, so
	// freshly loaded/replayed messages are never re-saved (which would bump
	// updatedAt and corrupt "last used" ordering). (#320 review)
	useEffect(() => {
		sentThisSessionRef.current = false;
	}, [session.sessionId]);

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
			sentThisSessionRef.current = true;
			lastSavedMessagesRef.current = messages;
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			logger.log(
				`[ChatPanel] Session messages saved: ${session.sessionId}`,
			);

			// System notification on response completion
			if (
				settings.enableSystemNotifications &&
				!activeDocument.hasFocus()
			) {
				new Notification("Agent Client", {
					body: `${activeAgentLabel} has completed the response.`,
				});
			}
		}
	}, [
		isSending,
		session.sessionId,
		messages,
		sessionHistory.saveSessionMessages,
		settings.enableSystemNotifications,
		activeAgentLabel,
		logger,
	]);

	// Some agents (e.g. OpenCode) emit trailing message chunks *after* end_turn,
	// so the turn-end save above runs before they arrive and the persisted copy
	// is truncated. Re-save when messages change while idle, debounced so rapid
	// trailing updates coalesce into a single write (avoids racing the file). (#320)
	useEffect(() => {
		const sessionId = session.sessionId;
		if (isSending || !sessionId || messages.length === 0) return;
		if (!sentThisSessionRef.current) return;
		if (lastSavedMessagesRef.current === messages) return;
		const timer = window.setTimeout(() => {
			lastSavedMessagesRef.current = messages;
			sessionHistory.saveSessionMessages(sessionId, messages);
		}, TRAILING_SAVE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [
		isSending,
		session.sessionId,
		messages,
		sessionHistory.saveSessionMessages,
	]);

	// ============================================================
	// Effects - Notify ViewRegistry of State Changes
	// ============================================================
	// `hasMessages` flips false → true on first message and then stays stable
	// for the rest of the conversation. The Session Manager's title and
	// status only depend on this boolean transition, not on per-chunk growth,
	// so we avoid notifying on every streamed token.
	const hasMessages = messages.length > 0;
	useEffect(() => {
		plugin.viewRegistry.notifyChange();
	}, [
		plugin.viewRegistry,
		session.state,
		session.sessionId,
		isSending,
		agent.hasActivePermission,
		sessionHistory.loading,
		hasMessages,
	]);

	// ============================================================
	// Effects - Notify Sidebar Container of Session Title Changes
	// ============================================================
	const sessionTitle = useMemo(
		() =>
			computeSessionTitle(
				session.sessionId,
				settings.savedSessions ?? [],
				messages,
			),
		[session.sessionId, settings.savedSessions, messages],
	);
	// Fires on initial mount + every sessionTitle change so the tab reflects the current title.
	useEffect(() => {
		onSessionTitleChanged?.();
	}, [onSessionTitleChanged, sessionTitle]);

	// ============================================================
	// Effects - System Notification on Permission Request
	// ============================================================
	const prevHasActivePermissionRef = useRef<boolean>(false);

	useEffect(() => {
		const wasActive = prevHasActivePermissionRef.current;
		prevHasActivePermissionRef.current = agent.hasActivePermission;

		// Notify when permission transitions from inactive to active
		if (
			!wasActive &&
			agent.hasActivePermission &&
			settings.enableSystemNotifications &&
			!activeDocument.hasFocus()
		) {
			new Notification("Agent Client", {
				body: `${activeAgentLabel} is requesting permission.`,
			});
		}
	}, [
		agent.hasActivePermission,
		settings.enableSystemNotifications,
		activeAgentLabel,
	]);

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

	// Refs for workspace event handlers (avoids re-registering on every render)
	const handleNewChatWithPersistRef = useRef(handleNewChatWithPersist);
	const handleNewChatRef = useRef(handleNewChat);
	const approveActivePermissionRef = useRef(agent.approveActivePermission);
	const rejectActivePermissionRef = useRef(agent.rejectActivePermission);
	const handleStopGenerationRef = useRef(handleStopGeneration);
	const handleExportChatRef = useRef(handleExportChat);
	handleNewChatWithPersistRef.current = handleNewChatWithPersist;
	handleNewChatRef.current = handleNewChat;
	approveActivePermissionRef.current = agent.approveActivePermission;
	rejectActivePermissionRef.current = agent.rejectActivePermission;
	handleStopGenerationRef.current = handleStopGeneration;
	handleExportChatRef.current = handleExportChat;

	useEffect(() => {
		const workspace = plugin.app.workspace;
		const ws = workspace as unknown as {
			on: (
				name: string,
				callback: (...args: never[]) => void,
			) => ReturnType<typeof workspace.on>;
		};

		const refs = [
			// Toggle auto-mention
			ws.on(
				"agent-client:toggle-auto-mention",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					suggestions.mentions.toggleAutoMention();
				},
			),

			// New chat requested (from "New chat" or "Switch agent to" commands)
			ws.on(
				"agent-client:new-chat-requested",
				(targetViewId?: string, agentId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					if (variant === "sidebar") {
						void handleNewChatWithPersistRef.current(agentId);
					} else {
						void handleNewChatRef.current(agentId);
					}
				},
			),

			// Approve active permission
			ws.on(
				"agent-client:approve-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						const success =
							await approveActivePermissionRef.current();
						if (!success) {
							new Notice(
								"[Agent Client] No active permission request",
							);
						}
					})();
				},
			),

			// Reject active permission
			ws.on(
				"agent-client:reject-active-permission",
				(targetViewId?: string) => {
					if (targetViewId && targetViewId !== viewId) return;
					void (async () => {
						const success =
							await rejectActivePermissionRef.current();
						if (!success) {
							new Notice(
								"[Agent Client] No active permission request",
							);
						}
					})();
				},
			),

			// Cancel current message
			ws.on("agent-client:cancel-message", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleStopGenerationRef.current();
			}),

			// Export chat
			ws.on("agent-client:export-chat", (targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) return;
				void handleExportChatRef.current();
			}),
		];

		return () => {
			for (const ref of refs) {
				workspace.offref(ref);
			}
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		viewId,
		variant,
		suggestions.mentions.toggleAutoMention,
	]);

	// Deterministic prompt delivery: register a handler the plugin invokes
	// directly (or that drains a queued prompt) instead of a timed workspace
	// broadcast. setInputValue / setPendingAutoSend are stable useState
	// setters, so [plugin, viewId] deps suffice.
	useEffect(() => {
		return plugin.registerPendingPromptHandler(
			viewId,
			(prompt, autoSend) => {
				if (typeof prompt !== "string" || prompt.length === 0) return;
				setInputValue(prompt);
				// Injected prompts are a fresh message — don't carry over any
				// attachments already staged in this panel (#341/#6).
				setAttachedFiles([]);
				if (autoSend) setPendingAutoSend(prompt);
			},
		);
	}, [plugin, viewId]);

	// ============================================================
	// Effects - Drain pending auto-send when session becomes ready
	// ============================================================
	useEffect(() => {
		if (!pendingAutoSend) return;
		if (!isSessionReady) return;
		if (isSending) return;
		if (sessionHistory.loading) return;

		const prompt = pendingAutoSend;
		setPendingAutoSend(null);
		setInputValue("");
		void handleSendMessage(prompt);
	}, [
		pendingAutoSend,
		isSessionReady,
		isSending,
		sessionHistory.loading,
		handleSendMessage,
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
	const sessionStateRef = useRef(session.state);
	const sessionIdRef = useRef(session.sessionId);
	const hasActivePermissionRef = useRef(agent.hasActivePermission);
	const sessionHistoryLoadingRef = useRef(sessionHistory.loading);
	const handleSendMessageRef = useRef(handleSendMessage);
	inputValueRef.current = inputValue;
	attachedFilesRef.current = attachedFiles;
	isSessionReadyRef.current = isSessionReady;
	isSendingRef.current = isSending;
	sessionStateRef.current = session.state;
	sessionIdRef.current = session.sessionId;
	hasActivePermissionRef.current = agent.hasActivePermission;
	sessionHistoryLoadingRef.current = sessionHistory.loading;
	handleSendMessageRef.current = handleSendMessage;

	useEffect(() => {
		onRegisterCallbacks?.({
			getDisplayName: () => activeAgentLabel,
			getSessionStatus: () => {
				const state = sessionStateRef.current;
				if (state === "error") return "error";
				if (state === "disconnected") return "disconnected";
				if (hasActivePermissionRef.current) return "permission";
				if (isSendingRef.current || sessionHistoryLoadingRef.current)
					return "busy";
				if (state === "ready") return "ready";
				return "busy";
			},
			getSessionTitle: () =>
				computeSessionTitle(
					sessionIdRef.current,
					plugin.settingsService.getSnapshot().savedSessions ?? [],
					messagesRef.current,
				),
			getSessionId: () => sessionIdRef.current,
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
				onNewChat={() => void handleNewChatWithPersist()}
				onExportChat={() => void handleExportChat()}
				onShowMenu={handleShowSidebarMenu}
				onOpenHistory={handleOpenHistory}
			/>
		) : variant === "floating" ? (
			// Floating variant always shows the agent selector (no agent pinning).
			<ChatHeader
				variant="floating"
				agentLabel={activeAgentLabel}
				availableAgents={availableAgents}
				currentAgentId={session.agentId}
				isUpdateAvailable={isUpdateAvailable}
				onAgentChange={(agentId) => void handleSwitchAgent(agentId)}
				onShowMenu={handleShowFloatingMenu}
				onMinimize={onMinimize}
				onClose={onClose}
			/>
		) : (
			// Embedded variant: hide the agent selector when the block pins an
			// agent (config.agent) by passing undefined for the selector props.
			<ChatHeader
				variant="embedded"
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				availableAgents={config?.agent ? undefined : availableAgents}
				currentAgentId={session.agentId}
				onAgentChange={
					config?.agent
						? undefined
						: (agentId) => void handleSwitchAgent(agentId)
				}
				onShowMenu={handleShowFloatingMenu}
			/>
		);

	const cwdBanner =
		agentCwd !== vaultPath && !isSameDirectory(agentCwd, vaultPath) ? (
			<div className="agent-client-cwd-banner" title={agentCwd}>
				<span
					className="agent-client-cwd-banner-icon"
					ref={(el) => {
						if (el) setIcon(el, "folder-open");
					}}
				/>
				<span className="agent-client-cwd-banner-path">{agentCwd}</span>
			</div>
		) : null;

	const planStrip =
		planEntries && planEntries.length > 0 && planSummary ? (
			<PlanStrip
				entries={planEntries}
				summary={planSummary}
				expanded={planExpanded}
				onToggle={togglePlan}
				showEmojis={settings.displaySettings.showEmojis}
			/>
		) : null;

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
			expandedToolCalls={expandedToolCalls}
			onToggleToolCall={toggleToolCall}
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
			activePermission={agent.activePermission}
			queuedPermissionCount={queuedPermissionCount}
			onApprovePermission={agent.approvePermission}
			autoMentionEnabled={settings.autoMentionActiveNote}
			restoredMessage={restoredMessage}
			suggestions={suggestions}
			plugin={plugin}
			view={viewHost}
			onSendMessage={handleSendMessageWithGeminiDismiss}
			onStopGeneration={handleStopGeneration}
			onRestoredMessageConsumed={handleRestoredMessageConsumed}
			modes={session.modes}
			onModeChange={(modeId) => void handleSetMode(modeId)}
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
			// Gemini CLI deprecation notice props
			geminiNotice={effectiveGeminiNotice}
			onClearGeminiNotice={handleClearGeminiNotice}
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
				{cwdBanner}
				{planStrip}
				<div className="agent-client-floating-content">
					<div className="agent-client-floating-messages-container">
						{messageListElement}
					</div>
					{inputAreaElement}
				</div>
			</>
		);
	}

	if (variant === "embedded") {
		return (
			<div
				ref={containerRef}
				className="agent-client-chat-view-container agent-client-embedded-chat-panel"
				style={chatFontSizeStyle}
			>
				<div className="agent-client-embedded-header">
					{headerElement}
				</div>
				{cwdBanner}
				{planStrip}
				<div className="agent-client-embedded-messages-container">
					{messageListElement}
				</div>
				{inputAreaElement}
			</div>
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
			{cwdBanner}
			{planStrip}
			{messageListElement}
			{inputAreaElement}
		</div>
	);
});
