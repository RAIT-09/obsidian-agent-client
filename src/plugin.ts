import {
	Plugin,
	WorkspaceLeaf,
	WorkspaceSplit,
	Notice,
	requestUrl,
} from "obsidian";
import * as semver from "semver";
import { ChatView, VIEW_TYPE_CHAT } from "./ui/ChatView";
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
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
	parseChatFontSize,
	str,
	bool,
	num,
	enumVal,
	obj,
	strRecord,
	xyPoint,
} from "./services/settings-normalizer";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
} from "./types/agent";
import type { SavedSessionInfo } from "./types/session";
import { initializeLogger } from "./utils/logger";

// Re-export for backward compatibility
export type { AgentEnvVar, CustomAgentSettings };

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
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
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
	// Floating chat settings
	enableFloatingChat: boolean;
	floatingButtonImage: string;
	floatingWindowSize: { width: number; height: number };
	floatingWindowPosition: { x: number; y: number } | null;
	floatingButtonPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "claude-agent-acp",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKey: "",
		command: "codex-acp",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "gemini",
		args: ["--experimental-acp"],
		env: [],
	},
	customAgents: [],
	defaultAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
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
	/** Floating button container (independent from chat view instances) */
	private floatingButton: FloatingButtonContainer | null = null;
	/** Counter for generating unique floating chat instance IDs */
	private floatingChatCounter = 0;

	async onload() {
		await this.loadSettings();

		initializeLogger(this.settings);

		// Initialize settings store
		this.settingsService = createSettingsService(this.settings, this);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

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
						console.warn(
							`[AgentClient] Quit cleanup error for view ${viewId}:`,
							error,
						);
					});
				}
				this._acpClients.clear();
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

		// Clear registry (sidebar views are managed by Obsidian workspace)
		this.viewRegistry.clear();

		// Disconnect all ACP clients (kill agent processes)
		for (const [, client] of this._acpClients) {
			client.disconnect().catch(() => {});
		}
		this._acpClients.clear();
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
	 * Remove and disconnect the AcpClient for a specific view.
	 * Called when a ChatView is closed.
	 */
	async removeAcpClient(viewId: string): Promise<void> {
		const client = this._acpClients.get(viewId);
		if (client) {
			try {
				await client.disconnect();
			} catch (error) {
				console.warn(
					`[AgentClient] Failed to disconnect client for view ${viewId}:`,
					error,
				);
			}
			this._acpClients.delete(viewId);
		}
		// Note: lastActiveChatViewId is now managed by viewRegistry
		// Clearing happens automatically when view is unregistered
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
				tabGroup as unknown as WorkspaceSplit,
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
	async openNewChatViewWithAgent(agentId: string): Promise<void> {
		const leaf = this.createNewChatLeaf(true);
		if (!leaf) {
			console.warn("[AgentClient] Failed to create new leaf");
			return;
		}

		await leaf.setViewState({
			type: VIEW_TYPE_CHAT,
			active: true,
			state: { initialAgentId: agentId },
		});

		await this.app.workspace.revealLeaf(leaf);

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
	}

	/**
	 * Open a new floating chat window.
	 * Each window is independent with its own session.
	 */
	openNewFloatingChat(
		initialExpanded = false,
		initialPosition?: { x: number; y: number },
	): void {
		// instanceId is just the counter (e.g., "0", "1", "2")
		// FloatingViewContainer will create viewId as "floating-chat-{instanceId}"
		const instanceId = String(this.floatingChatCounter++);
		createFloatingChat(this, instanceId, initialExpanded, initialPosition);
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
	 * Get all available agents (claude, codex, gemini, custom)
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return [
			{
				id: this.settings.claude.id,
				displayName:
					this.settings.claude.displayName || this.settings.claude.id,
			},
			{
				id: this.settings.codex.id,
				displayName:
					this.settings.codex.displayName || this.settings.codex.id,
			},
			{
				id: this.settings.gemini.id,
				displayName:
					this.settings.gemini.displayName || this.settings.gemini.id,
			},
			...this.settings.customAgents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName || agent.id,
			})),
		];
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		const agents = this.getAvailableAgents();

		for (const agent of agents) {
			this.addCommand({
				id: `switch-agent-to-${agent.id}`,
				name: `Switch agent to ${agent.displayName}`,
				checkCallback: (checking) => {
					const view =
						this.app.workspace.getActiveViewOfType(ChatView);
					if (!view) return false;
					if (checking) return true;
					this.app.workspace.trigger(
						"agent-client:new-chat-requested" as "quit",
						view.viewId,
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
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:approve-active-permission" as "quit",
					view.viewId,
				);
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:reject-active-permission" as "quit",
					view.viewId,
				);
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:toggle-auto-mention" as "quit",
					view.viewId,
				);
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:new-chat-requested" as "quit",
					view.viewId,
				);
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:cancel-message" as "quit",
					view.viewId,
				);
			},
		});

		this.addCommand({
			id: "export-chat",
			name: "Export chat",
			checkCallback: (checking) => {
				const view =
					this.app.workspace.getActiveViewOfType(ChatView);
				if (!view) return false;
				if (checking) return true;
				this.app.workspace.trigger(
					"agent-client:export-chat" as "quit",
					view.viewId,
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

		// Extract agent sub-objects
		const rc = obj(raw.claude) ?? {};
		const rk = obj(raw.codex) ?? {};
		const rg = obj(raw.gemini) ?? {};
		const re = obj(raw.exportSettings) ?? {};
		const rd = obj(raw.displaySettings) ?? {};

		// Normalize custom agents
		const customAgents = Array.isArray(raw.customAgents)
			? ensureUniqueCustomAgentIds(
					raw.customAgents.map((a: unknown) =>
						normalizeCustomAgent(obj(a) ?? {}),
					),
				)
			: [];

		// Migration: defaultAgentId ← activeAgentId (old name)
		const availableAgentIds = [
			D.claude.id,
			D.codex.id,
			D.gemini.id,
			...customAgents.map((a) => a.id),
		];
		const rawDefaultId =
			str(raw.defaultAgentId, "") || str(raw.activeAgentId, "");
		const defaultAgentId =
			rawDefaultId && availableAgentIds.includes(rawDefaultId)
				? rawDefaultId
				: availableAgentIds[0] || D.claude.id;

		this.settings = {
			claude: {
				id: D.claude.id, // Fixed — never from raw
				displayName: str(rc.displayName, D.claude.displayName),
				apiKey: str(rc.apiKey, D.claude.apiKey),
				// Migration: claude.command ← claudeCodeAcpCommandPath (old name)
				command:
					str(rc.command, "") ||
					str(raw.claudeCodeAcpCommandPath, "") ||
					D.claude.command,
				args: sanitizeArgs(rc.args),
				env: normalizeEnvVars(rc.env),
			},
			codex: {
				id: D.codex.id,
				displayName: str(rk.displayName, D.codex.displayName),
				apiKey: str(rk.apiKey, D.codex.apiKey),
				command: str(rk.command, "") || D.codex.command,
				args: sanitizeArgs(rk.args),
				env: normalizeEnvVars(rk.env),
			},
			gemini: {
				id: D.gemini.id,
				displayName: str(rg.displayName, D.gemini.displayName),
				apiKey: str(rg.apiKey, D.gemini.apiKey),
				// Migration: gemini.command ← geminiCommandPath (old name)
				command:
					str(rg.command, "") ||
					str(raw.geminiCommandPath, "") ||
					D.gemini.command,
				args:
					sanitizeArgs(rg.args).length > 0
						? sanitizeArgs(rg.args)
						: D.gemini.args,
				env: normalizeEnvVars(rg.env),
			},
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

		this.ensureDefaultAgentId();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		await this.settingsService.updateSettings(nextSettings);
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
		if (availableIds.length === 0) {
			this.settings.defaultAgentId = DEFAULT_SETTINGS.claude.id;
			return;
		}
		if (!availableIds.includes(this.settings.defaultAgentId)) {
			this.settings.defaultAgentId = availableIds[0];
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		ids.add(this.settings.claude.id);
		ids.add(this.settings.codex.id);
		ids.add(this.settings.gemini.id);
		for (const agent of this.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
