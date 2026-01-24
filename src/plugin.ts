import { Plugin, WorkspaceLeaf, Notice, requestUrl, MarkdownRenderChild } from "obsidian";
import type { Root } from "react-dom/client";
import * as semver from "semver";
import { ChatView, VIEW_TYPE_CHAT } from "./components/chat/ChatView";
import { mountFloatingChat } from "./components/chat/FloatingChatView";
import { mountCodeBlockChat } from "./components/chat/CodeBlockChatView";
import {
	createSettingsStore,
	type SettingsStore,
} from "./adapters/obsidian/settings-store.adapter";
import { AgentClientSettingTab } from "./components/settings/AgentClientSettingTab";
import { AcpAdapter } from "./adapters/acp/acp.adapter";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
} from "./shared/settings-utils";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
} from "./domain/models/agent-config";
import type { SavedSessionInfo } from "./domain/models/session-info";

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
 * - 'editor-tab': Open in editor area as tabs
 * - 'editor-split': Open in editor area with right split
 */
export type ChatViewLocation = "right-tab" | "editor-tab" | "editor-split";

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
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
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	// Floating chat button settings
	showFloatingButton: boolean;
	floatingButtonImage: string;
	floatingWindowSize: { width: number; height: number };
	floatingWindowPosition: { x: number; y: number } | null;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	customAgents: [],
	defaultAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
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
	},
	savedSessions: [],
	showFloatingButton: false,
	floatingButtonImage: "",
	floatingWindowSize: { width: 400, height: 500 },
	floatingWindowPosition: null,
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;

	/** Map of viewId to AcpAdapter for multi-session support */
	private _adapters: Map<string, AcpAdapter> = new Map();
	/** Track the last active ChatView for keybind targeting */
	private _lastActiveChatViewId: string | null = null;
	/** React root for floating chat component */
	private floatingChatRoot: Root | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings, this);

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
			name: "Open agent chat",
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

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		// Mount floating chat component
		this.floatingChatRoot = mountFloatingChat(this);

		// Register agent-client code block processor
		this.registerMarkdownCodeBlockProcessor("agent-client", (source, el, ctx) => {
			const root = mountCodeBlockChat(this, el, source);
			// Create a proper MarkdownRenderChild for cleanup
			const child = new MarkdownRenderChild(el);
			child.onunload = () => root.unmount();
			ctx.addChild(child);
		});

		// Clean up all ACP sessions when Obsidian quits
		// Note: We don't wait for disconnect to complete to avoid blocking quit
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				// Fire and forget - don't block Obsidian from quitting
				for (const [viewId, adapter] of this._adapters) {
					adapter.disconnect().catch((error) => {
						console.warn(
							`[AgentClient] Quit cleanup error for view ${viewId}:`,
							error,
						);
					});
				}
				this._adapters.clear();
			}),
		);
	}

	onunload() {
		// Unmount floating chat
		if (this.floatingChatRoot) {
			this.floatingChatRoot.unmount();
			this.floatingChatRoot = null;
		}
		// Remove floating chat container from DOM
		const floatingContainer = document.querySelector(".agent-client-floating-root");
		if (floatingContainer) {
			floatingContainer.remove();
		}
	}

	/**
	 * Get or create an AcpAdapter for a specific view.
	 * Each ChatView has its own adapter for independent sessions.
	 */
	getOrCreateAdapter(viewId: string): AcpAdapter {
		let adapter = this._adapters.get(viewId);
		if (!adapter) {
			adapter = new AcpAdapter(this);
			this._adapters.set(viewId, adapter);
		}
		return adapter;
	}

	/**
	 * Remove and disconnect the adapter for a specific view.
	 * Called when a ChatView is closed.
	 */
	async removeAdapter(viewId: string): Promise<void> {
		const adapter = this._adapters.get(viewId);
		if (adapter) {
			try {
				await adapter.disconnect();
			} catch (error) {
				console.warn(
					`[AgentClient] Failed to disconnect adapter for view ${viewId}:`,
					error,
				);
			}
			this._adapters.delete(viewId);
		}
		// Clear lastActiveChatViewId if it was this view
		if (this._lastActiveChatViewId === viewId) {
			this._lastActiveChatViewId = null;
		}
	}

	/**
	 * Get the last active ChatView ID for keybind targeting.
	 */
	get lastActiveChatViewId(): string | null {
		return this._lastActiveChatViewId;
	}

	/**
	 * Set the last active ChatView ID.
	 * Called when a ChatView receives focus or interaction.
	 */
	setLastActiveChatViewId(viewId: string | null): void {
		this._lastActiveChatViewId = viewId;
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			// Find the leaf matching lastActiveChatViewId, or fall back to first leaf
			if (this._lastActiveChatViewId) {
				leaf =
					leaves.find(
						(l) =>
							(l.view as ChatView)?.viewId ===
							this._lastActiveChatViewId,
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
	 * Cycles through all ChatView leaves.
	 */
	private focusChatView(direction: "next" | "previous"): void {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length === 0) {
			return;
		}

		if (leaves.length === 1) {
			void workspace.revealLeaf(leaves[0]);
			this.focusTextarea(leaves[0]);
			return;
		}

		// Find current index
		let currentIndex = 0;
		if (this._lastActiveChatViewId) {
			const foundIndex = leaves.findIndex(
				(l) =>
					(l.view as ChatView)?.viewId === this._lastActiveChatViewId,
			);
			if (foundIndex !== -1) {
				currentIndex = foundIndex;
			}
		}

		// Get target index (cycle)
		const targetIndex =
			direction === "next"
				? (currentIndex + 1) % leaves.length
				: (currentIndex - 1 + leaves.length) % leaves.length;
		const targetLeaf = leaves[targetIndex];

		void workspace.revealLeaf(targetLeaf);
		this.focusTextarea(targetLeaf);
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
				return workspace.getRightLeaf(isAdditional);
			case "editor-tab":
				return workspace.getLeaf("tab");
			case "editor-split":
				return workspace.getLeaf("split");
			default:
				return workspace.getRightLeaf(isAdditional);
		}
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
	 * Open chat view and switch to specified agent
	 */
	private async openChatWithAgent(agentId: string): Promise<void> {
		await this.activateView();

		// Trigger new chat with specific agent
		// Pass agentId so ChatComponent knows to force new session even if empty
		this.app.workspace.trigger(
			"agent-client:new-chat-requested" as "quit",
			agentId,
		);
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		const agents = this.getAvailableAgents();

		for (const agent of agents) {
			this.addCommand({
				id: `open-chat-with-${agent.id}`,
				name: `New chat with ${agent.displayName}`,
				callback: async () => {
					await this.openChatWithAgent(agent.id);
				},
			});
		}
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger(
					"agent-client:approve-active-permission" as "quit",
					this._lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger(
					"agent-client:reject-active-permission" as "quit",
					this._lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger(
					"agent-client:toggle-auto-mention" as "quit",
					this._lastActiveChatViewId,
				);
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			callback: () => {
				this.app.workspace.trigger(
					"agent-client:cancel-message" as "quit",
					this._lastActiveChatViewId,
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
		const allChatViews = this.getAllChatViews();
		if (allChatViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		// Find the active (source) view
		const activeViewId = this._lastActiveChatViewId;
		const sourceView = allChatViews.find((v) => v.viewId === activeViewId);

		if (!sourceView) {
			new Notice("[Agent Client] No active chat view found");
			return;
		}

		// Get input state from source view
		const inputState = sourceView.getInputState();
		if (
			!inputState ||
			(inputState.text.trim() === "" && inputState.images.length === 0)
		) {
			new Notice("[Agent Client] No prompt to broadcast");
			return;
		}

		// Broadcast to all other views
		const targetViews = allChatViews.filter(
			(v) => v.viewId !== activeViewId,
		);
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
		const allChatViews = this.getAllChatViews();
		if (allChatViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		// Filter to views that can send
		const sendableViews = allChatViews.filter((v) => v.canSend());
		if (sendableViews.length === 0) {
			new Notice("[Agent Client] No views ready to send");
			return;
		}

		// Send in all views concurrently
		await Promise.allSettled(sendableViews.map((v) => v.sendMessage()));
	}

	/**
	 * Cancel operation in all views
	 */
	private async broadcastCancel(): Promise<void> {
		const allChatViews = this.getAllChatViews();
		if (allChatViews.length === 0) {
			new Notice("[Agent Client] No chat views open");
			return;
		}

		// Cancel in all views concurrently
		await Promise.allSettled(allChatViews.map((v) => v.cancelOperation()));

		new Notice("[Agent Client] Cancel broadcast to all views");
	}

	/**
	 * Get all open ChatView instances
	 */
	private getAllChatViews(): ChatView[] {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		return leaves
			.map((leaf) => leaf.view)
			.filter((view): view is ChatView => view instanceof ChatView);
	}

	async loadSettings() {
		const rawSettings = ((await this.loadData()) ?? {}) as Record<
			string,
			unknown
		>;

		const claudeFromRaw =
			typeof rawSettings.claude === "object" &&
			rawSettings.claude !== null
				? (rawSettings.claude as Record<string, unknown>)
				: {};
		const codexFromRaw =
			typeof rawSettings.codex === "object" && rawSettings.codex !== null
				? (rawSettings.codex as Record<string, unknown>)
				: {};
		const geminiFromRaw =
			typeof rawSettings.gemini === "object" &&
			rawSettings.gemini !== null
				? (rawSettings.gemini as Record<string, unknown>)
				: {};

		const resolvedClaudeArgs = sanitizeArgs(claudeFromRaw.args);
		const resolvedClaudeEnv = normalizeEnvVars(claudeFromRaw.env);
		const resolvedCodexArgs = sanitizeArgs(codexFromRaw.args);
		const resolvedCodexEnv = normalizeEnvVars(codexFromRaw.env);
		const resolvedGeminiArgs = sanitizeArgs(geminiFromRaw.args);
		const resolvedGeminiEnv = normalizeEnvVars(geminiFromRaw.env);
		const customAgents = Array.isArray(rawSettings.customAgents)
			? ensureUniqueCustomAgentIds(
					rawSettings.customAgents.map((agent: unknown) => {
						const agentObj =
							typeof agent === "object" && agent !== null
								? (agent as Record<string, unknown>)
								: {};
						return normalizeCustomAgent(agentObj);
					}),
				)
			: [];

		const availableAgentIds = [
			DEFAULT_SETTINGS.claude.id,
			DEFAULT_SETTINGS.codex.id,
			DEFAULT_SETTINGS.gemini.id,
			...customAgents.map((agent) => agent.id),
		];
		// Migration: support both old activeAgentId and new defaultAgentId
		const rawDefaultId =
			typeof rawSettings.defaultAgentId === "string"
				? rawSettings.defaultAgentId.trim()
				: typeof rawSettings.activeAgentId === "string"
					? rawSettings.activeAgentId.trim()
					: "";
		const fallbackDefaultId =
			availableAgentIds.find((id) => id.length > 0) ||
			DEFAULT_SETTINGS.claude.id;
		const defaultAgentId =
			availableAgentIds.includes(rawDefaultId) && rawDefaultId.length > 0
				? rawDefaultId
				: fallbackDefaultId;

		this.settings = {
			claude: {
				id: DEFAULT_SETTINGS.claude.id,
				displayName:
					typeof claudeFromRaw.displayName === "string" &&
					claudeFromRaw.displayName.trim().length > 0
						? claudeFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.claude.displayName,
				apiKey:
					typeof claudeFromRaw.apiKey === "string"
						? claudeFromRaw.apiKey
						: DEFAULT_SETTINGS.claude.apiKey,
				command:
					typeof claudeFromRaw.command === "string" &&
					claudeFromRaw.command.trim().length > 0
						? claudeFromRaw.command.trim()
						: typeof rawSettings.claudeCodeAcpCommandPath ===
									"string" &&
							  rawSettings.claudeCodeAcpCommandPath.trim()
									.length > 0
							? rawSettings.claudeCodeAcpCommandPath.trim()
							: DEFAULT_SETTINGS.claude.command,
				args: resolvedClaudeArgs.length > 0 ? resolvedClaudeArgs : [],
				env: resolvedClaudeEnv.length > 0 ? resolvedClaudeEnv : [],
			},
			codex: {
				id: DEFAULT_SETTINGS.codex.id,
				displayName:
					typeof codexFromRaw.displayName === "string" &&
					codexFromRaw.displayName.trim().length > 0
						? codexFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.codex.displayName,
				apiKey:
					typeof codexFromRaw.apiKey === "string"
						? codexFromRaw.apiKey
						: DEFAULT_SETTINGS.codex.apiKey,
				command:
					typeof codexFromRaw.command === "string" &&
					codexFromRaw.command.trim().length > 0
						? codexFromRaw.command.trim()
						: DEFAULT_SETTINGS.codex.command,
				args: resolvedCodexArgs.length > 0 ? resolvedCodexArgs : [],
				env: resolvedCodexEnv.length > 0 ? resolvedCodexEnv : [],
			},
			gemini: {
				id: DEFAULT_SETTINGS.gemini.id,
				displayName:
					typeof geminiFromRaw.displayName === "string" &&
					geminiFromRaw.displayName.trim().length > 0
						? geminiFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.gemini.displayName,
				apiKey:
					typeof geminiFromRaw.apiKey === "string"
						? geminiFromRaw.apiKey
						: DEFAULT_SETTINGS.gemini.apiKey,
				command:
					typeof geminiFromRaw.command === "string" &&
					geminiFromRaw.command.trim().length > 0
						? geminiFromRaw.command.trim()
						: typeof rawSettings.geminiCommandPath === "string" &&
							  rawSettings.geminiCommandPath.trim().length > 0
							? rawSettings.geminiCommandPath.trim()
							: DEFAULT_SETTINGS.gemini.command,
				args:
					resolvedGeminiArgs.length > 0
						? resolvedGeminiArgs
						: DEFAULT_SETTINGS.gemini.args,
				env: resolvedGeminiEnv.length > 0 ? resolvedGeminiEnv : [],
			},
			customAgents: customAgents,
			defaultAgentId,
			autoAllowPermissions:
				typeof rawSettings.autoAllowPermissions === "boolean"
					? rawSettings.autoAllowPermissions
					: DEFAULT_SETTINGS.autoAllowPermissions,
			autoMentionActiveNote:
				typeof rawSettings.autoMentionActiveNote === "boolean"
					? rawSettings.autoMentionActiveNote
					: DEFAULT_SETTINGS.autoMentionActiveNote,
			debugMode:
				typeof rawSettings.debugMode === "boolean"
					? rawSettings.debugMode
					: DEFAULT_SETTINGS.debugMode,
			nodePath:
				typeof rawSettings.nodePath === "string"
					? rawSettings.nodePath.trim()
					: DEFAULT_SETTINGS.nodePath,
			exportSettings: (() => {
				const rawExport = rawSettings.exportSettings as
					| Record<string, unknown>
					| null
					| undefined;
				if (rawExport && typeof rawExport === "object") {
					return {
						defaultFolder:
							typeof rawExport.defaultFolder === "string"
								? rawExport.defaultFolder
								: DEFAULT_SETTINGS.exportSettings.defaultFolder,
						filenameTemplate:
							typeof rawExport.filenameTemplate === "string"
								? rawExport.filenameTemplate
								: DEFAULT_SETTINGS.exportSettings
										.filenameTemplate,
						autoExportOnNewChat:
							typeof rawExport.autoExportOnNewChat === "boolean"
								? rawExport.autoExportOnNewChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnNewChat,
						autoExportOnCloseChat:
							typeof rawExport.autoExportOnCloseChat === "boolean"
								? rawExport.autoExportOnCloseChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnCloseChat,
						openFileAfterExport:
							typeof rawExport.openFileAfterExport === "boolean"
								? rawExport.openFileAfterExport
								: DEFAULT_SETTINGS.exportSettings
										.openFileAfterExport,
						includeImages:
							typeof rawExport.includeImages === "boolean"
								? rawExport.includeImages
								: DEFAULT_SETTINGS.exportSettings.includeImages,
						imageLocation:
							rawExport.imageLocation === "obsidian" ||
							rawExport.imageLocation === "custom" ||
							rawExport.imageLocation === "base64"
								? rawExport.imageLocation
								: DEFAULT_SETTINGS.exportSettings.imageLocation,
						imageCustomFolder:
							typeof rawExport.imageCustomFolder === "string"
								? rawExport.imageCustomFolder
								: DEFAULT_SETTINGS.exportSettings
										.imageCustomFolder,
						frontmatterTag:
							typeof rawExport.frontmatterTag === "string"
								? rawExport.frontmatterTag
								: DEFAULT_SETTINGS.exportSettings
										.frontmatterTag,
					};
				}
				return DEFAULT_SETTINGS.exportSettings;
			})(),
			windowsWslMode:
				typeof rawSettings.windowsWslMode === "boolean"
					? rawSettings.windowsWslMode
					: DEFAULT_SETTINGS.windowsWslMode,
			windowsWslDistribution:
				typeof rawSettings.windowsWslDistribution === "string"
					? rawSettings.windowsWslDistribution
					: DEFAULT_SETTINGS.windowsWslDistribution,
			sendMessageShortcut:
				rawSettings.sendMessageShortcut === "enter" ||
				rawSettings.sendMessageShortcut === "cmd-enter"
					? rawSettings.sendMessageShortcut
					: DEFAULT_SETTINGS.sendMessageShortcut,
			chatViewLocation:
				rawSettings.chatViewLocation === "right-tab" ||
				rawSettings.chatViewLocation === "editor-tab" ||
				rawSettings.chatViewLocation === "editor-split"
					? rawSettings.chatViewLocation
					: DEFAULT_SETTINGS.chatViewLocation,
			displaySettings: (() => {
				const rawDisplay = rawSettings.displaySettings as
					| Record<string, unknown>
					| null
					| undefined;
				if (rawDisplay && typeof rawDisplay === "object") {
					return {
						autoCollapseDiffs:
							typeof rawDisplay.autoCollapseDiffs === "boolean"
								? rawDisplay.autoCollapseDiffs
								: DEFAULT_SETTINGS.displaySettings
										.autoCollapseDiffs,
						diffCollapseThreshold:
							typeof rawDisplay.diffCollapseThreshold ===
								"number" && rawDisplay.diffCollapseThreshold > 0
								? rawDisplay.diffCollapseThreshold
								: DEFAULT_SETTINGS.displaySettings
										.diffCollapseThreshold,
						maxNoteLength:
							typeof rawDisplay.maxNoteLength === "number" &&
							rawDisplay.maxNoteLength >= 1
								? rawDisplay.maxNoteLength
								: DEFAULT_SETTINGS.displaySettings
										.maxNoteLength,
						maxSelectionLength:
							typeof rawDisplay.maxSelectionLength === "number" &&
							rawDisplay.maxSelectionLength >= 1
								? rawDisplay.maxSelectionLength
								: DEFAULT_SETTINGS.displaySettings
										.maxSelectionLength,
						showEmojis:
							typeof rawDisplay.showEmojis === "boolean"
								? rawDisplay.showEmojis
								: DEFAULT_SETTINGS.displaySettings.showEmojis,
					};
				}
				return DEFAULT_SETTINGS.displaySettings;
			})(),
			savedSessions: Array.isArray(rawSettings.savedSessions)
				? (rawSettings.savedSessions as SavedSessionInfo[])
				: DEFAULT_SETTINGS.savedSessions,
			showFloatingButton:
				typeof rawSettings.showFloatingButton === "boolean"
					? rawSettings.showFloatingButton
					: DEFAULT_SETTINGS.showFloatingButton,
			floatingButtonImage:
				typeof rawSettings.floatingButtonImage === "string"
					? rawSettings.floatingButtonImage
					: DEFAULT_SETTINGS.floatingButtonImage,
			floatingWindowSize: (() => {
				const raw = rawSettings.floatingWindowSize as
					| { width?: number; height?: number }
					| null
					| undefined;
				if (
					raw &&
					typeof raw === "object" &&
					typeof raw.width === "number" &&
					typeof raw.height === "number"
				) {
					return { width: raw.width, height: raw.height };
				}
				return DEFAULT_SETTINGS.floatingWindowSize;
			})(),
			floatingWindowPosition: (() => {
				const raw = rawSettings.floatingWindowPosition as
					| { x?: number; y?: number }
					| null
					| undefined;
				if (
					raw &&
					typeof raw === "object" &&
					typeof raw.x === "number" &&
					typeof raw.y === "number"
				) {
					return { x: raw.x, y: raw.y };
				}
				return null;
			})(),
		};

		this.ensureDefaultAgentId();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		this.settings = nextSettings;
		await this.saveData(this.settings);
		this.settingsStore.set(this.settings);
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
