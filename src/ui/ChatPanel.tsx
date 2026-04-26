import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import {
	Notice,
	FileSystemAdapter,
	Platform,
	Menu,
	setIcon,
	type MenuItem,
} from "obsidian";

import type { AttachedFile, ChatInputState } from "../types/chat";
import { useHistoryModal } from "../hooks/useHistoryModal";
import { useChatActions } from "../hooks/useChatActions";
import { ChangeDirectoryModal } from "./ChangeDirectoryModal";

// Service imports
import { getLogger } from "../utils/logger";

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
	type SlashCommand,
	type SessionModeState,
	type SessionModelState,
	type SessionConfigOption,
} from "../types/session";
import { checkAgentUpdate } from "../services/update-checker";

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
	/** Called when session state changes (for tab icon updates) */
	onStateChange?: (state: import("../types/tab").TabState) => void;
	/** Called when a suitable tab label is available (session title or first message) */
	onLabelChange?: (label: string) => void;
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
	onStateChange,
	onLabelChange,
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
	const settings = useSettings(plugin);

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

	const suggestions = useSuggestions(
		vaultService,
		plugin,
		session.availableCommands || EMPTY_COMMANDS,
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
			void agent.updateSessionFromLoad(
				sessionId,
				modes,
				models,
				configOptions,
			);
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

	// ============================================================
	// Refs
	// ============================================================
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
	);

	const {
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoredMessageConsumed,
		restoredMessage,
		agentUpdateNotification,
		setAgentUpdateNotification,
		autoExportIfEnabled,
	} = actions;

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
			try {
				await handleNewChat(requestedAgentId);
				// Persist agent ID for this view (survives Obsidian restart)
				if (requestedAgentId) {
					onAgentIdChanged?.(requestedAgentId);
				}
			} catch (error) {
				console.error("[Agent Client] New chat error:", error);
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
			try {
				// Auto-export current chat before switching
				if (messages.length > 0) {
					await autoExportIfEnabled("newChat", messages, session);
				}
				agent.clearMessages();
				setAgentCwd(directory);
				await agent.restartSession(undefined, directory);
				sessionHistory.invalidateCache();
			} catch (error) {
				console.error("[Agent Client] New chat in directory error:", error);
			}
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
					void agent.setConfigOption(modelOption.id, config.model);
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
			logger.log("[ChatPanel] Cleanup: auto-export and close session");
			void (async () => {
				try {
					await autoExportRef.current(
						"closeChat",
						messagesRef.current,
						sessionRef.current,
					);
					await closeSessionRef.current();
				} catch (error) {
					logger.error("[ChatPanel] Cleanup error:", error);
				}
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

			// System notification on response completion
			if (settings.enableSystemNotifications && !document.hasFocus()) {
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
			!document.hasFocus()
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
	// Effects - Tab State & Label Reporting
	// ============================================================
	useEffect(() => {
		if (!onStateChange) return;
		if (errorInfo) {
			onStateChange("error");
		} else if (agent.hasActivePermission) {
			onStateChange("permission");
		} else if (isSending) {
			onStateChange("busy");
		} else if (isSessionReady) {
			onStateChange("ready");
		} else {
			onStateChange("disconnected");
		}
	}, [
		onStateChange,
		errorInfo,
		agent.hasActivePermission,
		isSending,
		isSessionReady,
	]);

	// Report label from first user message
	const labelReportedRef = useRef(false);
	useEffect(() => {
		if (!onLabelChange || labelReportedRef.current) return;
		if (messages.length > 0) {
			const firstUserMsg = messages.find((m) => m.role === "user");
			if (firstUserMsg) {
				// content is MessageContent[] — extract text from the first text/text_with_context block
				const textBlock = firstUserMsg.content.find(
					(block) =>
						block.type === "text" ||
						block.type === "text_with_context",
				);
				const text =
					textBlock && "text" in textBlock ? textBlock.text : "";
				if (text.trim()) {
					onLabelChange(text.trim());
					labelReportedRef.current = true;
				}
			}
		}
	}, [onLabelChange, messages]);

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
						try {
							const success =
								await approveActivePermissionRef.current();
							if (!success) {
								new Notice(
									"[Agent Client] No active permission request",
								);
							}
						} catch (error) {
							console.error("[Agent Client] Approve permission error:", error);
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
						try {
							const success =
								await rejectActivePermissionRef.current();
							if (!success) {
								new Notice(
									"[Agent Client] No active permission request",
								);
							}
						} catch (error) {
							console.error("[Agent Client] Reject permission error:", error);
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
	inputValueRef.current = inputValue;
	attachedFilesRef.current = attachedFiles;
	isSessionReadyRef.current = isSessionReady;
	isSendingRef.current = isSending;
	sessionHistoryLoadingRef.current = sessionHistory.loading;
	handleSendMessageRef.current = handleSendMessage;

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

				try {
					await handleSendMessageRef.current(messageToSend, filesToSend);
				} catch (error) {
					console.error("[Agent Client] Send message error:", error);
				}
				return true;
			},
			cancelOperation: async () => {
				if (isSendingRef.current) {
					try {
						await handleStopGenerationRef.current();
					} catch (error) {
						console.error("[Agent Client] Cancel operation error:", error);
					}
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
				onShowMenu={handleShowSidebarMenu}
				onOpenHistory={handleOpenHistory}
			/>
		) : (
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
		);

	const cwdBanner =
		agentCwd !== vaultPath ? (
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
				{cwdBanner}
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
			{cwdBanner}
			{messageListElement}
			{inputAreaElement}
		</div>
	);
}
