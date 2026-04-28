import { ItemView, WorkspaceLeaf, Menu, Notice, type MenuItem } from "obsidian";
import type {
	IChatViewContainer,
	ChatViewType,
} from "../services/view-registry";
import * as React from "react";
const { useEffect, useMemo, useCallback, useRef } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type { ChatInputState } from "../types/chat";
import type { TabState } from "../types/tab";

// Utility imports
import { getLogger, Logger } from "../utils/logger";

// Context imports
import { ChatContextProvider } from "./ChatContext";

// Component imports
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";
import { TabBar } from "./TabBar";
import { TabErrorBoundary } from "./TabErrorBoundary";
import { EditTitleModal } from "./SessionHistoryModal";

// Hook imports
import { useTabManager, truncateLabel } from "../hooks/useTabManager";

// Service imports
import { VaultService } from "../services/vault-service";
import type { AcpClient } from "../acp/acp-client";

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

// ============================================================================
// TabPanel — per-tab wrapper that memoizes context value
// ============================================================================

/**
 * Wrapper component for each tab that memoizes the ChatContextProvider value.
 * Without this, every ChatComponent re-render creates a new context value object
 * for every tab, causing all ChatPanel instances to re-render unnecessarily.
 * This was the root cause of I7 (context note toggle stops working after first use).
 */
function TabPanel({
	plugin,
	acpClient,
	vaultService,
	children,
}: {
	plugin: AgentClientPlugin;
	acpClient: AcpClient;
	vaultService: VaultService;
	children: React.ReactNode;
}) {
	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient,
			vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, acpClient, vaultService],
	);

	return (
		<ChatContextProvider value={contextValue}>
			{children}
		</ChatContextProvider>
	);
}

// ============================================================================
// ChatComponent — React root with tab management
// ============================================================================

function ChatComponent({
	plugin,
	view,
	viewId,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
}) {
	const initialAgentId =
		view.getInitialAgentId() ??
		plugin.settings.defaultAgentId;

	const tabManager = useTabManager(initialAgentId);
	const { tabs, activeTabId, activeTab } = tabManager;

	// ============================================================
	// Per-tab AcpClient management
	// ============================================================
	const acpClientsRef = useRef<Map<string, AcpClient>>(new Map());

	// Per-tab session ID tracking (for rename persistence to session history)
	const tabSessionIdsRef = useRef<Map<string, string | null>>(new Map());

	const getOrCreateClient = useCallback(
		(tabId: string): AcpClient => {
			let client = acpClientsRef.current.get(tabId);
			if (!client) {
				client = plugin.getOrCreateAcpClient(tabId);
				acpClientsRef.current.set(tabId, client);
			}
			return client;
		},
		[plugin],
	);

	const removeClient = useCallback(
		async (tabId: string) => {
			await plugin.removeAcpClient(tabId);
			acpClientsRef.current.delete(tabId);
			tabSessionIdsRef.current.delete(tabId);
		},
		[plugin],
	);

	// Cleanup all clients on unmount
	useEffect(() => {
		return () => {
			for (const tabId of acpClientsRef.current.keys()) {
				void plugin.removeAcpClient(tabId);
			}
			acpClientsRef.current.clear();
		};
	}, [plugin]);

	// Shared VaultService (one per view, not per tab)
	const vaultService = useMemo(
		() => view.vaultService,
		[view.vaultService],
	);

	// ============================================================
	// Agent ID restoration from Obsidian setState
	// ============================================================
	useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			// Update the active tab's agent
			tabManager.addTab(agentId);
		});
		return unsubscribe;
	}, [view, tabManager.addTab]);

	// ============================================================
	// Tab callbacks
	// ============================================================
	const handleAddTab = useCallback(() => {
		const maxTabs = plugin.settings.maxSessionTabs ?? 10;
		if (tabs.length >= maxTabs) {
			new Notice(
				`[Agent Client] Maximum ${maxTabs} tabs reached`,
			);
			return;
		}
		tabManager.addTab(activeTab.agentId);
	}, [tabManager, activeTab.agentId, tabs.length, plugin.settings]);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			if (tabs.length <= 1) return; // Don't close last tab
			void removeClient(tabId);
			tabManager.removeTab(tabId);
		},
		[tabs.length, removeClient, tabManager],
	);

	const handleCloseOtherTabs = useCallback(
		(tabId: string) => {
			for (const tab of tabs) {
				if (tab.tabId !== tabId) {
					void removeClient(tab.tabId);
				}
			}
			tabManager.removeOtherTabs(tabId);
		},
		[tabs, removeClient, tabManager],
	);

	const handleCloseTabsToRight = useCallback(
		(tabId: string) => {
			const idx = tabs.findIndex((t) => t.tabId === tabId);
			for (let i = idx + 1; i < tabs.length; i++) {
				void removeClient(tabs[i].tabId);
			}
			tabManager.removeTabsToRight(tabId);
		},
		[tabs, removeClient, tabManager],
	);

	const handleRenameTab = useCallback(
		(tabId: string) => {
			const tab = tabs.find((t) => t.tabId === tabId);
			if (!tab) return;

			const modal = new EditTitleModal(
				plugin.app,
				tab.label,
				async (newTitle) => {
					const duplicate = tabs.find(
						(t) =>
							t.tabId !== tabId &&
							t.label === truncateLabel(newTitle),
					);
					if (duplicate) {
						new Notice(
							"[Agent Client] A tab with that name already exists",
						);
						return;
					}
					tabManager.setTabLabel(tabId, newTitle);

					// Persist to session history if this tab has a session
					const sessionId = tabSessionIdsRef.current.get(tabId);
					if (sessionId) {
						const saved = plugin.settingsService
							.getSavedSessions()
							.find((s) => s.sessionId === sessionId);
						if (saved) {
							await plugin.settingsService.saveSession({
								...saved,
								title: newTitle,
								updatedAt: new Date().toISOString(),
							});
						}
					}
				},
			);
			modal.open();
		},
		[tabs, plugin, tabManager],
	);

	const handleAddTabWithAgent = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const maxTabs = plugin.settings.maxSessionTabs ?? 10;
			if (tabs.length >= maxTabs) {
				new Notice(
					`[Agent Client] Maximum ${maxTabs} tabs reached`,
				);
				return;
			}
			const menu = new Menu();
			const agents = plugin.getAvailableAgents();
			for (const agent of agents) {
				menu.addItem((item: MenuItem) => {
					item.setTitle(agent.displayName).onClick(() => {
						tabManager.addTab(agent.id);
					});
				});
			}
			menu.showAtMouseEvent(e.nativeEvent);
		},
		[plugin, tabs.length, tabManager],
	);

	// ============================================================
	// State change callback for tab icons
	// ============================================================
	const handleTabStateChange = useCallback(
		(tabId: string, state: TabState) => {
			tabManager.setTabState(tabId, state);
		},
		[tabManager],
	);

	const handleTabLabelChange = useCallback(
		(tabId: string, label: string) => {
			if (label === "") {
				tabManager.resetTab(tabId);
			} else {
				tabManager.setTabLabel(tabId, label);
			}
		},
		[tabManager],
	);

	const handleSessionIdChange = useCallback(
		(tabId: string, sessionId: string | null) => {
			tabSessionIdsRef.current.set(tabId, sessionId);
		},
		[],
	);

	/** Find a tab that owns the given session ID (for I20: avoid restoring an already-open session) */
	const findTabBySessionId = useCallback(
		(sessionId: string): { tabId: string; label: string } | null => {
			for (const [tabId, sid] of tabSessionIdsRef.current) {
				if (sid === sessionId) {
					const tab = tabs.find((t) => t.tabId === tabId);
					if (tab) return { tabId: tab.tabId, label: tab.label };
				}
			}
			return null;
		},
		[tabs],
	);

	// ============================================================
	// Register callbacks for IChatViewContainer (active tab only)
	// ============================================================
	const activeCallbacksRef = useRef<ChatPanelCallbacks | null>(null);

	useEffect(() => {
		view.setCallbacks({
			getDisplayName: () =>
				activeCallbacksRef.current?.getDisplayName() ?? "Chat",
			getInputState: () =>
				activeCallbacksRef.current?.getInputState() ?? null,
			setInputState: (state) =>
				activeCallbacksRef.current?.setInputState(state),
			canSend: () =>
				activeCallbacksRef.current?.canSend() ?? false,
			sendMessage: async () =>
				(await activeCallbacksRef.current?.sendMessage()) ??
				false,
			cancelOperation: async () =>
				activeCallbacksRef.current?.cancelOperation(),
		});
	}, [view]);

	// ============================================================
	// Persist agent ID when active tab changes
	// ============================================================
	useEffect(() => {
		view.setAgentId(activeTab.agentId);
	}, [view, activeTab.agentId]);

	// Expose tabManager to the view class for commands
	useEffect(() => {
		view.setTabManager(tabManager);
	}, [view, tabManager]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<TabBar
				tabs={tabs}
				activeTabId={activeTabId}
				onSelectTab={tabManager.setActiveTab}
				onAddTab={handleAddTab}
				onCloseTab={handleCloseTab}
				onCloseOtherTabs={handleCloseOtherTabs}
				onCloseTabsToRight={handleCloseTabsToRight}
				onRenameTab={handleRenameTab}
				onMoveTab={tabManager.moveTab}
				onAddTabWithAgent={handleAddTabWithAgent}
			/>
			{tabs.map((tab) => (
				<div
					key={tab.tabId}
					className="agent-client-tab-panel"
					style={{
						display:
							tab.tabId === activeTabId
								? "flex"
								: "none",
						flexDirection: "column" as const,
						flex: 1,
						minHeight: 0,
					}}
				>
					<TabErrorBoundary
						tabId={tab.tabId}
						onError={(tabId) =>
							handleTabStateChange(tabId, "error")
						}
						onRetry={(tabId) => tabManager.resetTab(tabId)}
					>
						<TabPanel
							plugin={plugin}
							acpClient={getOrCreateClient(tab.tabId)}
							vaultService={vaultService}
						>
							<ChatPanel
								variant="sidebar"
								viewId={tab.tabId}
								initialAgentId={tab.agentId}
								viewHost={view}
								isActive={tab.tabId === activeTabId}
								onRegisterCallbacks={(callbacks) => {
									if (tab.tabId === activeTabId) {
										activeCallbacksRef.current =
											callbacks;
									}
								}}
								onAgentIdChanged={(agentId) =>
									view.setAgentId(agentId)
								}
								onStateChange={(state) =>
									handleTabStateChange(
										tab.tabId,
										state,
									)
								}
								onLabelChange={(label) =>
									handleTabLabelChange(
										tab.tabId,
										label,
									)
								}
								onSessionIdChange={(sessionId) =>
									handleSessionIdChange(
										tab.tabId,
										sessionId,
									)
								}
								findTabBySessionId={findTabBySessionId}
								onSwitchToTab={tabManager.setActiveTab}
							/>
						</TabPanel>
					</TabErrorBoundary>
				</div>
			))}
		</div>
	);
}

// ============================================================================
// ChatView State
// ============================================================================

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

// ============================================================================
// ChatView Class
// ============================================================================

export class ChatView extends ItemView implements IChatViewContainer {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	/** Unique identifier for this view instance */
	readonly viewId: string;
	/** View type for IChatViewContainer */
	readonly viewType: ChatViewType = "sidebar";
	/** Initial agent ID passed via state */
	private initialAgentId: string | null = null;
	/** Callbacks to notify React when agentId is restored */
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> =
		new Set();

	// Services owned by this class
	/** @internal Exposed to ChatComponent for context creation */
	vaultService!: VaultService;

	// Callbacks from ChatPanel for IChatViewContainer delegation
	private callbacks: ChatPanelCallbacks | null = null;

	// Tab manager reference (set by React component)
	private tabManagerRef: ReturnType<typeof useTabManager> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = getLogger();
		this.navigation = false;
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

	getState(): ChatViewState {
		return {
			initialAgentId: this.initialAgentId ?? undefined,
		};
	}

	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		const previousAgentId = this.initialAgentId;
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);

		if (this.initialAgentId && this.initialAgentId !== previousAgentId) {
			this.agentIdRestoredCallbacks.forEach((cb) =>
				cb(this.initialAgentId!),
			);
		}
	}

	getInitialAgentId(): string | null {
		return this.initialAgentId;
	}

	setAgentId(agentId: string): void {
		this.initialAgentId = agentId;
		this.app.workspace.requestSaveLayout();
	}

	onAgentIdRestored(callback: (agentId: string) => void): () => void {
		this.agentIdRestoredCallbacks.add(callback);
		return () => {
			this.agentIdRestoredCallbacks.delete(callback);
		};
	}

	// ============================================================
	// Tab Manager (set by React component)
	// ============================================================

	setTabManager(
		manager: ReturnType<typeof useTabManager> | null,
	): void {
		this.tabManagerRef = manager;
	}

	/** Add a new tab (for Obsidian commands) */
	addTab(agentId?: string): void {
		if (this.tabManagerRef) {
			this.tabManagerRef.addTab(
				agentId ?? this.plugin.settings.defaultAgentId,
			);
		}
	}

	/** Get the active tab's ID (used as viewId by ChatPanel) */
	getActiveTabId(): string {
		return this.tabManagerRef?.activeTabId ?? this.viewId;
	}

	/** Close the active tab (for Obsidian commands) */
	closeActiveTab(): void {
		if (this.tabManagerRef) {
			this.tabManagerRef.removeTab(
				this.tabManagerRef.activeTabId,
			);
		}
	}

	/** Switch to next tab (for Obsidian commands) */
	nextTab(): void {
		this.tabManagerRef?.nextTab();
	}

	/** Switch to previous tab (for Obsidian commands) */
	prevTab(): void {
		this.tabManagerRef?.prevTab();
	}

	// ============================================================
	// Callbacks from ChatPanel
	// ============================================================

	setCallbacks(callbacks: ChatPanelCallbacks): void {
		this.callbacks = callbacks;
	}

	getDisplayName(): string {
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	onActivate(): void {
		this.logger.log(`[ChatView] Activated: ${this.viewId}`);
	}

	onDeactivate(): void {
		this.logger.log(`[ChatView] Deactivated: ${this.viewId}`);
	}

	focus(): void {
		void this.app.workspace.revealLeaf(this.leaf).then(() => {
			const textarea = this.containerEl.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	hasFocus(): boolean {
		return this.containerEl.contains(document.activeElement);
	}

	expand(): void {
		// Sidebar views don't have expand/collapse state
	}

	collapse(): void {
		// Sidebar views don't have expand/collapse state
	}

	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		// VaultService is shared across all tabs in this view
		this.vaultService = new VaultService(this.plugin);

		this.root = createRoot(container);
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);

		this.plugin.viewRegistry.register(this);
		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");

		this.plugin.viewRegistry.unregister(this.viewId);

		// React cleanup handles per-tab AcpClient disconnection
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		this.vaultService?.destroy();
		this.tabManagerRef = null;
	}
}
