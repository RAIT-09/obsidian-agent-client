import {
	App,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	Platform,
} from "obsidian";
import type AgentClientPlugin from "../../plugin";
import type {
	CustomAgentSettings,
	AgentEnvVar,
	ChatViewLocation,
} from "../../plugin";
import { normalizeEnvVars } from "../../shared/settings-utils";

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.agentSelector = null;

		// Cleanup previous subscription if exists
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		// Documentation link
		const docContainer = containerEl.createDiv({
			cls: "agent-client-doc-link",
		});
		docContainer.createSpan({ text: "Need help? Check out the " });
		docContainer.createEl("a", {
			text: "documentation",
			href: "https://rait-09.github.io/obsidian-agent-client/",
		});
		docContainer.createSpan({ text: "." });

		// ─────────────────────────────────────────────────────────────────────
		// Top-level settings (no header)
		// ─────────────────────────────────────────────────────────────────────

		this.renderAgentSelector(containerEl);

		// Subscribe to settings changes to update agent dropdown
		this.unsubscribe = this.plugin.settingsStore.subscribe(() => {
			this.updateAgentDropdown();
		});

		// Also update immediately on display to sync with current settings
		this.updateAgentDropdown();

		new Setting(containerEl)
			.setName("Node.js path")
			.setDesc(
				'Absolute path to Node.js executable. On macOS/Linux, use "which node", and on Windows, use "where node" to find it.',
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to node")
					.setValue(this.plugin.settings.nodePath)
					.onChange(async (value) => {
						this.plugin.settings.nodePath = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Send message shortcut")
			.setDesc(
				"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						"Enter to send, Shift+Enter for newline",
					)
					.addOption(
						"cmd-enter",
						"Cmd/Ctrl+Enter to send, Enter for newline",
					)
					.setValue(this.plugin.settings.sendMessageShortcut)
					.onChange(async (value) => {
						this.plugin.settings.sendMessageShortcut = value as
							| "enter"
							| "cmd-enter";
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Mentions
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Mentions").setHeading();

		new Setting(containerEl)
			.setName("Auto-mention active note")
			.setDesc(
				"Include the current note in your messages automatically. The agent will have access to its content without typing @notename.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoMentionActiveNote)
					.onChange(async (value) => {
						this.plugin.settings.autoMentionActiveNote = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max note length")
			.setDesc(
				"Maximum characters per mentioned note. Notes longer than this will be truncated.",
			)
			.addText((text) =>
				text
					.setPlaceholder("10000")
					.setValue(
						String(
							this.plugin.settings.displaySettings.maxNoteLength,
						),
					)
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.displaySettings.maxNoteLength =
								num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Max selection length")
			.setDesc(
				"Maximum characters for text selection in auto-mention. Selections longer than this will be truncated.",
			)
			.addText((text) =>
				text
					.setPlaceholder("10000")
					.setValue(
						String(
							this.plugin.settings.displaySettings
								.maxSelectionLength,
						),
					)
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.displaySettings.maxSelectionLength =
								num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Display
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("Chat view location")
			.setDesc("Where to open new chat views")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("right-tab", "Right pane (tabs)")
					.addOption("editor-tab", "Editor area (tabs)")
					.addOption("editor-split", "Editor area (split)")
					.setValue(this.plugin.settings.chatViewLocation)
					.onChange(async (value) => {
						this.plugin.settings.chatViewLocation =
							value as ChatViewLocation;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show emojis")
			.setDesc(
				"Display emoji icons in tool calls, thoughts, plans, and terminal blocks.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.displaySettings.showEmojis)
					.onChange(async (value) => {
						this.plugin.settings.displaySettings.showEmojis = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-collapse long diffs")
			.setDesc(
				"Automatically collapse diffs that exceed the line threshold.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.displaySettings.autoCollapseDiffs,
					)
					.onChange(async (value) => {
						this.plugin.settings.displaySettings.autoCollapseDiffs =
							value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.displaySettings.autoCollapseDiffs) {
			new Setting(containerEl)
				.setName("Collapse threshold")
				.setDesc(
					"Diffs with more lines than this will be collapsed by default.",
				)
				.addText((text) =>
					text
						.setPlaceholder("10")
						.setValue(
							String(
								this.plugin.settings.displaySettings
									.diffCollapseThreshold,
							),
						)
						.onChange(async (value) => {
							const num = parseInt(value, 10);
							if (!isNaN(num) && num > 0) {
								this.plugin.settings.displaySettings.diffCollapseThreshold =
									num;
								await this.plugin.saveSettings();
							}
						}),
				);
		}

		// ─────────────────────────────────────────────────────────────────────
		// Permissions
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Permissions").setHeading();

		new Setting(containerEl)
			.setName("Auto-allow permissions")
			.setDesc(
				"Automatically allow all permission requests from agents. ⚠️ Use with caution - this gives agents full access to your system.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAllowPermissions)
					.onChange(async (value) => {
						this.plugin.settings.autoAllowPermissions = value;
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Windows WSL Settings (Windows only)
		// ─────────────────────────────────────────────────────────────────────

		if (Platform.isWin) {
			new Setting(containerEl)
				.setName("Windows Subsystem for Linux")
				.setHeading();

			new Setting(containerEl)
				.setName("Enable WSL mode")
				.setDesc(
					"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.windowsWslMode)
						.onChange(async (value) => {
							this.plugin.settings.windowsWslMode = value;
							await this.plugin.saveSettings();
							this.display(); // Refresh to show/hide distribution setting
						}),
				);

			if (this.plugin.settings.windowsWslMode) {
				new Setting(containerEl)
					.setName("WSL distribution")
					.setDesc(
						"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
					)
					.addText((text) =>
						text
							.setPlaceholder("Leave empty for default")
							.setValue(
								this.plugin.settings.windowsWslDistribution ||
									"",
							)
							.onChange(async (value) => {
								this.plugin.settings.windowsWslDistribution =
									value.trim() || undefined;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// Agents
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Built-in agents").setHeading();

		this.renderClaudeSettings(containerEl);
		this.renderCodexSettings(containerEl);
		this.renderGeminiSettings(containerEl);

		new Setting(containerEl).setName("Custom agents").setHeading();

		this.renderCustomAgents(containerEl);

		// ─────────────────────────────────────────────────────────────────────
		// Export
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Export").setHeading();

		new Setting(containerEl)
			.setName("Export folder")
			.setDesc("Folder where chat exports will be saved")
			.addText((text) =>
				text
					.setPlaceholder("Agent Client")
					.setValue(this.plugin.settings.exportSettings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.defaultFolder =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Filename")
			.setDesc(
				"Template for exported filenames. Use {date} for date and {time} for time",
			)
			.addText((text) =>
				text
					.setPlaceholder("agent_client_{date}_{time}")
					.setValue(
						this.plugin.settings.exportSettings.filenameTemplate,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.filenameTemplate =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Frontmatter tag")
			.setDesc(
				"Tag to add to exported notes. Supports nested tags (e.g., projects/agent-client). Leave empty to disable.",
			)
			.addText((text) =>
				text
					.setPlaceholder("agent-client")
					.setValue(
						this.plugin.settings.exportSettings.frontmatterTag,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.frontmatterTag =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Include images")
			.setDesc("Include images in exported markdown files")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.exportSettings.includeImages)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.includeImages =
							value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.exportSettings.includeImages) {
			new Setting(containerEl)
				.setName("Image location")
				.setDesc("Where to save exported images")
				.addDropdown((dropdown) =>
					dropdown
						.addOption(
							"obsidian",
							"Use Obsidian's attachment setting",
						)
						.addOption("custom", "Save to custom folder")
						.addOption(
							"base64",
							"Embed as Base64 (not recommended)",
						)
						.setValue(
							this.plugin.settings.exportSettings.imageLocation,
						)
						.onChange(async (value) => {
							this.plugin.settings.exportSettings.imageLocation =
								value as "obsidian" | "custom" | "base64";
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			if (
				this.plugin.settings.exportSettings.imageLocation === "custom"
			) {
				new Setting(containerEl)
					.setName("Custom image folder")
					.setDesc(
						"Folder path for exported images (relative to vault root)",
					)
					.addText((text) =>
						text
							.setPlaceholder("Agent Client")
							.setValue(
								this.plugin.settings.exportSettings
									.imageCustomFolder,
							)
							.onChange(async (value) => {
								this.plugin.settings.exportSettings.imageCustomFolder =
									value;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		new Setting(containerEl)
			.setName("Auto-export on new chat")
			.setDesc(
				"Automatically export the current chat when starting a new chat",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.autoExportOnNewChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnNewChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-export on close chat")
			.setDesc(
				"Automatically export the current chat when closing the chat view",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings
							.autoExportOnCloseChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnCloseChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open note after export")
			.setDesc("Automatically open the exported note after exporting")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.openFileAfterExport,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.openFileAfterExport =
							value;
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Developer
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName("Developer").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc(
				"Enable debug logging to console. Useful for development and troubleshooting.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	/**
	 * Update the agent dropdown when settings change.
	 * Only updates if the value is different to avoid infinite loops.
	 */
	private updateAgentDropdown(): void {
		if (!this.agentSelector) {
			return;
		}

		// Get latest settings from store snapshot
		const settings = this.plugin.settingsStore.getSnapshot();
		const currentValue = this.agentSelector.getValue();

		// Only update if different to avoid triggering onChange
		if (settings.defaultAgentId !== currentValue) {
			this.agentSelector.setValue(settings.defaultAgentId);
		}
	}

	/**
	 * Called when the settings tab is hidden.
	 * Clean up subscriptions to prevent memory leaks.
	 */
	hide(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	private renderAgentSelector(containerEl: HTMLElement) {
		this.plugin.ensureDefaultAgentId();

		new Setting(containerEl)
			.setName("Default agent")
			.setDesc("Choose which agent is used when opening a new chat view.")
			.addDropdown((dropdown) => {
				this.agentSelector = dropdown;
				this.populateAgentDropdown(dropdown);
				dropdown.setValue(this.plugin.settings.defaultAgentId);
				dropdown.onChange(async (value) => {
					const nextSettings = {
						...this.plugin.settings,
						defaultAgentId: value,
					};
					this.plugin.ensureDefaultAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
				});
			});
	}

	private populateAgentDropdown(dropdown: DropdownComponent) {
		dropdown.selectEl.empty();
		for (const option of this.getAgentOptions()) {
			dropdown.addOption(option.id, option.label);
		}
	}

	private refreshAgentDropdown() {
		if (!this.agentSelector) {
			return;
		}
		this.populateAgentDropdown(this.agentSelector);
		this.agentSelector.setValue(this.plugin.settings.defaultAgentId);
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
				this.plugin.settings.codex.id,
				this.plugin.settings.codex.displayName ||
					this.plugin.settings.codex.id,
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

		new Setting(sectionEl)
			.setName(gemini.displayName || "Gemini CLI")
			.setHeading();

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"Gemini API key. Required if not logging in with a Google account. (Stored as plain text)",
			)
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
			.setName("Path")
			.setDesc(
				'Absolute path to the Gemini CLI. On macOS/Linux, use "which gemini", and on Windows, use "where gemini" to find it.',
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to gemini")
					.setValue(gemini.command)
					.onChange(async (value) => {
						this.plugin.settings.gemini.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				'Enter one argument per line. Leave empty to run without arguments.(Currently, the Gemini CLI requires the "--experimental-acp" option.)',
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
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
				"Enter KEY=VALUE pairs, one per line. Required to authenticate with Vertex AI. GEMINI_API_KEY is derived from the field above.(Stored as plain text)",
			)
			.addTextArea((text) => {
				text.setPlaceholder("GOOGLE_CLOUD_PROJECT=...")
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

		new Setting(sectionEl)
			.setName(claude.displayName || "Claude Code (ACP)")
			.setHeading();

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"Anthropic API key. Required if not logging in with an Anthropic account. (Stored as plain text)",
			)
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
			.setName("Path")
			.setDesc(
				'Absolute path to the claude-code-acp. On macOS/Linux, use "which claude-code-acp", and on Windows, use "where claude-code-acp" to find it.',
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to claude-code-acp")
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
				text.setPlaceholder("")
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
				text.setPlaceholder("")
					.setValue(this.formatEnv(claude.env))
					.onChange(async (value) => {
						this.plugin.settings.claude.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderCodexSettings(sectionEl: HTMLElement) {
		const codex = this.plugin.settings.codex;

		new Setting(sectionEl)
			.setName(codex.displayName || "Codex")
			.setHeading();

		new Setting(sectionEl)
			.setName("API key")
			.setDesc(
				"OpenAI API key. Required if not logging in with an OpenAI account. (Stored as plain text)",
			)
			.addText((text) => {
				text.setPlaceholder("Enter your OpenAI API key")
					.setValue(codex.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.codex.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName("Path")
			.setDesc(
				'Absolute path to the codex-acp. On macOS/Linux, use "which codex-acp", and on Windows, use "where codex-acp" to find it.',
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to codex-acp")
					.setValue(codex.command)
					.onChange(async (value) => {
						this.plugin.settings.codex.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatArgs(codex.args))
					.onChange(async (value) => {
						this.plugin.settings.codex.args = this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(sectionEl)
			.setName("Environment variables")
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. OPENAI_API_KEY is derived from the field above.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("")
					.setValue(this.formatEnv(codex.env))
					.onChange(async (value) => {
						this.plugin.settings.codex.env = this.parseEnv(value);
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
					this.plugin.ensureDefaultAgentId();
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
						if (
							this.plugin.settings.defaultAgentId === previousId
						) {
							this.plugin.settings.defaultAgentId = nextId;
						}
						this.plugin.ensureDefaultAgentId();
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
					this.plugin.ensureDefaultAgentId();
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

		new Setting(blockEl)
			.setName("Path")
			.setDesc("Absolute path to the custom agent.")
			.addText((text) => {
				text.setPlaceholder("Absolute path to custom agent")
					.setValue(agent.command)
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].command =
							value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(blockEl)
			.setName("Arguments")
			.setDesc(
				"Enter one argument per line. Leave empty to run without arguments.",
			)
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
			.setDesc(
				"Enter KEY=VALUE pairs, one per line. (Stored as plain text)",
			)
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
			this.plugin.settings.codex.displayName ||
				this.plugin.settings.codex.id,
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
