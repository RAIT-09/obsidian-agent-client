import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Plugin,
	WorkspaceLeaf,
} from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ChatView";
import { createSettingsStore, type SettingsStore } from "./settings-store";
import { AgentClientSettingTab } from "./components/settings/AgentClientSettingTab";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
} from "./utils/settings-utils";

export interface AgentEnvVar {
	key: string;
	value: string;
}

interface BaseAgentSettings {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env: AgentEnvVar[];
}

interface GeminiAgentSettings extends BaseAgentSettings {
	apiKey: string;
}

interface ClaudeAgentSettings extends BaseAgentSettings {
	apiKey: string;
}

export interface CustomAgentSettings extends BaseAgentSettings {}

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	customAgents: CustomAgentSettings[];
	activeAgentId: string;
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
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;

	async onload() {
		await this.loadSettings();

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Agent Client",
			(_evt: MouseEvent) => {
				this.activateView();
			},
		);
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						new SampleModal(this.app).open();
					}
					return true;
				}
			},
		});

		this.addSettingTab(new AgentClientSettingTab(this.app, this));

		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000),
		);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
	}

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

		const geminiFromRaw = (raw as any).gemini ?? {};
		const claudeFromRaw = (raw as any).claude ?? {};

		const resolvedGeminiArgs = sanitizeArgs(geminiFromRaw.args);
		const resolvedGeminiEnv = normalizeEnvVars(geminiFromRaw.env);
		const resolvedClaudeArgs = sanitizeArgs(claudeFromRaw.args);
		const resolvedClaudeEnv = normalizeEnvVars(claudeFromRaw.env);
		const customAgents = Array.isArray((raw as any).customAgents)
			? ensureUniqueCustomAgentIds(
					(raw as any).customAgents.map((agent: any) =>
						normalizeCustomAgent(agent),
					),
				)
			: [];

		const availableAgentIds = [
			DEFAULT_SETTINGS.claude.id,
			DEFAULT_SETTINGS.gemini.id,
			...customAgents.map((agent) => agent.id),
		];
		const rawActiveId =
			typeof (raw as any).activeAgentId === "string"
				? (raw as any).activeAgentId.trim()
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
						: typeof (raw as any).geminiApiKey === "string"
							? (raw as any).geminiApiKey
							: DEFAULT_SETTINGS.gemini.apiKey,
				command:
					typeof geminiFromRaw.command === "string" &&
					geminiFromRaw.command.trim().length > 0
						? geminiFromRaw.command.trim()
						: typeof (raw as any).geminiCommandPath === "string" &&
							  (raw as any).geminiCommandPath.trim().length > 0
							? (raw as any).geminiCommandPath.trim()
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
						: typeof (raw as any).anthropicApiKey === "string"
							? (raw as any).anthropicApiKey
							: DEFAULT_SETTINGS.claude.apiKey,
				command:
					typeof claudeFromRaw.command === "string" &&
					claudeFromRaw.command.trim().length > 0
						? claudeFromRaw.command.trim()
						: typeof (raw as any).claudeCodeAcpCommandPath ===
									"string" &&
							  (raw as any).claudeCodeAcpCommandPath.trim()
									.length > 0
							? (raw as any).claudeCodeAcpCommandPath.trim()
							: DEFAULT_SETTINGS.claude.command,
				args: resolvedClaudeArgs.length > 0 ? resolvedClaudeArgs : [],
				env: resolvedClaudeEnv.length > 0 ? resolvedClaudeEnv : [],
			},
			customAgents: customAgents,
			activeAgentId,
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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
