import { Notice, SecretComponent, Setting, type TextComponent } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import type { AgentEnvVar } from "../../../plugin";
import { normalizeEnvVars } from "../../../shared/settings-utils";
import {
	BUILTIN_AGENT_DEFAULT_COMMANDS,
	resolveCommandFromShell,
} from "../../../shared/shell-utils";
import { getBuiltInApiKeySecretId } from "../../../shared/secret-storage";
import { renderAgentSubHeading } from "../settings-ui-helpers";
import { renderAgentModelSettings } from "./model-preferences";

export const formatArgs = (args: string[]): string => args.join("\n");

export const parseArgs = (value: string): string[] =>
	value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

export const formatEnv = (env: AgentEnvVar[]): string =>
	env.map((entry) => `${entry.key}=${entry.value ?? ""}`).join("\n");

export const parseEnv = (value: string): AgentEnvVar[] => {
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
};

export const getAgentOptions = (
	plugin: AgentClientPlugin,
): { id: string; label: string }[] => {
	const toOption = (id: string, displayName: string) => ({
		id,
		label: displayName,
	});

	const options: { id: string; label: string }[] = [
		toOption(
			plugin.settings.opencode.id,
			plugin.settings.opencode.displayName || plugin.settings.opencode.id,
		),
		toOption(
			plugin.settings.claude.id,
			plugin.settings.claude.displayName || plugin.settings.claude.id,
		),
		toOption(
			plugin.settings.codex.id,
			plugin.settings.codex.displayName || plugin.settings.codex.id,
		),
		toOption(
			plugin.settings.gemini.id,
			plugin.settings.gemini.displayName || plugin.settings.gemini.id,
		),
	];

	for (const agent of plugin.settings.customAgents) {
		if (!agent.id || agent.id.length === 0) {
			continue;
		}
		const labelSource =
			agent.displayName && agent.displayName.length > 0
				? agent.displayName
				: agent.id;
		options.push(toOption(agent.id, labelSource));
	}

	const seen = new Set<string>();
	return options.filter(({ id }) => {
		if (seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
};

export const renderBuiltInAgentSettings = (
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
): void => {
	renderOpenCodeSettings(containerEl, plugin);
	renderClaudeSettings(containerEl, plugin);
	renderCodexSettings(containerEl, plugin);
	renderGeminiSettings(containerEl, plugin);
};

function renderGeminiSettings(
	sectionEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	const gemini = plugin.settings.gemini;
	const store = plugin.settingsStore;

	renderAgentSubHeading(sectionEl, gemini.displayName || "Gemini CLI");

	new Setting(sectionEl)
		.setName("API key")
		.setDesc(
			"Gemini API key secret name. Required if not logging in with a Google account. Value is stored in Obsidian secure storage.",
		)
		.addComponent((el) => {
			const secretId = getBuiltInApiKeySecretId(plugin.settings, "gemini");
			return new SecretComponent(plugin.app, el)
				.setValue(secretId)
				.onChange((value) => {
					void store.updateSettings({
						gemini: {
							...plugin.settings.gemini,
							apiKeySecretId: value.trim(),
						},
					});
				});
		});

	renderPathSettingWithDetect(sectionEl, plugin, {
		agentId: gemini.id,
		getValue: () => plugin.settings.gemini.command,
		setValue: async (value) => {
			await store.updateSettings({
				gemini: { ...plugin.settings.gemini, command: value },
			});
		},
	});

	new Setting(sectionEl)
		.setName("Arguments")
		.setDesc(
			'Enter one argument per line. Leave empty to run without arguments. (Currently, the Gemini CLI requires the "--experimental-acp" option.)', // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatArgs(gemini.args))
				.onChange(async (value) => {
					await store.updateSettings({
						gemini: { ...plugin.settings.gemini, args: parseArgs(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	new Setting(sectionEl)
		.setName("Environment variables")
		.setDesc(
			"Enter KEY=VALUE pairs, one per line. Required to authenticate with Vertex AI. GEMINI_API_KEY is derived from the field above.", // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("GOOGLE_CLOUD_PROJECT=...") // eslint-disable-line obsidianmd/ui/sentence-case
				.setValue(formatEnv(gemini.env))
				.onChange(async (value) => {
					await store.updateSettings({
						gemini: { ...plugin.settings.gemini, env: parseEnv(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	renderAgentModelSettings(sectionEl, plugin, gemini.id);
}

function renderClaudeSettings(
	sectionEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	const claude = plugin.settings.claude;
	const store = plugin.settingsStore;

	renderAgentSubHeading(sectionEl, claude.displayName || "Claude Code (ACP)");

	new Setting(sectionEl)
		.setName("API key")
		.setDesc(
			"Anthropic API key secret name. Required if not logging in with an Anthropic account. Value is stored in Obsidian secure storage.",
		)
		.addComponent((el) => {
			const secretId = getBuiltInApiKeySecretId(plugin.settings, "claude");
			return new SecretComponent(plugin.app, el)
				.setValue(secretId)
				.onChange((value) => {
					void store.updateSettings({
						claude: {
							...plugin.settings.claude,
							apiKeySecretId: value.trim(),
						},
					});
				});
		});

	renderPathSettingWithDetect(sectionEl, plugin, {
		agentId: claude.id,
		getValue: () => plugin.settings.claude.command,
		setValue: async (value) => {
			await store.updateSettings({
				claude: { ...plugin.settings.claude, command: value },
			});
		},
	});

	new Setting(sectionEl)
		.setName("Arguments")
		.setDesc(
			"Enter one argument per line. Leave empty to run without arguments.",
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatArgs(claude.args))
				.onChange(async (value) => {
					await store.updateSettings({
						claude: { ...plugin.settings.claude, args: parseArgs(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	new Setting(sectionEl)
		.setName("Environment variables")
		.setDesc(
			"Enter KEY=VALUE pairs, one per line. ANTHROPIC_API_KEY is derived from the field above.", // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatEnv(claude.env))
				.onChange(async (value) => {
					await store.updateSettings({
						claude: { ...plugin.settings.claude, env: parseEnv(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	renderAgentModelSettings(sectionEl, plugin, claude.id);
}

function renderOpenCodeSettings(
	sectionEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	const opencode = plugin.settings.opencode;
	const store = plugin.settingsStore;

	renderAgentSubHeading(sectionEl, opencode.displayName || "OpenCode");

	renderPathSettingWithDetect(sectionEl, plugin, {
		agentId: opencode.id,
		getValue: () => plugin.settings.opencode.command,
		setValue: async (value) => {
			await store.updateSettings({
				opencode: { ...plugin.settings.opencode, command: value },
			});
		},
	});

	new Setting(sectionEl)
		.setName("Arguments")
		.setDesc(
			'Enter one argument per line. Leave empty to run without arguments. (The "acp" argument is required for ACP mode.)', // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatArgs(opencode.args))
				.onChange(async (value) => {
					await store.updateSettings({
						opencode: {
							...plugin.settings.opencode,
							args: parseArgs(value),
						},
					});
				});
			text.inputEl.rows = 3;
		});

	new Setting(sectionEl)
		.setName("Environment variables")
		.setDesc(
			"Enter KEY=VALUE pairs, one per line. (stored as plain text)", // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatEnv(opencode.env))
				.onChange(async (value) => {
					await store.updateSettings({
						opencode: {
							...plugin.settings.opencode,
							env: parseEnv(value),
						},
					});
				});
			text.inputEl.rows = 3;
		});

	renderAgentModelSettings(sectionEl, plugin, opencode.id);
}

function renderCodexSettings(
	sectionEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	const codex = plugin.settings.codex;
	const store = plugin.settingsStore;

	renderAgentSubHeading(sectionEl, codex.displayName || "Codex");

	new Setting(sectionEl)
		.setName("API key")
		.setDesc(
			"OpenAI API key secret name. Required if not logging in with an OpenAI account. Value is stored in Obsidian secure storage.",
		)
		.addComponent((el) => {
			const secretId = getBuiltInApiKeySecretId(plugin.settings, "codex");
			return new SecretComponent(plugin.app, el)
				.setValue(secretId)
				.onChange((value) => {
					void store.updateSettings({
						codex: {
							...plugin.settings.codex,
							apiKeySecretId: value.trim(),
						},
					});
				});
		});

	renderPathSettingWithDetect(sectionEl, plugin, {
		agentId: codex.id,
		getValue: () => plugin.settings.codex.command,
		setValue: async (value) => {
			await store.updateSettings({
				codex: { ...plugin.settings.codex, command: value },
			});
		},
	});

	new Setting(sectionEl)
		.setName("Arguments")
		.setDesc(
			"Enter one argument per line. Leave empty to run without arguments.",
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatArgs(codex.args))
				.onChange(async (value) => {
					await store.updateSettings({
						codex: { ...plugin.settings.codex, args: parseArgs(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	new Setting(sectionEl)
		.setName("Environment variables")
		.setDesc(
			"Enter KEY=VALUE pairs, one per line. OPENAI_API_KEY is derived from the field above.", // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("")
				.setValue(formatEnv(codex.env))
				.onChange(async (value) => {
					await store.updateSettings({
						codex: { ...plugin.settings.codex, env: parseEnv(value) },
					});
				});
			text.inputEl.rows = 3;
		});

	renderAgentModelSettings(sectionEl, plugin, codex.id);
}

function renderPathSettingWithDetect(
	containerEl: HTMLElement,
	_plugin: AgentClientPlugin,
	opts: {
		agentId: string;
		getValue: () => string;
		setValue: (value: string) => Promise<void>;
	},
): void {
	const defaultCommand = BUILTIN_AGENT_DEFAULT_COMMANDS[opts.agentId] ?? "";
	let textRef: TextComponent | null = null;

	const setting = new Setting(containerEl)
		.setName("Command")
		.setDesc(
			defaultCommand
				? `Leave empty to use "${defaultCommand}" from your shell PATH, or enter a custom path.`
				: "Command name or absolute path to the agent binary.",
		)
		.addText((text) => {
			textRef = text;
			text
				.setPlaceholder(defaultCommand || "Command name or path")
				.setValue(opts.getValue())
				.onChange(async (value) => {
					await opts.setValue(value.trim());
				});
		});

	if (defaultCommand) {
		setting.addExtraButton((button) => {
			button
				.setIcon("search")
				.setTooltip("Detect from shell PATH") // eslint-disable-line obsidianmd/ui/sentence-case
				.onClick(async () => {
					button.setDisabled(true);
					try {
						const resolved = await resolveCommandFromShell(defaultCommand);
						if (resolved) {
							textRef?.setValue(resolved);
							await opts.setValue(resolved);
							new Notice(`Found: ${resolved}`);
						} else {
							new Notice(`"${defaultCommand}" not found in shell PATH.`);
						}
					} finally {
						button.setDisabled(false);
					}
				});
		});
	}
}
