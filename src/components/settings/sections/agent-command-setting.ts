import { Notice, Setting, type TextComponent } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import {
	BUILTIN_AGENT_DEFAULT_COMMANDS,
	resolveCommandFromShell,
} from "../../../shared/shell-utils";

interface PathSettingOptions {
	agentId: string;
	getValue: () => string;
	setValue: (value: string) => Promise<void>;
}

export function renderPathSettingWithDetect(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	opts: PathSettingOptions,
): void {
	const defaultCommand = BUILTIN_AGENT_DEFAULT_COMMANDS[opts.agentId] ?? "";
	let textRef: TextComponent | null = null;
	let refreshTimer: number | null = null;
	const scheduleCatalogRefresh = (command: string) => {
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
			void runtimePlugin.refreshAgentCatalog?.(opts.agentId, { force: true });
		}, 500);
	};

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
					const next = value.trim();
					await opts.setValue(next);
					scheduleCatalogRefresh(next);
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
							scheduleCatalogRefresh(resolved);
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
