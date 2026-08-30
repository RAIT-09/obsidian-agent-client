import {
	Plugin,
	WorkspaceLeaf,
	Notice,
	requestUrl,
	MarkdownRenderChild,
	type MarkdownPostProcessorContext,
	TFile,
} from "obsidian";
import * as semver from "semver";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
import {
	mountCodeBlockChat,
	EmbeddedChatViewContainer,
} from "./ui/CodeBlockChatView";
import { mountAgentButtonBlock } from "./ui/AgentButtonBlock";
import { parseAgentBlock } from "./utils/agent-block-parser";
import {
	SessionManagerView,
	VIEW_TYPE_SESSION_MANAGER,
} from "./ui/SessionManagerView";
import {
	createFloatingChat,
	FloatingViewContainer,
} from "./ui/FloatingChatView";
import { FloatingButtonContainer } from "./ui/FloatingButton";
import { ChatViewRegistry } from "./services/view-registry";
import {
	createSettingsService,
	type SettingsService,
} from "./services/settings-service";
import { AgentClientSettingTab } from "./ui/SettingsTab";
import { AcpClient } from "./acp/acp-client";
import {
	absorbCustomAgents,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
	normalizePresetAgents,
	defaultPresetAgentSettings,
	resolveDefaultAgentId,
	type ApiKeyMigrator,
	parseChatFontSize,
	str,
	bool,
	num,
	enumVal,
	obj,
	strRecord,
	nestedStrRecord,
	xyPoint,
} from "./services/settings-normalizer";
import { PRESET_AGENTS } from "./services/preset-agents";
import {
	getAvailableAgentsFromSettings,
	getAllAgentsFromSettings,
	findAgentSettings,
	isAgentEnabled,
	firstEnabledAgentId,
	repairNoEnabledAgents,
} from "./services/session-helpers";
import {
	AgentEnvVar,
	PresetAgentUserSettings,
	CustomAgentSettings,
} from "./types/agent";
import type { SavedSessionInfo } from "./types/session";
import { initializeLogger, getLogger } from "./utils/logger";

// Re-export for backward compatibility
export type { AgentEnvVar, PresetAgentUserSettings, CustomAgentSettings };

/**
 * Generate a short, device-neutral block id for persist embedded chats.
 * 16 hex chars derived from crypto.randomUUID — enough entropy for per-note
 * blocks, short enough to hand-edit. Mirrors crypto.randomUUID usage already
 * present across the codebase (e.g. ui/ChatView.tsx, services/message-state.ts).
 */
function generateEmbedId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

/**
 * Chat view location configuration.
 * - 'right-tab': Open in right pane as tabs (default)
 * - 'right-split': Open in right pane with vertical split
 * - 'editor-tab': Open in editor area as tabs
 * - 'editor-split': Open in editor area with right split
 */
export type ChatViewLocation =
	| "right-tab"
	| "right-split"
	| "editor-tab"
	| "editor-split";

export interface AgentClientPluginSettings {
	/**
	 * Per-preset user overrides, keyed by presetId (see
	 * services/preset-agents.ts for the static registry). Normalization
	 * guarantees an entry for every registry preset; unknown keys written by
	 * a newer plugin version are preserved but never enumerated.
	 */
	presetAgents: Record<string, PresetAgentUserSettings>;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
	/** Surface `[[wikilinks]]` inside note content as resolved metadata so the agent can decide which links to follow */
	expandWikilinkContext: boolean;
	/** Show OS system notifications on response completion and permission requests */
	enableSystemNotifications: boolean;
	/** Prompt injection settings for Obsidian-flavored Markdown guidance */
	promptInjection: {
		/** Master toggle for prompt injection */
		enabled: boolean;
		/** Inject LaTeX math formatting instructions ($...$ and $$...$$) */
		latex: boolean;
		/** Instruct agents to use [[Note Name]] wikilink syntax */
		wikiLinks: boolean;
		/** Instruct agents to leave a blank line before Markdown tables */
		tables: boolean;
	};
	debugMode: boolean;
	nodePath: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
		includeImages: boolean;
		imageLocation: "obsidian" | "custom" | "base64";
		imageCustomFolder: string;
		includeAudios: boolean;
		audioLocation: "obsidian" | "custom";
		audioCustomFolder: string;
		frontmatterTag: string;
	};
	// WSL settings (Windows only)
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	// Input behavior
	sendMessageShortcut: SendMessageShortcut;
	// View settings
	chatViewLocation: ChatViewLocation;
	// Display settings
	displaySettings: {
		autoCollapseDiffs: boolean;
		diffCollapseThreshold: number;
		maxNoteLength: number;
		maxSelectionLength: number;
		showEmojis: boolean;
		fontSize: number | null;
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	// Last used model per agent (agentId → modelId)
	lastUsedModels: Record<string, string>;
	// Last used mode per agent (agentId → modeId)
	lastUsedModes: Record<string, string>;
	// Last used non-model/mode config options per agent (agentId → {optionId → value})
	lastUsedConfigOptions: Record<string, Record<string, string>>;
	// Floating chat settings
	enableFloatingChat: boolean;
	floatingButtonImage: string;
	floatingWindowSize: { width: number; height: number };
	floatingWindowPosition: { x: number; y: number } | null;
	floatingButtonPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	presetAgents: Object.fromEntries(
		PRESET_AGENTS.map((def) => [
			def.presetId,
			defaultPresetAgentSettings(def),
		]),
	),
	customAgents: [],
	defaultAgentId: PRESET_AGENTS[0].presetId,
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	expandWikilinkContext: true,
	enableSystemNotifications: true,
	promptInjection: {
		enabled: true,
		latex: true,
		wikiLinks: true,
		tables: true,
	},
	debugMode: false,
	nodePath: "",
	exportSettings: {
		defaultFolder: "Agent Client",
		filenameTemplate: "agent_client_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "Agent Client",
		includeAudios: true,
		audioLocation: "obsidian",
		audioCustomFolder: "Agent Client",
		frontmatterTag: "agent-client",
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
	chatViewLocation: "right-tab",
	displaySettings: {
		autoCollapseDiffs: false,
		diffCollapseThreshold: 10,
		maxNoteLength: 10000,
		maxSelectionLength: 10000,
		showEmojis: true,
		fontSize: null,
	},
	savedSessions: [],
	lastUsedModels: {},
	lastUsedModes: {},
	lastUsedConfigOptions: {},
	enableFloatingChat: false,
	floatingButtonImage: "",
	floatingWindowSize: { width: 400, height: 500 },
	floatingWindowPosition: null,
	floatingButtonPosition: null,
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsService!: SettingsService;

	/** Registry for all chat view containers (sidebar + floating) */
	viewRegistry = new ChatViewRegistry();

	/** Map of viewId to AcpClient for multi-session support */
	private _acpClients: Map<string, AcpClient> = new Map();
	/**
	 * Pending-prompt handlers keyed by viewId. A ChatPanel registers its
	 * handler on mount; runPromptInChat delivers through it (deterministic
	 * handshake that replaces a timed workspace broadcast).
	 */
	private _pendingPromptHandlers = new Map<
		string,
		(prompt: string, autoSend: boolean) => void
	>();
	/** Prompts queued before their target ChatPanel registered a handler. */
	private _pendingPrompts = new Map<
		string,
		Array<{ prompt: string; autoSend: boolean }>
	>();
	/**
	 * Pending graceful AcpClient teardown timers, keyed by viewId. An embedded
	 * block schedules teardown on unmount and cancels it on (re)mount, so
	 * re-processing churn keeps one client while genuine removal reaps it.
	 */
	private _acpTeardownTimers = new Map<string, number>();
	/** Floating button container (independent from chat view instances) */
	private floatingButton: FloatingButtonContainer | null = null;
	/** Counter for generating unique floating chat instance IDs */
	private floatingChatCounter = 0;
	/** Guards against concurrent embed-id injection for the same block. */
	private embedIdInjectionInFlight = new Set<string>();

	async onload() {
		await this.loadSettings();

		initializeLogger(this.settings);

		// Initialize settings store
		this.settingsService = createSettingsService(this.settings, this);

		// Detach stale leaves from a previous plugin instance to prevent
		// "Attempting to register an existing view type" when Obsidian's
		// hot-reload races onunload/onload (e.g. rapid toggle or npm run dev).
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SESSION_MANAGER);
		this.registerView(
			VIEW_TYPE_SESSION_MANAGER,
			(leaf) => new SessionManagerView(leaf, this),
		);

		const ribbonIconEl = this.addRibbonIcon(
			"bot-message-square",
			"Open agent client",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("agent-client-ribbon-icon");

		this.addCommand({
			id: "open-chat-view",
			name: "Open chat view",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "focus-next-chat-view",
			name: "Focus next chat view",
			callback: () => {
				this.focusChatView("next");
			},
		});

		this.addCommand({
			id: "focus-previous-chat-view",
			name: "Focus previous chat view",
			callback: () => {
				this.focusChatView("previous");
			},
		});

		this.addCommand({
			id: "open-new-chat-view",
			name: "Open new chat view",
			callback: () => {
				void this.openNewChatViewWithAgent(
					this.settings.defaultAgentId,
				);
			},
		});

		this.addCommand({
			id: "open-session-manager",
			name: "Open session manager",
			callback: () => {
				void this.activateSessionManager();
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();
		this.registerBroadcastCommands();

		// Floating chat window commands
		this.addCommand({
			id: "open-floating-chat-view",
			name: "Open floating chat view",
			checkCallback: (checking) => {
				if (!this.settings.enableFloatingChat) return false;
				if (checking) return true;
				const instances = this.getFloatingChatInstances();
				if (instances.length === 0) {
					this.openNewFloatingChat(true);
				} else if (instances.length === 1) {
					this.expandFloatingChat(instances[0]);
				} else {
					const focused = this.viewRegistry.getFocused();
					if (focused && focused.viewType === "floating") {
						focused.expand();
					} else {
						this.expandFloatingChat(
							instances[instances.length - 1],
						);
					}
				}
			},
		});

		this.addCommand({
			id: "open-new-floating-chat-view",
			name: "Open new floating chat view",
			checkCallback: (checking) => {
				if (!this.settings.enableFloatingChat) return false;
				if (checking) return true;
				this.openNewFloatingChat(true);
			},
		});

		this.addCommand({
			id: "minimize-floating-chat-view",
			name: "Minimize floating chat view",
			checkCallback: (checking) => {
				if (!this.settings.enableFloatingChat) return false;
				const focused = this.viewRegistry.getFocused();
				if (!(focused && focused.viewType === "floating")) return false;
				if (checking) return true;
				focused.collapse();
			},
		});

		this.addCommand({
			id: "close-floating-chat-view",
			name: "Close floating chat view",
			checkCallback: (checking) => {
				if (!this.settings.enableFloatingChat) return false;
				const focused = this.viewRegistry.getFocused();
				if (!(focused && focused.viewType === "floating")) return false;
				if (checking) return true;
				this.closeFloatingChat(focused.viewId);
			},
		});

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor(
			"agent-client",
			(source, el, ctx) => this.renderAgentBlock(source, el, ctx),
		);
		this.registerMarkdownCodeBlockProcessor("agent", (source, el, ctx) =>
			this.renderAgentBlock(source, el, ctx),
		);

		// Mount floating button (always present; visibility controlled by settings inside component)
		this.floatingButton = new FloatingButtonContainer(this);
		this.floatingButton.mount();

		// Mount initial floating chat instance only if enabled
		if (this.settings.enableFloatingChat) {
			this.openNewFloatingChat();
		}

		// Clean up all ACP sessions when Obsidian quits
		// Note: We don't wait for disconnect to complete to avoid blocking quit
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				// Fire and forget - don't block Obsidian from quitting
				for (const [viewId, client] of this._acpClients) {
					client.disconnect().catch((error) => {
						getLogger().warn(
							`[AgentClient] Quit cleanup error for view ${viewId}:`,
							error,
						);
					});
				}
				this._acpClients.clear();
			}),
		);

		// Keep the focused chat view in sync when the active leaf changes
		// (e.g. clicking a chat tab in the tab bar). ChatPanel's DOM
		// focus/click listeners only fire on interaction inside the view, so a
		// tab-bar switch would otherwise leave the Session Manager highlight on
		// the previous view until the user clicks into the new one.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof ChatView) {
					this.setLastActiveChatViewId(leaf.view.viewId);
				}
			}),
		);
	}

	onunload() {
		// Unmount floating button
		this.floatingButton?.unmount();
		this.floatingButton = null;

		// Unmount all floating chat instances via registry
		for (const container of this.viewRegistry.getByType("floating")) {
			if (container instanceof FloatingViewContainer) {
				container.unmount();
			}
		}

		// Unmount all embedded chat instances via registry. Their host
		// MarkdownRenderChild is owned by the workspace (not the plugin), so the
		// React roots are not torn down by plugin unload unless we do it here.
		for (const container of this.viewRegistry.getByType("embedded")) {
			if (container instanceof EmbeddedChatViewContainer) {
				container.unmount();
			}
		}

		// Clear registry (sidebar views are managed by Obsidian workspace)
		this.viewRegistry.clear();

		// Disconnect all ACP clients (kill agent processes)
		for (const [, client] of this._acpClients) {
			client.disconnect().catch(() => {});
		}
		this._acpClients.clear();

		// Drop any undelivered pending-prompt handlers and queued prompts.
		this._pendingPromptHandlers.clear();
		this._pendingPrompts.clear();

		// Cancel any pending graceful AcpClient teardowns.
		for (const timer of this._acpTeardownTimers.values()) {
			window.clearTimeout(timer);
		}
		this._acpTeardownTimers.clear();
	}

	/**
	 * Get or create an AcpClient for a specific view.
	 * Each ChatView has its own AcpClient for independent sessions.
	 */
	getOrCreateAcpClient(viewId: string): AcpClient {
		let client = this._acpClients.get(viewId);
		if (!client) {
			client = new AcpClient(this);
			this._acpClients.set(viewId, client);
		}
		return client;
	}

	/**
	 * Update auto-allow permission setting on all live AcpClient instances.
	 * Called when the setting changes at runtime.
	 */
	updateAllAutoAllow(autoAllow: boolean): void {
		for (const client of this._acpClients.values()) {
			client.updateAutoAllow(autoAllow);
		}
	}

	/**
	 * Remove and disconnect the AcpClient for a specific view.
	 * Called when a ChatView is closed.
	 */
	async removeAcpClient(viewId: string): Promise<void> {
		const client = this._acpClients.get(viewId);
		if (client) {
			try {
				await client.disconnect();
			} catch (error) {
				getLogger().warn(
					`[AgentClient] Failed to disconnect client for view ${viewId}:`,
					error,
				);
			}
			this._acpClients.delete(viewId);
		}
		// Note: lastActiveChatViewId is now managed by viewRegistry
		// Clearing happens automatically when view is unregistered
	}

	/** Grace window before an embedded AcpClient is actually disconnected. */
	private static readonly ACP_TEARDOWN_GRACE_MS = 250;

	/** Cancel a pending graceful teardown for a viewId (called on (re)mount). */
	acquireAcpClient(viewId: string): void {
		const timer = this._acpTeardownTimers.get(viewId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this._acpTeardownTimers.delete(viewId);
		}
	}

	/**
	 * Schedule a graceful teardown of a viewId's AcpClient. A re-acquire within
	 * the grace window cancels it, so a rapid unmount/remount (re-processing)
	 * keeps one client; only genuine removal disconnects the agent process.
	 */
	releaseAcpClient(viewId: string): void {
		if (this._acpTeardownTimers.has(viewId)) return;
		const timer = window.setTimeout(() => {
			this._acpTeardownTimers.delete(viewId);
			void this.removeAcpClient(viewId);
		}, AgentClientPlugin.ACP_TEARDOWN_GRACE_MS);
		this._acpTeardownTimers.set(viewId, timer);
	}

	/**
	 * Get the last active ChatView ID for keybind targeting.
	 */
	get lastActiveChatViewId(): string | null {
		return this.viewRegistry.getFocusedId();
	}

	/**
	 * Set the last active ChatView ID.
	 * Called when a ChatView receives focus or interaction.
	 */
	setLastActiveChatViewId(viewId: string | null): void {
		if (viewId) {
			this.viewRegistry.setFocused(viewId);
		}
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			// Find the leaf matching lastActiveChatViewId, or fall back to first leaf
			const focusedId = this.lastActiveChatViewId;
			if (focusedId) {
				leaf =
					leaves.find(
						(l) => (l.view as ChatView)?.viewId === focusedId,
					) || leaves[0];
			} else {
				leaf = leaves[0];
			}
		} else {
			leaf = this.createNewChatLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			this.focusTextarea(leaf);
		}
	}

	async activateSessionManager(): Promise<void> {
		const { workspace } = this.app;

		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SESSION_MANAGER);
		if (leaves.length > 0) {
			await workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_SESSION_MANAGER,
				active: true,
			});
			await workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Close a specific chat view (sidebar or floating).
	 * Dispatch is via IChatViewContainer.closeContainer(); plugin does not
	 * need to know the concrete container class.
	 */
	closeView(viewId: string): void {
		this.viewRegistry.get(viewId)?.closeContainer();
	}

	/**
	 * Focus the textarea in a ChatView leaf.
	 */
	private focusTextarea(leaf: WorkspaceLeaf): void {
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 50);
		}
	}

	/**
	 * Focus the next or previous ChatView in the list.
	 * Uses ChatViewRegistry which includes both sidebar and floating views.
	 */
	private focusChatView(direction: "next" | "previous"): void {
		if (direction === "next") {
			this.viewRegistry.focusNext();
		} else {
			this.viewRegistry.focusPrevious();
		}
	}

	/**
	 * Create a new leaf for ChatView based on the configured location setting.
	 * @param isAdditional - true when opening additional views (e.g., Open New View)
	 */
	private createNewChatLeaf(isAdditional: boolean): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const location = this.settings.chatViewLocation;

		switch (location) {
			case "right-tab":
				if (isAdditional) {
					return this.createSidebarTab("right");
				}
				return workspace.getRightLeaf(false);
			case "right-split":
				return workspace.getRightLeaf(isAdditional);
			case "editor-tab":
				return workspace.getLeaf("tab");
			case "editor-split":
				return workspace.getLeaf("split");
			default:
				return workspace.getRightLeaf(false);
		}
	}

	/**
	 * Create a new tab within an existing sidebar tab group.
	 * Uses the parent of an existing chat leaf to add a sibling tab,
	 * avoiding the vertical split caused by getRightLeaf(true).
	 */
	private createSidebarTab(side: "right" | "left"): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const split =
			side === "right" ? workspace.rightSplit : workspace.leftSplit;

		// Find an existing chat leaf in this sidebar to get its tab group
		const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		const sidebarLeaf = existingLeaves.find(
			(leaf) => leaf.getRoot() === split,
		);

		if (sidebarLeaf) {
			const tabGroup = sidebarLeaf.parent;
			// Index is clamped by Obsidian, so a large value appends to the end
			return workspace.createLeafInParent(
				tabGroup,
				Number.MAX_SAFE_INTEGER,
			);
		}

		// Fallback: no existing chat leaf in sidebar, create first one
		return side === "right"
			? workspace.getRightLeaf(false)
			: workspace.getLeftLeaf(false);
	}

	/**
	 * Open a new chat view with a specific agent.
	 * Always creates a new view (doesn't reuse existing).
	 */
	async openNewChatViewWithAgent(
		agentId: string,
		locationOverride?: "right-pane",
	): Promise<string | null> {
		const leaf =
			locationOverride === "right-pane"
				? this.createSidebarTab("right")
				: this.createNewChatLeaf(true);
		if (!leaf) {
			getLogger().warn("[AgentClient] Failed to create new leaf");
			return null;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_CHAT,
			active: true,
			state: { initialAgentId: agentId },
		});

		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view as ChatView | null;
		const viewId = view?.viewId ?? null;

		// Focus textarea after revealing the leaf
		const viewContainerEl = leaf.view?.containerEl;
		if (viewContainerEl) {
			window.setTimeout(() => {
				const textarea = viewContainerEl.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
				}
			}, 0);
		}
		return viewId;
	}

	/**
	 * Open a new floating chat window.
	 * Each window is independent with its own session.
	 */
	openNewFloatingChat(
		initialExpanded = false,
		initialPosition?: { x: number; y: number },
		initialAgentId?: string,
	): FloatingViewContainer | null {
		// Single choke point for the setting: commands, the floating button,
		// and the onload bootstrap are already gated upstream, but agent
		// buttons and the in-window "new window" action are not. A window
		// created while the feature is off becomes unreachable after a
		// minimize (the button and every floating command are hidden or
		// disabled with the setting), so refuse creation outright.
		if (!this.settings.enableFloatingChat) {
			new Notice("[Agent Client] Floating chat is disabled in settings.");
			return null;
		}
		// instanceId is just the counter (e.g., "0", "1", "2")
		// FloatingViewContainer will create viewId as "floating-chat-{instanceId}"
		const instanceId = String(this.floatingChatCounter++);
		return createFloatingChat(
			this,
			instanceId,
			initialExpanded,
			initialPosition,
			initialAgentId,
		);
	}

	findNearestEmbeddedChat(
		sourcePath: string,
		lineStart: number,
	): string | null {
		// Prefer the embedded chat closest at/above the target line (a button
		// usually sits just below its chat). If none are at/above, fall back to
		// the highest chat below. The secondary sort by lineStart keeps the
		// "below" pick deterministic without relying on registry iteration
		// order (which shifts when a block unregisters/re-registers on
		// re-render).
		let above: EmbeddedChatViewContainer | null = null;
		let aboveDistance = Number.POSITIVE_INFINITY;
		let below: EmbeddedChatViewContainer | null = null;

		for (const container of this.viewRegistry.getByType("embedded")) {
			if (!(container instanceof EmbeddedChatViewContainer)) continue;
			if (container.sourcePath !== sourcePath) continue;
			const distance = lineStart - container.lineStart;
			if (distance >= 0) {
				if (distance < aboveDistance) {
					above = container;
					aboveDistance = distance;
				}
			} else if (!below || container.lineStart < below.lineStart) {
				below = container;
			}
		}

		return (above ?? below)?.viewId ?? null;
	}

	/**
	 * Close a specific floating chat window.
	 * @param viewId - The viewId in "floating-chat-{id}" format (from getFloatingChatInstances())
	 */
	closeFloatingChat(viewId: string): void {
		const container = this.viewRegistry.get(viewId);
		if (container && container instanceof FloatingViewContainer) {
			container.unmount();
		}
	}

	/**
	 * Get all floating chat instance viewIds.
	 * @returns Array of viewIds in "floating-chat-{id}" format
	 */
	getFloatingChatInstances(): string[] {
		return this.viewRegistry.getByType("floating").map((v) => v.viewId);
	}

	/**
	 * Expand a specific floating chat window by triggering a custom event.
	 * @param viewId - The viewId in "floating-chat-{id}" format (from getFloatingChatInstances())
	 */
	expandFloatingChat(viewId: string): void {
		const view = this.viewRegistry.get(viewId);
		if (view) {
			view.expand();
		}
	}

	/**
	 * Render an `agent-client` code block. Dispatches to embedded chat or
	 * quick-action button based on the parsed `type` field.
	 */
	private renderAgentBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): void {
		const child = new MarkdownRenderChild(el);
		const parsed = parseAgentBlock(source);

		if (!parsed.ok) {
			const errorEl = el.createDiv({
				cls: "agent-client-code-block-error",
			});
			errorEl.createSpan({
				cls: "agent-client-code-block-error-label",
				text: "agent-client block error: ",
			});
			errorEl.createSpan({ text: parsed.error });
			const sourceEl = errorEl.createEl("pre", {
				cls: "agent-client-code-block-error-source",
			});
			sourceEl.setText(source);
			ctx.addChild(child);
			return;
		}

		// Collect non-fatal warnings: parser warnings plus a mount-side check
		// on the pinned agent id (#28). Copy the parser array rather than
		// mutating it, since parse results may be shared once cached.
		// Warnings match actual behavior, which differs by block type: a chat
		// block spawns the pinned agent as-is (unknown → startup error), a
		// button block falls back to the default agent when the id is unknown.
		// Both use a pinned agent even while it is disabled. Computed at
		// render time — a later toggle doesn't update an already-rendered
		// block (known limitation).
		const warnings = parsed.warnings ? [...parsed.warnings] : [];
		const requestedAgent = parsed.config.agent;
		if (requestedAgent) {
			const agentSettings = findAgentSettings(
				this.settings,
				requestedAgent,
			);
			if (!agentSettings) {
				warnings.push(
					parsed.config.type === "chat"
						? `Unknown agent "${requestedAgent}" — this block will fail to start. Check the agent id in Settings → Agent Client.`
						: `Unknown agent "${requestedAgent}", using the default agent instead.`,
				);
			} else if (!isAgentEnabled(agentSettings)) {
				warnings.push(
					`Agent "${requestedAgent}" is disabled in settings; this block pins it and will still use it.`,
				);
			}
		}

		if (warnings.length > 0) {
			const warnEl = el.createDiv({
				cls: "agent-client-code-block-warning",
			});
			for (const warning of warnings) {
				warnEl.createDiv({
					cls: "agent-client-code-block-warning-item",
					text: warning,
				});
			}
		}

		const sectionInfo = ctx.getSectionInfo(el);
		const sourcePath = ctx.sourcePath || "";
		const lineStart = sectionInfo?.lineStart ?? 0;
		const blockId = `${sourcePath || "untitled"}:${lineStart}`;

		if (parsed.config.type === "chat") {
			// Persist blocks lacking an id get a stable id auto-injected into
			// the fence, so the device-local persist mapping survives note
			// rename/move. Requires real section bounds. Runs once: the
			// re-render the edit triggers sees config.id and the guard inside
			// ensureEmbedId short-circuits.
			if (parsed.config.persist && !parsed.config.id && sectionInfo) {
				void this.ensureEmbedId(
					sourcePath,
					sectionInfo.lineStart,
					sectionInfo.lineEnd,
				);
			}
			const container = mountCodeBlockChat(this, el, parsed.config, {
				sourcePath,
				blockId: parsed.config.id ?? blockId,
				lineStart,
			});
			child.onunload = () => container.unmount();
		} else {
			const root = mountAgentButtonBlock(this, el, parsed.config, {
				sourcePath,
				lineStart,
			});
			child.onunload = () => root.unmount();
		}
		ctx.addChild(child);
	}

	/**
	 * Inject a generated stable id into a persist chat fence that lacks one.
	 *
	 * Device-neutral persist mapping keys on this id (not the note path), so
	 * rename/move stays safe. Idempotent: an in-flight guard prevents
	 * concurrent double-injection, and a content check skips fences that
	 * already declare an id (covering the re-render the edit itself triggers).
	 *
	 * Uses app.vault.process (atomic read-modify-write) rather than
	 * vault.modify, per the settled design.
	 */
	private async ensureEmbedId(
		sourcePath: string,
		lineStart: number,
		lineEnd: number,
	): Promise<void> {
		if (!sourcePath) return;
		const guardKey = `${sourcePath}:${lineStart}`;
		if (this.embedIdInjectionInFlight.has(guardKey)) return;

		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return;

		this.embedIdInjectionInFlight.add(guardKey);
		try {
			await this.app.vault.process(file, (content) => {
				const lines = content.split("\n");
				// Bounds + fence sanity: section info must still match the file.
				if (
					lineStart < 0 ||
					lineEnd >= lines.length ||
					lineStart >= lineEnd
				) {
					return content;
				}
				// Fence sanity: the captured section may be stale (a user
				// edit can move/replace the block before this async pass).
				// Require the live fence to still be an agent-client/agent
				// fence so an unrelated fence never gets an id spliced in.
				if (
					!/^\s*`{3,}\s*(agent-client|agent)(?:\s|$)/.test(
						lines[lineStart],
					)
				) {
					return content;
				}

				// Re-validate the live body through the real parser (single
				// source of truth). Inject only when it is still a persist
				// chat block lacking an id — this also short-circuits the
				// re-render the edit itself triggers.
				const body = lines.slice(lineStart + 1, lineEnd);
				const liveParsed = parseAgentBlock(body.join("\n"));
				if (
					!liveParsed.ok ||
					liveParsed.config.type !== "chat" ||
					!liveParsed.config.persist ||
					liveParsed.config.id
				) {
					return content;
				}

				const indent = lines[lineStart].match(/^\s*/)?.[0] ?? "";
				lines.splice(
					lineStart + 1,
					0,
					`${indent}id: ${generateEmbedId()}`,
				);
				return lines.join("\n");
			});
		} catch (error) {
			getLogger().error(
				`[AgentClient] Failed to inject embed id: ${error}`,
			);
		} finally {
			this.embedIdInjectionInFlight.delete(guardKey);
		}
	}

	/**
	 * Open a chat view and inject a prompt into it. Used by quick-action
	 * buttons (embedded code blocks, command palette entries, etc.).
	 *
	 * Delivers the prompt to the target ChatPanel via the pending-prompt
	 * registry (see registerPendingPromptHandler): synchronous if the panel is
	 * already mounted, otherwise queued and drained on its next mount.
	 */
	async runPromptInChat(options: {
		agentId: string;
		prompt: string;
		autoSend: boolean;
		viewType: "right-pane" | "floating" | "editor-tab" | "embedded";
		sourcePath?: string;
		lineStart?: number;
	}): Promise<void> {
		const { agentId, prompt, autoSend, viewType, sourcePath, lineStart } =
			options;
		let targetViewId: string | null = null;

		if (viewType === "embedded") {
			targetViewId =
				sourcePath && typeof lineStart === "number"
					? this.findNearestEmbeddedChat(sourcePath, lineStart)
					: null;
			if (!targetViewId) {
				new Notice(
					"[Agent Client] No embedded chat block found in this note.",
				);
				return;
			}
			this.viewRegistry.get(targetViewId)?.focus();
		} else if (viewType === "floating") {
			const container = this.openNewFloatingChat(
				true,
				undefined,
				agentId,
			);
			targetViewId = container?.viewId ?? null;
		} else if (viewType === "editor-tab") {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_CHAT,
				active: true,
				state: { initialAgentId: agentId },
			});
			await this.app.workspace.revealLeaf(leaf);
			const view = leaf.view as ChatView;
			targetViewId = view?.viewId ?? null;
		} else {
			// viewType === "right-pane": honor it literally, independent of the
			// user's chatViewLocation default (floating/editor-tab handled above).
			targetViewId = await this.openNewChatViewWithAgent(
				agentId,
				"right-pane",
			);
		}

		if (!targetViewId) return;

		// Deterministic handshake: deliver now if the target ChatPanel has
		// registered its handler, otherwise queue until it mounts. Replaces a
		// 100ms setTimeout + workspace broadcast that could drop the prompt if
		// the React root mounted late.
		this.deliverPrompt(targetViewId, prompt, autoSend);
	}

	/**
	 * Register a ChatPanel's pending-prompt handler (called on mount). If a
	 * prompt was queued before the panel mounted (runPromptInChat ran first),
	 * it is delivered synchronously here. Returns an unregister function.
	 */
	registerPendingPromptHandler(
		viewId: string,
		handler: (prompt: string, autoSend: boolean) => void,
	): () => void {
		this._pendingPromptHandlers.set(viewId, handler);
		const queued = this._pendingPrompts.get(viewId);
		if (queued) {
			this._pendingPrompts.delete(viewId);
			for (const item of queued) {
				handler(item.prompt, item.autoSend);
			}
		}
		return () => {
			if (this._pendingPromptHandlers.get(viewId) === handler) {
				this._pendingPromptHandlers.delete(viewId);
			}
		};
	}

	private deliverPrompt(
		viewId: string,
		prompt: string,
		autoSend: boolean,
	): void {
		const handler = this._pendingPromptHandlers.get(viewId);
		if (handler) {
			handler(prompt, autoSend);
		} else {
			// Panel not mounted yet; drained by registerPendingPromptHandler.
			const queue = this._pendingPrompts.get(viewId);
			if (queue) {
				queue.push({ prompt, autoSend });
			} else {
				this._pendingPrompts.set(viewId, [{ prompt, autoSend }]);
			}
		}
	}

	/**
	 * Get all available agents (preset + custom). Delegates to the single
	 * enumeration implementation in session-helpers.
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return getAvailableAgentsFromSettings(this.settings);
	}

	/**
	 * Register commands for each configured agent.
	 *
	 * All presets register unconditionally; a checkCallback hides the command
	 * while its agent is disabled, so the palette follows the Enabled toggles
	 * without re-registration. Custom agents remain a load-time snapshot
	 * (a newly added custom gets its command after a reload — existing
	 * limitation), but their enabled state is also checked live.
	 */
	private registerAgentCommands(): void {
		for (const agent of getAllAgentsFromSettings(this.settings)) {
			this.addCommand({
				id: `switch-agent-to-${agent.id}`,
				name: `Switch agent to ${agent.displayName}`,
				checkCallback: (checking) => {
					const found = findAgentSettings(this.settings, agent.id);
					if (!found || !isAgentEnabled(found)) return false;
					if (checking) return true;
					this.app.workspace.trigger(
						"agent-client:new-chat-requested",
						this.lastActiveChatViewId,
						agent.id,
					);
				},
			});
		}
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:approve-active-permission",
					this.lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:reject-active-permission",
					this.lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:toggle-auto-mention",
					this.lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:new-chat-requested",
					this.lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:cancel-message",
					this.lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "export-chat",
			name: "Export chat",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:export-chat",
					this.lastActiveChatViewId,
				);
			},
		});
	}

	/**
	 * Register broadcast commands for multi-view operations
	 */
	private registerBroadcastCommands(): void {
		// Broadcast prompt: Copy prompt from active view to all other views
		this.addCommand({
			id: "broadcast-prompt",
			name: "Broadcast prompt",
			callback: () => {
				this.broadcastPrompt();
			},
		});

		// Broadcast send: Send message in all views that can send
		this.addCommand({
			id: "broadcast-send",
			name: "Broadcast send",
			callback: () => {
				void this.broadcastSend();
			},
		});

		// Broadcast cancel: Cancel operation in all views
		this.addCommand({
			id: "broadcast-cancel",
			name: "Broadcast cancel",
			callback: () => {
				void this.broadcastCancel();
			},
		});
	}

	/**
	 * Copy prompt from active view to all other views
	 */
	private broadcastPrompt(): void {
		const allViews = this.viewRegistry.getAll();
		if (allViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		const inputState = this.viewRegistry.toFocused((v) =>
			v.getInputState(),
		);
		if (
			!inputState ||
			(inputState.text.trim() === "" && inputState.files.length === 0)
		) {
			new Notice("[Agent Client] No prompt to broadcast");
			return;
		}

		const focusedId = this.viewRegistry.getFocusedId();
		const targetViews = allViews.filter((v) => v.viewId !== focusedId);
		if (targetViews.length === 0) {
			new Notice("[Agent Client] No other chat views to broadcast to");
			return;
		}

		for (const view of targetViews) {
			view.setInputState(inputState);
		}
	}

	/**
	 * Send message in all views that can send
	 */
	private async broadcastSend(): Promise<void> {
		const allViews = this.viewRegistry.getAll();
		if (allViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		const sendableViews = allViews.filter((v) => v.canSend());
		if (sendableViews.length === 0) {
			new Notice("[Agent Client] No views ready to send");
			return;
		}

		await Promise.allSettled(sendableViews.map((v) => v.sendMessage()));
	}

	/**
	 * Cancel operation in all views
	 */
	private async broadcastCancel(): Promise<void> {
		const allViews = this.viewRegistry.getAll();
		if (allViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		await Promise.allSettled(allViews.map((v) => v.cancelOperation()));
		new Notice("[Agent Client] Cancel broadcast to all views");
	}

	async loadSettings() {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		const D = DEFAULT_SETTINGS;
		let migratedSecrets = false;

		// Docs-advised custom agents (e.g. the OpenCode recipe our docs
		// carried before the preset existed) migrate into their new preset
		// entries. Must run before ensureUniqueCustomAgentIds renames the
		// colliding custom to "{id}-2".
		const absorption = absorbCustomAgents(raw, PRESET_AGENTS);
		raw.customAgents = absorption.customAgents;
		raw.presetAgents = absorption.presetAgents;
		for (const entry of absorption.absorbed) {
			new Notice(
				`[Agent Client] ${entry.displayName} is now a preset agent — your custom agent settings were migrated.`,
			);
		}

		// Extract settings sub-objects
		const re = obj(raw.exportSettings) ?? {};
		const rd = obj(raw.displaySettings) ?? {};

		// Normalize custom agents. Preset ids are reserved: a custom that
		// collides with one has always been dead weight (preset-first
		// resolution), so suffix-renaming it changes no session behavior.
		const customAgents = Array.isArray(raw.customAgents)
			? ensureUniqueCustomAgentIds(
					raw.customAgents.map((a: unknown) =>
						normalizeCustomAgent(obj(a) ?? {}),
					),
					PRESET_AGENTS.map((def) => def.presetId),
				)
			: [];

		// Migration: defaultAgentId ← activeAgentId (old name)
		const availableAgentIds = [
			...PRESET_AGENTS.map((def) => def.presetId),
			...customAgents.map((a) => a.id),
		];
		const defaultAgentId =
			resolveDefaultAgentId(raw, availableAgentIds) ||
			PRESET_AGENTS[0].presetId;

		// Secret-storage side effects (writes + Notices) are injected into the
		// pure normalizer; called only for presets with apiKey.legacy wiring.
		const migrateApiKey: ApiKeyMigrator = ({
			def,
			current,
			legacyPlain,
		}) => {
			const legacy = def.apiKey?.legacy;
			if (!legacy) {
				return current;
			}
			return this.migrateLegacyApiKey(
				legacy.defaultSecretId,
				legacy.fallbackSecretId,
				current,
				legacyPlain,
				legacy.noticeLabel,
				() => {
					migratedSecrets = true;
				},
			);
		};

		this.settings = {
			presetAgents: normalizePresetAgents(
				raw,
				PRESET_AGENTS,
				migrateApiKey,
			),
			customAgents,
			defaultAgentId,
			autoAllowPermissions: bool(
				raw.autoAllowPermissions,
				D.autoAllowPermissions,
			),
			autoMentionActiveNote: bool(
				raw.autoMentionActiveNote,
				D.autoMentionActiveNote,
			),
			expandWikilinkContext: bool(
				raw.expandWikilinkContext,
				D.expandWikilinkContext,
			),
			enableSystemNotifications: bool(
				raw.enableSystemNotifications,
				D.enableSystemNotifications,
			),
			promptInjection: (() => {
				const rp = obj(raw.promptInjection) ?? {};
				return {
					enabled: bool(rp.enabled, D.promptInjection.enabled),
					latex: bool(rp.latex, D.promptInjection.latex),
					wikiLinks: bool(rp.wikiLinks, D.promptInjection.wikiLinks),
					tables: bool(rp.tables, D.promptInjection.tables),
				};
			})(),
			debugMode: bool(raw.debugMode, D.debugMode),
			nodePath: str(raw.nodePath, D.nodePath),
			exportSettings: {
				defaultFolder: str(
					re.defaultFolder,
					D.exportSettings.defaultFolder,
				),
				filenameTemplate: str(
					re.filenameTemplate,
					D.exportSettings.filenameTemplate,
				),
				autoExportOnNewChat: bool(
					re.autoExportOnNewChat,
					D.exportSettings.autoExportOnNewChat,
				),
				autoExportOnCloseChat: bool(
					re.autoExportOnCloseChat,
					D.exportSettings.autoExportOnCloseChat,
				),
				openFileAfterExport: bool(
					re.openFileAfterExport,
					D.exportSettings.openFileAfterExport,
				),
				includeImages: bool(
					re.includeImages,
					D.exportSettings.includeImages,
				),
				imageLocation: enumVal(
					re.imageLocation,
					["obsidian", "custom", "base64"],
					D.exportSettings.imageLocation,
				),
				imageCustomFolder: str(
					re.imageCustomFolder,
					D.exportSettings.imageCustomFolder,
				),
				includeAudios: bool(
					re.includeAudios,
					D.exportSettings.includeAudios,
				),
				audioLocation: enumVal(
					re.audioLocation,
					["obsidian", "custom"],
					D.exportSettings.audioLocation,
				),
				audioCustomFolder: str(
					re.audioCustomFolder,
					D.exportSettings.audioCustomFolder,
				),
				frontmatterTag: str(
					re.frontmatterTag,
					D.exportSettings.frontmatterTag,
				),
			},
			windowsWslMode: bool(raw.windowsWslMode, D.windowsWslMode),
			windowsWslDistribution: str(
				raw.windowsWslDistribution,
				D.windowsWslDistribution as string,
			),
			sendMessageShortcut: enumVal(
				raw.sendMessageShortcut,
				["enter", "cmd-enter"],
				D.sendMessageShortcut,
			),
			chatViewLocation: enumVal(
				raw.chatViewLocation,
				["right-tab", "right-split", "editor-tab", "editor-split"],
				D.chatViewLocation,
			),
			displaySettings: {
				autoCollapseDiffs: bool(
					rd.autoCollapseDiffs,
					D.displaySettings.autoCollapseDiffs,
				),
				diffCollapseThreshold: num(
					rd.diffCollapseThreshold,
					D.displaySettings.diffCollapseThreshold,
					1,
				),
				maxNoteLength: num(
					rd.maxNoteLength,
					D.displaySettings.maxNoteLength,
					1,
				),
				maxSelectionLength: num(
					rd.maxSelectionLength,
					D.displaySettings.maxSelectionLength,
					1,
				),
				showEmojis: bool(rd.showEmojis, D.displaySettings.showEmojis),
				fontSize: parseChatFontSize(rd.fontSize),
			},
			savedSessions: Array.isArray(raw.savedSessions)
				? (raw.savedSessions as SavedSessionInfo[])
				: D.savedSessions,
			lastUsedModels: strRecord(raw.lastUsedModels),
			lastUsedModes: strRecord(raw.lastUsedModes),
			lastUsedConfigOptions: nestedStrRecord(raw.lastUsedConfigOptions),
			// Migration: enableFloatingChat ← showFloatingButton (old name)
			enableFloatingChat: bool(
				raw.enableFloatingChat,
				bool(raw.showFloatingButton, D.enableFloatingChat),
			),
			floatingButtonImage: str(
				raw.floatingButtonImage,
				D.floatingButtonImage,
			),
			floatingWindowSize: (() => {
				const s = obj(raw.floatingWindowSize);
				return s &&
					typeof s.width === "number" &&
					typeof s.height === "number"
					? { width: s.width, height: s.height }
					: D.floatingWindowSize;
			})(),
			floatingWindowPosition: xyPoint(raw.floatingWindowPosition),
			floatingButtonPosition: xyPoint(raw.floatingButtonPosition),
		};

		this.ensureAtLeastOneEnabled();
		this.ensureDefaultAgentId();

		if (migratedSecrets || absorption.absorbed.length > 0) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		await this.settingsService.updateSettings(nextSettings);
	}

	/**
	 * Migrate legacy plaintext apiKey (v0.10.x) to secretStorage.
	 *
	 * Returns the secretId to use for this agent.
	 *
	 * Behavior:
	 * - If apiKeySecretId is already set, return it as-is. If a legacy
	 *   plaintext apiKey still lingers in data.json (orphaned from prior
	 *   experimental state), trigger onMigrate to schedule a save that
	 *   cleans it up.
	 * - If legacy apiKey is empty, return empty string (no migration needed).
	 * - Otherwise, migrate to secretStorage:
	 *   - Use defaultSecretId (e.g. "claude-api-key") for cross-plugin sharing.
	 *   - On collision (defaultSecretId exists with a different value, e.g.
	 *     from another plugin), fall back to fallbackSecretId
	 *     (e.g. "agent-client-claude-api-key") to preserve the user's key
	 *     and notify them.
	 *
	 * This method is for upgrading from v0.10.x or experimental builds and
	 * can be removed in a future major version once we're confident no
	 * users have legacy plaintext apiKey fields in data.json.
	 */
	private migrateLegacyApiKey(
		defaultSecretId: string,
		fallbackSecretId: string,
		currentSecretId: string,
		legacyApiKey: string,
		agentLabel: string,
		onMigrate: () => void,
	): string {
		const trimmed = legacyApiKey.trim();

		// Already migrated
		if (currentSecretId.length > 0) {
			// Clean up orphaned plaintext apiKey if still in data.json
			if (trimmed.length > 0) {
				onMigrate();
			}
			return currentSecretId;
		}

		if (trimmed.length === 0) {
			return "";
		}

		const existing = this.app.secretStorage.getSecret(defaultSecretId);

		if (existing === null) {
			// No collision — create the secret with the preferred ID
			this.app.secretStorage.setSecret(defaultSecretId, trimmed);
			new Notice(
				`[Agent Client] Your ${agentLabel} API key has been migrated to Obsidian's Keychain as "${defaultSecretId}".`,
			);
			onMigrate();
			return defaultSecretId;
		}

		if (existing === trimmed) {
			// Idempotent re-migration (same value already stored)
			onMigrate();
			return defaultSecretId;
		}

		// Collision: defaultSecretId exists with a different value (likely
		// another plugin). Fall back to a plugin-prefixed ID to preserve
		// the user's key without overwriting other plugins' secrets.
		this.app.secretStorage.setSecret(fallbackSecretId, trimmed);
		new Notice(
			`[Agent Client] "${defaultSecretId}" was already in use. Your ${agentLabel} API key was migrated to "${fallbackSecretId}". You can rename it in Obsidian's Keychain settings.`,
		);
		onMigrate();
		return fallbackSecretId;
	}

	/**
	 * Fetch the latest stable release version from GitHub.
	 */
	private async fetchLatestStable(): Promise<string | null> {
		const response = await requestUrl({
			url: "https://api.github.com/repos/RAIT-09/obsidian-agent-client/releases/latest",
		});
		const data = response.json as { tag_name?: string };
		return data.tag_name ? semver.clean(data.tag_name) : null;
	}

	/**
	 * Fetch the latest prerelease version from GitHub.
	 */
	private async fetchLatestPrerelease(): Promise<string | null> {
		const response = await requestUrl({
			url: "https://api.github.com/repos/RAIT-09/obsidian-agent-client/releases",
		});
		const releases = response.json as Array<{
			tag_name: string;
			prerelease: boolean;
		}>;

		// Find the first prerelease (releases are sorted by date descending)
		const latestPrerelease = releases.find((r) => r.prerelease);
		return latestPrerelease
			? semver.clean(latestPrerelease.tag_name)
			: null;
	}

	/**
	 * Check for plugin updates.
	 * - Stable version users: compare with latest stable release
	 * - Prerelease users: compare with both latest stable and latest prerelease
	 */
	async checkForUpdates(): Promise<boolean> {
		const currentVersion =
			semver.clean(this.manifest.version) || this.manifest.version;
		const isCurrentPrerelease = semver.prerelease(currentVersion) !== null;

		if (isCurrentPrerelease) {
			// Prerelease user: check both stable and prerelease
			const [latestStable, latestPrerelease] = await Promise.all([
				this.fetchLatestStable(),
				this.fetchLatestPrerelease(),
			]);

			const hasNewerStable =
				latestStable && semver.gt(latestStable, currentVersion);
			const hasNewerPrerelease =
				latestPrerelease && semver.gt(latestPrerelease, currentVersion);

			if (hasNewerStable || hasNewerPrerelease) {
				// Prefer stable version notification if available
				const newestVersion = hasNewerStable
					? latestStable
					: latestPrerelease;
				new Notice(
					`[Agent Client] Update available: v${newestVersion}`,
				);
				return true;
			}
		} else {
			// Stable version user: check stable only
			const latestStable = await this.fetchLatestStable();
			if (latestStable && semver.gt(latestStable, currentVersion)) {
				new Notice(`[Agent Client] Update available: v${latestStable}`);
				return true;
			}
		}

		return false;
	}

	ensureDefaultAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (!availableIds.includes(this.settings.defaultAgentId)) {
			this.settings.defaultAgentId = firstEnabledAgentId(this.settings);
		}
	}

	/**
	 * Repair the "everything disabled" state by re-enabling the first preset.
	 * The settings UI refuses to disable the last enabled agent, so this is a
	 * backstop for load-time data and indirect paths (custom deletion).
	 */
	ensureAtLeastOneEnabled(): void {
		const repaired = repairNoEnabledAgents(this.settings);
		if (repaired) {
			this.settings.presetAgents = repaired;
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		for (const agent of this.getAvailableAgents()) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
