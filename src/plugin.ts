import {
	Plugin,
	WorkspaceLeaf,
	Notice,
	addIcon,
	type IconName,
} from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./components/chat/ChatView";
import { ChatViewRegistry } from "./shared/chat-view-registry";
import {
	createSettingsStore,
	type SettingsStore,
} from "./adapters/obsidian/settings-store.adapter";
import { AgentClientSettingTab } from "./components/settings/AgentClientSettingTab";
import { AcpAdapter } from "./adapters/acp/acp.adapter";
import { AgentRuntimeManager } from "./adapters/acp/agent-runtime-manager";
import type { AgentConfig } from "./domain/ports/agent-client.port";
import {
	AgentEnvVar,
	AgentSecretBinding,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	OpenCodeAgentSettings,
	CustomAgentSettings,
	type BaseAgentSettings,
} from "./domain/models/agent-config";
import type { SavedSessionInfo } from "./domain/models/session-info";
import { initializeLogger } from "./shared/logger";
import {
	createDefaultSettings,
	parseStoredSettings,
	SETTINGS_SCHEMA_VERSION,
} from "./shared/settings-schema";
import {
	broadcastCancel,
	broadcastPrompt,
	broadcastSend,
	ensureDefaultAgentId,
	getAvailableAgents,
	openChatWithAgent,
	registerAgentCommands,
	registerBroadcastCommands,
	registerPermissionCommands,
} from "./plugin/agent-ops";
import {
	addContextToCurrentChat,
	openContextReferenceInEditor,
	registerEditorContextMenus,
} from "./plugin/editor-context";
import { checkForUpdates } from "./plugin/update-check";
import { createNewChatLeaf, focusChatTextarea } from "./plugin/view-helpers";
import { registerInlineEditCommand } from "./plugin/inline-edit";
import type { ChatContextReference } from "./shared/chat-context-token";
import {
	getApiKeyForAgentId,
	getSecretBindingEnvForAgentId,
} from "./shared/secret-storage";
import { resolveVaultBasePath } from "./shared/vault-path";
import { toAgentConfig } from "./shared/settings-utils";
import { resolveShellEnvironment } from "./shared/shell-utils";

export type { AgentEnvVar, AgentSecretBinding, CustomAgentSettings };

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

export type TerminalPermissionMode =
	| "disabled"
	| "prompt_once"
	| "always_allow"
	| "always_deny";

const KEYCHAIN_ONLY_ENV_KEYS = new Set([
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
]);

function removeKeychainOnlyEnv(
	env: Record<string, string>,
): Record<string, string> {
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (KEYCHAIN_ONLY_ENV_KEYS.has(key)) {
			continue;
		}
		cleaned[key] = value;
	}
	return cleaned;
}

export interface AgentClientPluginSettings {
	schemaVersion: number;
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	opencode: OpenCodeAgentSettings;
	customAgents: CustomAgentSettings[];
	/** Default agent ID for new views (renamed from activeAgentId for multi-session) */
	defaultAgentId: string;
	/** Global environment-variable to keychain binding */
	secretBindings: AgentSecretBinding[];
	terminalPermissionMode: TerminalPermissionMode;
	autoMentionActiveNote: boolean;
	debugMode: boolean;
	nodePath: string;
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
		fontSize: number | null;
		completionSound: boolean;
	};
	// Locally saved session metadata (for agents without session/list support)
	savedSessions: SavedSessionInfo[];
	// Last used model per agent (agentId → modelId)
	lastUsedModels: Record<string, string>;
	// Candidate models per agent (agentId → modelId[]) — empty means "show all"
	candidateModels?: Record<string, string[]>;
	// Cached model lists from last session per agent (for settings UI when agent is offline)
	cachedAgentModels?: Record<
		string,
		{ modelId: string; name: string; description?: string }[]
	>;
	// Cached mode lists from last session per agent
	cachedAgentModes?: Record<
		string,
		{ id: string; name: string; description?: string }[]
	>;
	// User-configured default model per mode per agent (agentId → modeId → modelId)
	modeModelDefaults?: Record<string, Record<string, string>>;
	// Auto-remembered last model per mode per agent (agentId → modeId → modelId)
	lastModeModels?: Record<string, Record<string, string>>;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	...createDefaultSettings(),
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;
	private agentCatalogRefreshInFlight = new Map<string, Promise<boolean>>();

	/** Registry for all chat view containers */
	viewRegistry = new ChatViewRegistry();

	/** Shared ACP runtimes — one process/connection per agent, reused across tabs */
	runtimeManager = new AgentRuntimeManager();

	/** Map of sessionKey (tab ID) to AcpAdapter — each tab owns one ACP session */
	private _sessionAdapters: Map<string, AcpAdapter> = new Map();

	async onload() {
		await this.loadSettings();
		void resolveShellEnvironment();

		initializeLogger(this.settings);

		addIcon(
			"obsius-o",
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
				<defs>
					<mask id="obsius-o-cutout">
						<rect width="100" height="100" fill="black" />
						<g transform="rotate(18 50 50)">
							<ellipse cx="50" cy="50" rx="41" ry="34" fill="white" />
						</g>
						<g transform="rotate(-23 47 54)">
							<ellipse cx="47" cy="54" rx="18" ry="13" fill="black" />
						</g>
					</mask>
				</defs>
				<rect width="100" height="100" fill="#6F6F6F" mask="url(#obsius-o-cutout)" />
			</svg>`,
		);

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings, this);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon(
			"obsius-o" as IconName,
			"Open Obsius",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("obsius-ribbon-icon");

		this.addCommand({
			id: "open-chat-view",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name
			name: "Open Obsius",
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
				void this.openNewChatViewWithAgent(this.settings.defaultAgentId);
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();
		this.registerBroadcastCommands();
		registerEditorContextMenus(this);
		registerInlineEditCommand(this);

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		// Clean up all ACP sessions and runtimes when Obsidian quits
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				this._sessionAdapters.clear();
				this.runtimeManager.disconnectAll();
			}),
		);
	}

	onunload() {
		// Clear registry (sidebar views are managed by Obsidian workspace)
		this.viewRegistry.clear();
	}

	/**
	 * Get or create an AcpAdapter for a session key (tab ID).
	 * Each chat tab owns one ACP session via its adapter.
	 */
	getOrCreateSessionAdapter(sessionKey: string): AcpAdapter {
		let adapter = this._sessionAdapters.get(sessionKey);
		if (!adapter) {
			adapter = new AcpAdapter(this);
			this._sessionAdapters.set(sessionKey, adapter);
		}
		return adapter;
	}

	/**
	 * Remove and disconnect the adapter for a session key.
	 * Called when a chat tab or view is closed.
	 *
	 * The adapter's `disconnect()` unregisters from the shared runtime
	 * and decrements the refcount. The runtime process is only killed
	 * when the last tab using that agent disconnects.
	 */
	async removeSessionAdapter(sessionKey: string): Promise<void> {
		const adapter = this._sessionAdapters.get(sessionKey);
		if (adapter) {
			try {
				await adapter.disconnect();
			} catch (error) {
				console.warn(
					`[AgentClient] Failed to disconnect adapter for session ${sessionKey}:`,
					error,
				);
			}
			this._sessionAdapters.delete(sessionKey);
		}
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
					leaves.find((l) => (l.view as ChatView)?.viewId === focusedId) ||
					leaves[0];
			} else {
				leaf = leaves[0];
			}
		} else {
			leaf = createNewChatLeaf(
				this.app,
				this.settings.chatViewLocation,
				false,
				VIEW_TYPE_CHAT,
			);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			focusChatTextarea(leaf);
		}
	}

	/**
	 * Focus the next or previous ChatView in the list.
	 */
	private focusChatView(direction: "next" | "previous"): void {
		if (direction === "next") {
			this.viewRegistry.focusNext();
		} else {
			this.viewRegistry.focusPrevious();
		}
	}

	/**
	 * Open a new chat view with a specific agent.
	 * Always creates a new view (doesn't reuse existing).
	 */
	async openNewChatViewWithAgent(agentId: string): Promise<void> {
		const leaf = createNewChatLeaf(
			this.app,
			this.settings.chatViewLocation,
			true,
			VIEW_TYPE_CHAT,
		);
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
		focusChatTextarea(leaf, 0);
	}

	/**
	 * Get all available agents (claude, codex, gemini, custom)
	 */
	getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return getAvailableAgents(this.settings);
	}

	/**
	 * Open chat view and switch to specified agent
	 */
	private async openChatWithAgent(agentId: string): Promise<void> {
		await openChatWithAgent(this, agentId);
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		registerAgentCommands(this);
	}

	private registerPermissionCommands(): void {
		registerPermissionCommands(this);
	}

	/**
	 * Register broadcast commands for multi-view operations
	 */
	private registerBroadcastCommands(): void {
		registerBroadcastCommands(this);
	}

	async addContextReferenceToCurrentChat(
		reference: ChatContextReference,
	): Promise<boolean> {
		return await addContextToCurrentChat(this, reference);
	}

	async openContextReference(reference: ChatContextReference): Promise<void> {
		await openContextReferenceInEditor(this.app, reference);
	}

	/**
	 * Copy prompt from active view to all other views
	 */
	private broadcastPrompt(): void {
		broadcastPrompt(this);
	}

	/**
	 * Send message in all views that can send
	 */
	private async broadcastSend(): Promise<void> {
		await broadcastSend(this);
	}

	/**
	 * Cancel operation in all views
	 */
	private async broadcastCancel(): Promise<void> {
		await broadcastCancel(this);
	}

	async loadSettings() {
		const rawSettings: unknown = (await this.loadData()) ?? {};
		const { settings, resetReason } = parseStoredSettings(rawSettings);
		this.settings = settings;
		this.ensureDefaultAgentId();

		if (resetReason) {
			new Notice(
				`[Obsius] Settings were reset due to incompatible schema (${resetReason}). Clean break policy is active from schema version ${SETTINGS_SCHEMA_VERSION}.`,
			);
			await this.saveSettings();
		}
	}

	async saveSettings() {
		this.settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
		await this.saveData(this.settings);
	}

	/**
	 * Check for plugin updates.
	 * - Stable version users: compare with latest stable release
	 * - Prerelease users: compare with both latest stable and latest prerelease
	 */
	async checkForUpdates(): Promise<boolean> {
		const currentVersion = await this.resolveInstalledVersion();
		return await checkForUpdates(currentVersion);
	}

	private async resolveInstalledVersion(): Promise<string> {
		const runtimeVersion = this.manifest.version;
		const manifestPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/manifest.json`;

		try {
			const rawManifest = await this.app.vault.adapter.read(manifestPath);
			const parsed = JSON.parse(rawManifest) as { version?: unknown };
			if (typeof parsed.version === "string" && parsed.version.trim()) {
				return parsed.version.trim();
			}
		} catch {
			// Fallback to runtime manifest version.
		}

		return runtimeVersion;
	}

	ensureDefaultAgentId(): void {
		ensureDefaultAgentId(this.settings, DEFAULT_SETTINGS.claude.id);
	}

	private getAgentSettingsById(agentId: string): BaseAgentSettings | null {
		if (agentId === this.settings.claude.id) {
			return this.settings.claude;
		}
		if (agentId === this.settings.opencode.id) {
			return this.settings.opencode;
		}
		if (agentId === this.settings.codex.id) {
			return this.settings.codex;
		}
		if (agentId === this.settings.gemini.id) {
			return this.settings.gemini;
		}
		return (
			this.settings.customAgents.find((agent) => agent.id === agentId) || null
		);
	}

	private buildAgentConfigForCatalog(agentId: string): AgentConfig | null {
		const agentSettings = this.getAgentSettingsById(agentId);
		if (!agentSettings) {
			return null;
		}
		const workingDirectory = resolveVaultBasePath(this.app);
		const baseConfig = toAgentConfig(agentSettings, workingDirectory);
		const apiKey = getApiKeyForAgentId(
			this.app.secretStorage,
			this.settings,
			agentId,
		);
		const secretBindingEnv = getSecretBindingEnvForAgentId(
			this.app.secretStorage,
			this.settings,
			agentId,
		);
		const mergedEnv = {
			...removeKeychainOnlyEnv(baseConfig.env || {}),
			...secretBindingEnv,
		};

		if (agentId === this.settings.claude.id) {
			return {
				...baseConfig,
				env: {
					...mergedEnv,
					ANTHROPIC_API_KEY: apiKey,
				},
			};
		}
		if (agentId === this.settings.codex.id) {
			return {
				...baseConfig,
				env: {
					...mergedEnv,
					OPENAI_API_KEY: apiKey,
				},
			};
		}
		if (agentId === this.settings.gemini.id) {
			return {
				...baseConfig,
				env: {
					...mergedEnv,
					GEMINI_API_KEY: apiKey,
				},
			};
		}

		return {
			...baseConfig,
			env: mergedEnv,
		};
	}

	async refreshAgentCatalog(
		agentId: string,
		options?: { force?: boolean },
	): Promise<boolean> {
		const existingModels = this.settings.cachedAgentModels?.[agentId];
		const existingModes = this.settings.cachedAgentModes?.[agentId];
		if (
			!options?.force &&
			(existingModels?.length ?? 0) > 0 &&
			(existingModes?.length ?? 0) > 0
		) {
			return true;
		}

		const inFlight = this.agentCatalogRefreshInFlight.get(agentId);
		if (inFlight) {
			return inFlight;
		}

		const task = (async (): Promise<boolean> => {
			const config = this.buildAgentConfigForCatalog(agentId);
			if (!config) {
				return false;
			}

			const adapter = new AcpAdapter(this);
			try {
				await adapter.initialize(config);
				const session = await adapter.newSession(config.workingDirectory);
				await this.settingsStore.updateSettings({
					cachedAgentModels: {
						...this.settings.cachedAgentModels,
						[agentId]: session.models
							? session.models.availableModels.map((model) => ({
									modelId: model.modelId,
									name: model.name,
									description: model.description,
								}))
							: [],
					},
					cachedAgentModes: {
						...this.settings.cachedAgentModes,
						[agentId]: session.modes
							? session.modes.availableModes.map((mode) => ({
									id: mode.id,
									name: mode.name,
									description: mode.description,
								}))
							: [],
					},
				});
				return true;
			} catch (error) {
				console.warn(
					`[AgentClient] Failed to refresh model/mode catalog for agent "${agentId}":`,
					error,
				);
				return false;
			} finally {
				try {
					await adapter.disconnect();
				} catch {
					void 0;
				}
			}
		})().finally(() => {
			this.agentCatalogRefreshInFlight.delete(agentId);
		});

		this.agentCatalogRefreshInFlight.set(agentId, task);
		return await task;
	}
}
