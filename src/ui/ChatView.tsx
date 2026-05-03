import { ItemView, WorkspaceLeaf } from "obsidian";
import type {
	IChatViewContainer,
	ChatViewType,
} from "../services/view-registry";
import * as React from "react";
const { useState, useEffect, useMemo } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../plugin";
import type { ChatInputState } from "../types/chat";

// Utility imports
import { getLogger, Logger } from "../utils/logger";

// Context imports
import { ChatContextProvider } from "./ChatContext";

// Component imports
import { ChatPanel, type ChatPanelCallbacks } from "./ChatPanel";

// Service imports
import { VaultService } from "../services/vault-service";

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
	// Agent ID State (synced with Obsidian view state)
	// ============================================================
	const [restoredAgentId, setRestoredAgentId] = useState<string | undefined>(
		view.getInitialAgentId() ?? undefined,
	);

	// ============================================================
	// Context Value
	// ============================================================
	const contextValue = useMemo(
		() => ({
			plugin,
			acpClient: view.acpClient,
			vaultService: view.vaultService,
			settingsService: plugin.settingsService,
		}),
		[plugin, view.acpClient, view.vaultService],
	);

	// ============================================================
	// Agent ID Restoration (ChatView-specific)
	// Subscribe to agentId restoration from Obsidian's setState
	// ============================================================
	useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			setRestoredAgentId(agentId);
		});
		return unsubscribe;
	}, [view]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<ChatContextProvider value={contextValue}>
			<ChatPanel
				variant="sidebar"
				viewId={viewId}
				initialAgentId={restoredAgentId}
				viewHost={view}
				onRegisterCallbacks={(callbacks) =>
					view.setCallbacks(callbacks)
				}
				onAgentIdChanged={(agentId) => view.setAgentId(agentId)}
			/>
		</ChatContextProvider>
	);
}

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

export class ChatView extends ItemView implements IChatViewContainer {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	/** Unique identifier for this view instance (for multi-session support) */
	readonly viewId: string;
	/** View type for IChatViewContainer */
	readonly viewType: ChatViewType = "sidebar";
	/** Initial agent ID passed via state (for openNewChatViewWithAgent) */
	private initialAgentId: string | null = null;
	/** Callbacks to notify React when agentId is restored from workspace state */
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> =
		new Set();

	// Services owned by this class (lifecycle managed here)
	/** @internal Exposed to ChatComponent for context creation */
	acpClient!: ReturnType<AgentClientPlugin["getOrCreateAcpClient"]>;
	/** @internal Exposed to ChatComponent for context creation */
	vaultService!: VaultService;

	// Callbacks from ChatPanel for IChatViewContainer delegation
	private callbacks: ChatPanelCallbacks | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = getLogger();
		// Static sidebar view (not navigable) — hides .view-header
		this.navigation = false;
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
	// Callbacks from ChatPanel
	// ============================================================

	/**
	 * Register callbacks from ChatPanel for IChatViewContainer delegation.
	 */
	setCallbacks(callbacks: ChatPanelCallbacks): void {
		this.callbacks = callbacks;
	}

	getDisplayName(): string {
		return this.callbacks?.getDisplayName() ?? "Chat";
	}

	getSessionStatus(): "ready" | "busy" | "permission" | "error" | "disconnected" {
		return this.callbacks?.getSessionStatus() ?? "disconnected";
	}

	getSessionTitle(): string {
		return this.callbacks?.getSessionTitle() ?? "New session";
	}

	getSessionId(): string | null {
		return this.callbacks?.getSessionId() ?? null;
	}

	setSessionTitle(title: string): void {
		this.callbacks?.setSessionTitle(title);
	}

	/**
	 * Get current input state (text + images).
	 * Returns null if React component not mounted.
	 */
	getInputState(): ChatInputState | null {
		return this.callbacks?.getInputState() ?? null;
	}

	/**
	 * Set input state (text + images).
	 */
	setInputState(state: ChatInputState): void {
		this.callbacks?.setInputState(state);
	}

	/**
	 * Trigger send message. Returns true if message was sent.
	 */
	async sendMessage(): Promise<boolean> {
		return (await this.callbacks?.sendMessage()) ?? false;
	}

	/**
	 * Check if this view can send a message.
	 */
	canSend(): boolean {
		return this.callbacks?.canSend() ?? false;
	}

	/**
	 * Cancel current operation.
	 */
	async cancelOperation(): Promise<void> {
		await this.callbacks?.cancelOperation();
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	/**
	 * Called when this view becomes the active/focused view.
	 */
	onActivate(): void {
		this.logger.log(`[ChatView] Activated: ${this.viewId}`);
	}

	/**
	 * Called when this view loses active/focused status.
	 */
	onDeactivate(): void {
		this.logger.log(`[ChatView] Deactivated: ${this.viewId}`);
	}

	/**
	 * Programmatically focus this view's input.
	 * Reveals the leaf first so that Obsidian switches to this tab
	 * before focusing the textarea (required for sidebar tabs).
	 */
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

	/**
	 * Check if this view currently has focus.
	 */
	hasFocus(): boolean {
		return this.containerEl.contains(document.activeElement);
	}

	/**
	 * Expand the view if it's in a collapsed state.
	 * Sidebar views don't have expand/collapse state - no-op.
	 */
	expand(): void {
		// Sidebar views don't have expand/collapse state - no-op
	}

	collapse(): void {
		// Sidebar views don't have expand/collapse state - no-op
	}

	/**
	 * Get the DOM container element for this view.
	 */
	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		// Create services owned by this class
		this.acpClient = this.plugin.getOrCreateAcpClient(this.viewId);
		this.vaultService = new VaultService(this.plugin);

		this.root = createRoot(container);
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);

		// Register with plugin's view registry
		this.plugin.viewRegistry.register(this);

		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");

		// Unregister from plugin's view registry
		this.plugin.viewRegistry.unregister(this.viewId);

		// Cleanup is handled by React useEffect cleanup in ChatPanel
		// which performs auto-export and closeSession
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		// Cleanup services owned by this class
		this.vaultService?.destroy();

		// Remove adapter for this view (disconnect process)
		await this.plugin.removeAcpClient(this.viewId);
	}
}
