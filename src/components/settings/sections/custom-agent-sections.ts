import { Setting } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import type { CustomAgentSettings } from "../../../plugin";
import { formatArgs, parseArgs, formatEnv, parseEnv } from "./agent-sections";
import { renderAgentModelSettings } from "./model-preferences";

const generateCustomAgentDisplayName = (plugin: AgentClientPlugin): string => {
	const base = "Custom agent";
	const existing = new Set<string>();
	existing.add(plugin.settings.claude.displayName || plugin.settings.claude.id);
	existing.add(
		plugin.settings.opencode.displayName || plugin.settings.opencode.id,
	);
	existing.add(plugin.settings.codex.displayName || plugin.settings.codex.id);
	existing.add(plugin.settings.gemini.displayName || plugin.settings.gemini.id);
	for (const item of plugin.settings.customAgents) {
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
};

const generateCustomAgentId = (plugin: AgentClientPlugin): string => {
	const base = "custom-agent";
	const existing = new Set(plugin.settings.customAgents.map((item) => item.id));
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
};

function updateCustomAgent(
	plugin: AgentClientPlugin,
	index: number,
	patch: Partial<CustomAgentSettings>,
): Promise<void> {
	const agents = plugin.settings.customAgents.map((a, i) =>
		i === index ? { ...a, ...patch } : a,
	);
	return plugin.settingsStore.updateSettings({ customAgents: agents });
}

export const renderCustomAgents = (
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	options: {
		onRefreshDropdown: () => void;
		onRedisplay: () => void;
	},
): void => {
	if (plugin.settings.customAgents.length === 0) {
		containerEl.createEl("p", {
			text: "No custom agents configured yet.",
		});
	} else {
		plugin.settings.customAgents.forEach((agent, index) => {
			renderCustomAgent(containerEl, plugin, agent, index, options);
		});
	}

	new Setting(containerEl).addButton((button) => {
		button
			.setButtonText("Add custom agent")
			.setCta()
			.onClick(async () => {
				const newId = generateCustomAgentId(plugin);
				const newDisplayName = generateCustomAgentDisplayName(plugin);
				await plugin.settingsStore.updateSettings({
					customAgents: [
						...plugin.settings.customAgents,
						{
							id: newId,
							displayName: newDisplayName,
							command: "",
							args: [],
							env: [],
							secretBindings: [],
						},
					],
				});
				plugin.ensureDefaultAgentId();
				options.onRedisplay();
			});
	});
};

function renderCustomAgent(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	agent: CustomAgentSettings,
	index: number,
	options: { onRefreshDropdown: () => void; onRedisplay: () => void },
): void {
	const store = plugin.settingsStore;
	let refreshTimer: number | null = null;
	const scheduleCatalogRefresh = (agentId: string, command: string) => {
		const runtimePlugin = plugin as AgentClientPlugin & {
			refreshAgentCatalog?: (
				targetAgentId: string,
				options?: { force?: boolean },
			) => Promise<boolean>;
		};
		if (typeof runtimePlugin.refreshAgentCatalog !== "function") {
			return;
		}
		if (refreshTimer !== null) {
			window.clearTimeout(refreshTimer);
		}
		if (!command.trim()) {
			return;
		}
		refreshTimer = window.setTimeout(() => {
			void runtimePlugin.refreshAgentCatalog?.(agentId, { force: true });
		}, 500);
	};
	const blockEl = containerEl.createDiv({
		cls: "obsius-custom-agent",
	});

	const idSetting = new Setting(blockEl)
		.setName("Agent ID")
		.setDesc("Unique identifier used to reference this agent.")
		.addText((text) => {
			text
				.setPlaceholder("custom-agent") // eslint-disable-line obsidianmd/ui/sentence-case
				.setValue(agent.id)
				.onChange(async (value) => {
					const previousId = plugin.settings.customAgents[index].id;
					const trimmed = value.trim();
					let nextId = trimmed;
					if (nextId.length === 0) {
						nextId = generateCustomAgentId(plugin);
						text.setValue(nextId);
					}
					const updates: Partial<CustomAgentSettings> = { id: nextId };
					const defaultUpdate: Partial<Record<string, unknown>> = {};
					if (plugin.settings.defaultAgentId === previousId) {
						defaultUpdate.defaultAgentId = nextId;
					}
					const agents = plugin.settings.customAgents.map((a, i) =>
						i === index ? { ...a, ...updates } : a,
					);
					await store.updateSettings({
						customAgents: agents,
						...defaultUpdate,
					});
					plugin.ensureDefaultAgentId();
					options.onRefreshDropdown();
				});
		});

	idSetting.addExtraButton((button) => {
		button
			.setIcon("trash")
			.setTooltip("Delete this agent")
			.onClick(async () => {
				const agents = plugin.settings.customAgents.filter(
					(_, i) => i !== index,
				);
				await store.updateSettings({ customAgents: agents });
				plugin.ensureDefaultAgentId();
				options.onRedisplay();
			});
	});

	new Setting(blockEl)
		.setName("Display name")
		.setDesc("Shown in menus and headers.")
		.addText((text) => {
			text
				.setPlaceholder("Custom agent")
				.setValue(agent.displayName || agent.id)
				.onChange(async (value) => {
					const trimmed = value.trim();
					const displayName =
						trimmed.length > 0
							? trimmed
							: plugin.settings.customAgents[index].id;
					await updateCustomAgent(plugin, index, { displayName });
					options.onRefreshDropdown();
				});
		});

	new Setting(blockEl)
		.setName("Command")
		.setDesc("Command name or absolute path to the agent binary.")
		.addText((text) => {
			text
				.setPlaceholder("Command name or path")
				.setValue(agent.command)
				.onChange(async (value) => {
					const command = value.trim();
					await updateCustomAgent(plugin, index, {
						command,
					});
					const currentId = plugin.settings.customAgents[index]?.id ?? agent.id;
					scheduleCatalogRefresh(currentId, command);
				});
		});

	new Setting(blockEl)
		.setName("Arguments")
		.setDesc(
			"Enter one argument per line. Leave empty to run without arguments.",
		)
		.addTextArea((text) => {
			text
				.setPlaceholder("--flag\n--another=value")
				.setValue(formatArgs(agent.args))
				.onChange(async (value) => {
					await updateCustomAgent(plugin, index, {
						args: parseArgs(value),
					});
				});
			text.inputEl.rows = 3;
		});

	new Setting(blockEl)
		.setName("Environment variables")
		.setDesc("Enter KEY=VALUE pairs, one per line. (stored as plain text)") // eslint-disable-line obsidianmd/ui/sentence-case
		.addTextArea((text) => {
			text
				.setPlaceholder("TOKEN=...") // eslint-disable-line obsidianmd/ui/sentence-case
				.setValue(formatEnv(agent.env))
				.onChange(async (value) => {
					await updateCustomAgent(plugin, index, { env: parseEnv(value) });
				});
			text.inputEl.rows = 3;
		});

	renderAgentModelSettings(blockEl, plugin, agent.id);
}
