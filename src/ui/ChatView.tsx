import { ItemView, WorkspaceLeaf } from "obsidian";
import type {
	IChatViewContainer,
	ChatViewType,
	SessionStatus,
} from "../services/view-registry";
import * as React from "react";
const { useMemo, useCallback } = React;
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

	// Stable so ChatPanel's title-update effect deps are value-stable.
	const handleSessionTitleChanged = useCallback(
		() => view.refreshDisplayText(),
		[view],
	);

	// ============================================================
	// Render
	// ============================================================
	return (
		<ChatContextProvider value={contextValue}>
			<ChatPanel
				variant="sidebar"
				viewId={viewId}
				// Read directly: the panel mounts only after setState has
				// delivered the view state (ChatView.renderPanel), and any
				// later setState re-renders this component, so the prop stays
				// current without a subscription.
				initialAgentId={view.getInitialAgentId() ?? undefined}
				viewHost={view}
				onRegisterCallbacks={(callbacks) =>
					view.setCallbacks(callbacks)
				}
				onAgentIdChanged={(agentId) => view.setAgentId(agentId)}
				onSessionTitleChanged={handleSessionTitleChanged}
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
	/** Fallback timer: mounts with defaults if setState never arrives. */
	private mountFallbackTimer: number | null = null;

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
		// Tab title == Session Manager title; fallback lives in getSessionTitle().
		return this.getSessionTitle();
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
	 * Mounts the React tree on the first call — the panel must not render
	 * before the view's state (which agent to launch) is known, or it would
	 * spawn the default agent and immediately kill it when the persisted id
	 * arrives. Later calls re-render so the panel picks up a changed id.
	 */
	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);
		this.renderPanel();
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

	getSessionStatus(): SessionStatus {
		return this.callbacks?.getSessionStatus() ?? "disconnected";
	}

	getSessionTitle(): string {
		return this.callbacks?.getSessionTitle() ?? "New session";
	}

	getSessionId(): string | null {
		return this.callbacks?.getSessionId() ?? null;
	}

	closeContainer(): void {
		this.leaf.detach();
	}

	refreshDisplayText(): void {
		// Undocumented WorkspaceLeaf.updateHeader() — Obsidian core uses the same internal method to refresh tab headers.
		const leaf = this.leaf as unknown as { updateHeader?: () => void };
		leaf.updateHeader?.();
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
		return this.containerEl.contains(activeDocument.activeElement);
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

	isExpanded(): boolean {
		return true;
	}

	/**
	 * Get the DOM container element for this view.
	 */
	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		// Create services owned by this class
		this.acpClient = this.plugin.getOrCreateAcpClient(this.viewId);
		this.vaultService = new VaultService(this.plugin);

		// Register with plugin's view registry
		this.plugin.viewRegistry.register(this);

		// Do NOT mount yet: Obsidian delivers the view state via setState()
		// during setViewState, and the panel must know which agent to launch
		// before it renders (mounting early spawns the default agent and
		// kills it when the persisted id arrives a moment later). The timer
		// is a safety net for any open path that skips setState — it mounts
		// with defaults, degrading to the pre-state-driven behavior.
		this.mountFallbackTimer = window.setTimeout(() => {
			this.renderPanel();
		}, 0);

		return Promise.resolve();
	}

	/**
	 * Mount (first call) or re-render (later calls) the React tree.
	 * Re-rendering the same element makes ChatComponent re-read
	 * getInitialAgentId(), so a setState that changes the agent flows into
	 * ChatPanel as a prop change and its mount-init guard re-initializes.
	 */
	private renderPanel(): void {
		// Any render supersedes the pending fallback mount: cancel it so it
		// cannot fire a redundant re-render after setState already mounted
		// the panel (on the normal path the timer always loses this race —
		// the setState chain is microtasks, the timer a macrotask).
		if (this.mountFallbackTimer !== null) {
			window.clearTimeout(this.mountFallbackTimer);
			this.mountFallbackTimer = null;
		}
		if (!this.root) {
			const container = this.containerEl.children[1];
			container.empty();
			this.root = createRoot(container);
		}
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");

		// Cancel a pending fallback mount (view closed within the tick).
		if (this.mountFallbackTimer !== null) {
			window.clearTimeout(this.mountFallbackTimer);
			this.mountFallbackTimer = null;
		}

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
