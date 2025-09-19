import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	DropdownComponent,
} from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./ChatView";
import { createSettingsStore, type SettingsStore } from "./settings-store";

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
		command: "gemini",
		args: [],
		env: [],
	},
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "claude-code-acp",
		args: [],
		env: [],
	},
	customAgents: [],
	activeAgentId: "claude-code-acp",
};

// Ensure custom agent IDs are unique within the collection
const ensureUniqueCustomAgentIds = (
	agents: CustomAgentSettings[],
): CustomAgentSettings[] => {
	const seen = new Set<string>();
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0
				? agent.id.trim()
				: "custom-agent";
		let candidate = base;
		let suffix = 2;
		while (seen.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		seen.add(candidate);
		return { ...agent, id: candidate };
	});
};

const sanitizeArgs = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

// Convert stored env structures into a deduplicated list
const normalizeEnvVars = (value: unknown): AgentEnvVar[] => {
	const pairs: AgentEnvVar[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (entry && typeof entry === "object") {
				const key = "key" in entry ? (entry as any).key : undefined;
				const val = "value" in entry ? (entry as any).value : undefined;
				if (typeof key === "string" && key.trim().length > 0) {
					pairs.push({
						key: key.trim(),
						value: typeof val === "string" ? val : "",
					});
				}
			}
		}
	} else if (typeof value === "object") {
		for (const [key, val] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (typeof key === "string" && key.trim().length > 0) {
				pairs.push({
					key: key.trim(),
					value: typeof val === "string" ? val : "",
				});
			}
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.key)) {
			return false;
		}
		seen.add(pair.key);
		return true;
	});
};

// Rebuild a custom agent entry with defaults and cleaned values
const normalizeCustomAgent = (agent: any): CustomAgentSettings => {
	const rawId =
		agent && typeof agent.id === "string" && agent.id.trim().length > 0
			? agent.id.trim()
			: "custom-agent";
	const rawDisplayName =
		agent &&
		typeof agent.displayName === "string" &&
		agent.displayName.trim().length > 0
			? agent.displayName.trim()
			: rawId;
	return {
		id: rawId,
		displayName: rawDisplayName,
		command:
			agent &&
			typeof agent.command === "string" &&
			agent.command.trim().length > 0
				? agent.command.trim()
				: "",
		args: sanitizeArgs(agent?.args),
		env: normalizeEnvVars(agent?.env),
	};
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
				args: resolvedGeminiArgs.length > 0 ? resolvedGeminiArgs : [],
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

class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.agentSelector = null;

		this.renderAgentSelector(containerEl);

		containerEl.createEl("h2", { text: "Built-in agents" });

		const builtInSection = containerEl.createDiv();
		this.renderGeminiSettings(builtInSection);
		this.renderClaudeSettings(builtInSection);

		containerEl.createEl("h2", { text: "Custom agents" });

		const customSection = containerEl.createDiv();
		this.renderCustomAgents(customSection);
	}

	private renderAgentSelector(containerEl: HTMLElement) {
		this.plugin.ensureActiveAgentId();

		new Setting(containerEl)
			.setName("Active agent")
			.setDesc("Choose which agent handles new chat sessions.")
			.addDropdown((dropdown) => {
				this.agentSelector = dropdown;
				this.populateAgentDropdown(dropdown);
				dropdown.setValue(this.plugin.settings.activeAgentId);
				dropdown.onChange(async (value) => {
					const nextSettings = {
						...this.plugin.settings,
						activeAgentId: value,
					};
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
				});
			});
	}

	private populateAgentDropdown(dropdown: DropdownComponent) {
		dropdown.selectEl.innerHTML = "";
		for (const option of this.getAgentOptions()) {
			dropdown.addOption(option.id, option.label);
		}
	}

	private refreshAgentDropdown() {
		if (!this.agentSelector) {
			return;
		}
		this.populateAgentDropdown(this.agentSelector);
		this.agentSelector.setValue(this.plugin.settings.activeAgentId);
	}

	private getAgentOptions(): { id: string; label: string }[] {
		const toOption = (id: string, displayName: string) => ({
			id,
			label: `${displayName} (${id})`,
		});
		const options: { id: string; label: string }[] = [
			toOption(
				this.plugin.settings.claude.id,
				this.plugin.settings.claude.displayName ||
					this.plugin.settings.claude.id,
			),
			toOption(
				this.plugin.settings.gemini.id,
				this.plugin.settings.gemini.displayName ||
					this.plugin.settings.gemini.id,
			),
		];
		for (const agent of this.plugin.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				const labelSource =
					agent.displayName && agent.displayName.length > 0
						? agent.displayName
						: agent.id;
				options.push(toOption(agent.id, labelSource));
			}
		}
		const seen = new Set<string>();
		return options.filter(({ id }) => {
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});
	}

	private renderGeminiSettings(sectionEl: HTMLElement) {
		const gemini = this.plugin.settings.gemini;

		sectionEl.createEl("h3", { text: gemini.displayName || "Gemini CLI" });

		new Setting(sectionEl)
			.setName("API key")
			.setDesc("Gemini API key. Stored as plain text.")
			.addText((text) => {
				text.setPlaceholder("Enter your Gemini API key")
					.setValue(gemini.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.gemini.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName("Command")
			.setDesc(
				"Command that launches the Gemini CLI. Use only the filename if it is on PATH.",
			)
			.addText((text) => {
				text.setPlaceholder("gemini")
					.setValue(gemini.command)
					.onChange(async (value) => {
						this.plugin.settings.gemini.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("--project\n--other-flag")
					.setValue(this.formatArgs(gemini.args))
					.onChange(async (value) => {
						this.plugin.settings.gemini.args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. GEMINI_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("GEMINI_API_KEY=...")
					.setValue(this.formatEnv(gemini.env))
					.onChange(async (value) => {
						this.plugin.settings.gemini.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderClaudeSettings(sectionEl: HTMLElement) {
		const claude = this.plugin.settings.claude;

		sectionEl.createEl("h3", {
			text: claude.displayName || "Claude Code (ACP)",
		});

		new Setting(sectionEl)
			.setName("API key")
			.setDesc("Anthropic API key. Stored as plain text.")
			.addText((text) => {
				text.setPlaceholder("Enter your Anthropic API key")
					.setValue(claude.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.claude.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName("Command")
			.setDesc(
				"Command for the Claude Code ACP CLI or another ACP-compatible agent.",
			)
			.addText((text) => {
				text.setPlaceholder("claude-code-acp")
					.setValue(claude.command)
					.onChange(async (value) => {
						this.plugin.settings.claude.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("--model=claude-3-5")
					.setValue(this.formatArgs(claude.args))
					.onChange(async (value) => {
						this.plugin.settings.claude.args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. ANTHROPIC_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("ANTHROPIC_API_KEY=...")
					.setValue(this.formatEnv(claude.env))
					.onChange(async (value) => {
						this.plugin.settings.claude.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderCustomAgents(containerEl: HTMLElement) {
		if (this.plugin.settings.customAgents.length === 0) {
			containerEl.createEl("p", {
				text: "No custom agents configured yet.",
			});
		} else {
			this.plugin.settings.customAgents.forEach((agent, index) => {
				this.renderCustomAgent(containerEl, agent, index);
			});
		}

		new Setting(containerEl).addButton((button) => {
			button
				.setButtonText("Add custom agent")
				.setCta()
				.onClick(async () => {
					const newId = this.generateCustomAgentId();
					const newDisplayName =
						this.generateCustomAgentDisplayName();
					this.plugin.settings.customAgents.push({
						id: newId,
						displayName: newDisplayName,
						command: "",
						args: [],
						env: [],
					});
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});
	}

	private renderCustomAgent(
		containerEl: HTMLElement,
		agent: CustomAgentSettings,
		index: number,
	) {
		const blockEl = containerEl.createDiv({
			cls: "agent-client-custom-agent",
		});

		const idSetting = new Setting(blockEl)
			.setName("Agent ID")
			.setDesc("Unique identifier used to reference this agent.")
			.addText((text) => {
				text.setPlaceholder("custom-agent")
					.setValue(agent.id)
					.onChange(async (value) => {
						const previousId =
							this.plugin.settings.customAgents[index].id;
						const trimmed = value.trim();
						let nextId = trimmed;
						if (nextId.length === 0) {
							nextId = this.generateCustomAgentId();
							text.setValue(nextId);
						}
						this.plugin.settings.customAgents[index].id = nextId;
						if (this.plugin.settings.activeAgentId === previousId) {
							this.plugin.settings.activeAgentId = nextId;
						}
						this.plugin.ensureActiveAgentId();
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		idSetting.addExtraButton((button) => {
			button
				.setIcon("trash")
				.setTooltip("Delete this agent")
				.onClick(async () => {
					this.plugin.settings.customAgents.splice(index, 1);
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName("Display name")
			.setDesc("Shown in menus and headers.")
			.addText((text) => {
				text.setPlaceholder("Custom agent")
					.setValue(agent.displayName || agent.id)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.customAgents[index].displayName =
							trimmed.length > 0
								? trimmed
								: this.plugin.settings.customAgents[index].id;
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		new Setting(blockEl).setName("Command").addText((text) => {
			text.setPlaceholder("my-agent-cli")
				.setValue(agent.command)
				.onChange(async (value) => {
					this.plugin.settings.customAgents[index].command =
						value.trim();
					await this.plugin.saveSettings();
				});
		});

		new Setting(blockEl)
			.setName("Arguments")
			.setDesc("Enter one argument per line.")
			.addTextArea((text) => {
				text.setPlaceholder("--flag\n--another=value")
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName("Environment variables")
			.setDesc("Enter KEY=VALUE pairs, one per line.")
			.addTextArea((text) => {
				text.setPlaceholder("TOKEN=...")
					.setValue(this.formatEnv(agent.env))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].env =
							this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}
	private generateCustomAgentDisplayName(): string {
		const base = "Custom agent";
		const existing = new Set<string>();
		existing.add(
			this.plugin.settings.claude.displayName ||
				this.plugin.settings.claude.id,
		);
		existing.add(
			this.plugin.settings.gemini.displayName ||
				this.plugin.settings.gemini.id,
		);
		for (const item of this.plugin.settings.customAgents) {
			existing.add(item.displayName || item.id);
		}
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base} ${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base} ${counter}`;
		}
		return candidate;
	}

	// Create a readable ID for new custom agents and avoid collisions
	private generateCustomAgentId(): string {
		const base = "custom-agent";
		const existing = new Set(
			this.plugin.settings.customAgents.map((item) => item.id),
		);
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base}-${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter}`;
		}
		return candidate;
	}

	private formatArgs(args: string[]): string {
		return args.join("\n");
	}

	private parseArgs(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private formatEnv(env: AgentEnvVar[]): string {
		return env
			.map((entry) => `${entry.key}=${entry.value ?? ""}`)
			.join("\n");
	}

	private parseEnv(value: string): AgentEnvVar[] {
		const envVars: AgentEnvVar[] = [];

		for (const line of value.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const delimiter = trimmed.indexOf("=");
			if (delimiter === -1) {
				continue;
			}
			const key = trimmed.slice(0, delimiter).trim();
			const envValue = trimmed.slice(delimiter + 1).trim();
			if (!key) {
				continue;
			}
			envVars.push({ key, value: envValue });
		}

		return normalizeEnvVars(envVars);
	}
}
