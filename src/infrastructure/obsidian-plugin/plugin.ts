import { Plugin, WorkspaceLeaf, Notice, requestUrl } from "obsidian";
import {
	ChatView,
	VIEW_TYPE_CHAT,
} from "../../presentation/views/chat/ChatView";
import {
	createSettingsStore,
	type SettingsStore,
} from "../../adapters/obsidian/settings-store.adapter";
import { AgentClientSettingTab } from "../../presentation/components/settings/AgentClientSettingTab";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
} from "../../shared/settings-utils";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CustomAgentSettings,
} from "../../core/domain/models/agent-config";

// Re-export for backward compatibility
export type { AgentEnvVar, CustomAgentSettings };

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	customAgents: CustomAgentSettings[];
	activeAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
	debugMode: boolean;
	nodePath: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
	};
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	customAgents: [],
	activeAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	debugMode: false,
	nodePath: "",
	exportSettings: {
		defaultFolder: "Agent Client",
		filenameTemplate: "agent_client_{date}_{time}",
	},
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;

	// Active ACP adapter instance (shared across use cases)
	acpAdapter: import("../../adapters/acp/acp.adapter").AcpAdapter | null =
		null;

	async onload() {
		await this.loadSettings();

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings, this);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon(
			"bot-message-square",
			"Open agent client",
			(_evt: MouseEvent) => {
				this.activateView();
			},
		);
		ribbonIconEl.addClass("agent-client-ribbon-icon");

		this.addCommand({
			id: "open-agent-client-chat-view",
			name: "Open agent chat",
			callback: () => {
				this.activateView();
			},
		});

		this.addSettingTab(new AgentClientSettingTab(this.app, this));
	}

	onunload() {}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		const raw = (await this.loadData()) ?? {};

		// Type guard: treat raw as a record of unknown values
		const rawSettings = raw as Record<string, unknown>;

		const geminiFromRaw =
			typeof rawSettings.gemini === "object" &&
			rawSettings.gemini !== null
				? (rawSettings.gemini as Record<string, unknown>)
				: {};
		const claudeFromRaw =
			typeof rawSettings.claude === "object" &&
			rawSettings.claude !== null
				? (rawSettings.claude as Record<string, unknown>)
				: {};

		const resolvedGeminiArgs = sanitizeArgs(geminiFromRaw.args);
		const resolvedGeminiEnv = normalizeEnvVars(geminiFromRaw.env);
		const resolvedClaudeArgs = sanitizeArgs(claudeFromRaw.args);
		const resolvedClaudeEnv = normalizeEnvVars(claudeFromRaw.env);
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
			DEFAULT_SETTINGS.gemini.id,
			...customAgents.map((agent) => agent.id),
		];
		const rawActiveId =
			typeof rawSettings.activeAgentId === "string"
				? rawSettings.activeAgentId.trim()
				: "";
		const fallbackActiveId =
			availableAgentIds.find((id) => id.length > 0) ||
			DEFAULT_SETTINGS.claude.id;
		const activeAgentId =
			availableAgentIds.includes(rawActiveId) && rawActiveId.length > 0
				? rawActiveId
				: fallbackActiveId;

		this.settings = {
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
			customAgents: customAgents,
			activeAgentId,
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
					};
				}
				return DEFAULT_SETTINGS.exportSettings;
			})(),
		};

		this.ensureActiveAgentId();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		this.settings = nextSettings;
		await this.saveData(this.settings);
		this.settingsStore.set(this.settings);
	}

	async checkForUpdates(): Promise<boolean> {
		const response = await requestUrl({
			url: "https://api.github.com/repos/RAIT-09/obsidian-agent-client/releases/latest",
		});
		const data = response.json;
		const latestVersion = data.tag_name;
		const currentVersion = this.manifest.version;

		if (latestVersion !== currentVersion) {
			new Notice(`[Agent Client] Update available: v${latestVersion}`);
			return true;
		}
		return false;
	}

	ensureActiveAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (availableIds.length === 0) {
			this.settings.activeAgentId = DEFAULT_SETTINGS.claude.id;
			return;
		}
		if (!availableIds.includes(this.settings.activeAgentId)) {
			this.settings.activeAgentId = availableIds[0];
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		ids.add(this.settings.claude.id);
		ids.add(this.settings.gemini.id);
		for (const agent of this.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}
}
