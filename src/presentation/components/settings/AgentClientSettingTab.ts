import {
	App,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	Platform,
	Notice,
	setIcon,
} from "obsidian";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type {
	CustomAgentSettings,
	AgentEnvVar,
} from "../../../infrastructure/obsidian-plugin/plugin";
import { normalizeEnvVars } from "../../../shared/settings-utils";

/**
 * Agent status for visual indicators
 */
type AgentStatus = "ready" | "missing-path" | "missing-api-key" | "incomplete";

/**
 * Agent configuration export format
 */
interface AgentConfigExport {
	version: string;
	exportedAt: string;
	agents: CustomAgentSettings[];
}

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;
	private draggedIndex: number | null = null;

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

		// Quick Switch Agent Selector with visual preview
		this.renderQuickSwitchSelector(containerEl);

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
			.setName("Auto-allow permissions")
			.setDesc(
				"Automatically allow all permission requests from agents. Use with caution - this gives agents full access to your system.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAllowPermissions)
					.onChange(async (value) => {
						this.plugin.settings.autoAllowPermissions = value;
						await this.plugin.saveSettings();
					}),
			);

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

		// Windows WSL Settings (Windows only)
		if (Platform.isWin) {
			new Setting(containerEl).setName("Windows WSL").setHeading();

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

		new Setting(containerEl).setName("Built-in agents").setHeading();

		this.renderClaudeSettings(containerEl);
		this.renderCodexSettings(containerEl);
		this.renderGeminiSettings(containerEl);

		new Setting(containerEl).setName("Custom agents").setHeading();

		this.renderCustomAgentsSection(containerEl);

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
		if (settings.activeAgentId !== currentValue) {
			this.agentSelector.setValue(settings.activeAgentId);
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

	/**
	 * Quick switch agent selector with visual preview cards
	 */
	private renderQuickSwitchSelector(containerEl: HTMLElement): void {
		this.plugin.ensureActiveAgentId();

		// Create a container for the quick switch section
		const quickSwitchContainer = containerEl.createDiv({
			cls: "agent-quick-switch-container",
		});

		// Section header
		quickSwitchContainer.createEl("h3", {
			text: "Active Agent",
			cls: "agent-quick-switch-title",
		});

		// Agent cards grid
		const agentCardsGrid = quickSwitchContainer.createDiv({
			cls: "agent-cards-grid",
		});

		const agents = this.getAllAgentsWithStatus();

		for (const agent of agents) {
			this.renderAgentCard(agentCardsGrid, agent);
		}

		// Hidden dropdown for form compatibility
		new Setting(quickSwitchContainer)
			.setName("Active agent")
			.setDesc("Choose which agent handles new chat sessions.")
			.setClass("agent-selector-hidden")
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
					this.display(); // Refresh to update card selection
				});
			});
	}

	/**
	 * Render an individual agent card
	 */
	private renderAgentCard(
		containerEl: HTMLElement,
		agent: {
			id: string;
			displayName: string;
			status: AgentStatus;
			isBuiltIn: boolean;
		},
	): void {
		const isActive = this.plugin.settings.activeAgentId === agent.id;
		const cardEl = containerEl.createDiv({
			cls: `agent-card ${isActive ? "agent-card-active" : ""} agent-status-${agent.status}`,
		});

		cardEl.setAttribute("role", "button");
		cardEl.setAttribute("tabindex", "0");
		cardEl.setAttribute(
			"aria-label",
			`Select ${agent.displayName} as active agent`,
		);
		cardEl.setAttribute("aria-pressed", isActive ? "true" : "false");

		// Status indicator
		const statusIndicator = cardEl.createDiv({
			cls: "agent-card-status-indicator",
		});
		this.setStatusIcon(statusIndicator, agent.status);

		// Agent info
		const infoEl = cardEl.createDiv({ cls: "agent-card-info" });
		infoEl.createDiv({ text: agent.displayName, cls: "agent-card-name" });
		infoEl.createDiv({
			text: agent.isBuiltIn ? "Built-in" : "Custom",
			cls: "agent-card-type",
		});

		// Status text
		const statusText = this.getStatusText(agent.status);
		if (statusText) {
			infoEl.createDiv({ text: statusText, cls: "agent-card-status-text" });
		}

		// Click handler
		cardEl.addEventListener("click", async () => {
			if (this.plugin.settings.activeAgentId !== agent.id) {
				const nextSettings = {
					...this.plugin.settings,
					activeAgentId: agent.id,
				};
				this.plugin.ensureActiveAgentId();
				await this.plugin.saveSettingsAndNotify(nextSettings);
				this.display();
			}
		});

		// Keyboard handler
		cardEl.addEventListener("keydown", async (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (this.plugin.settings.activeAgentId !== agent.id) {
					const nextSettings = {
						...this.plugin.settings,
						activeAgentId: agent.id,
					};
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
					this.display();
				}
			}
		});
	}

	/**
	 * Set the appropriate icon for agent status
	 */
	private setStatusIcon(el: HTMLElement, status: AgentStatus): void {
		switch (status) {
			case "ready":
				setIcon(el, "check-circle");
				el.addClass("status-ready");
				break;
			case "missing-api-key":
				setIcon(el, "key");
				el.addClass("status-warning");
				break;
			case "missing-path":
				setIcon(el, "alert-triangle");
				el.addClass("status-error");
				break;
			case "incomplete":
				setIcon(el, "circle-dot");
				el.addClass("status-incomplete");
				break;
		}
	}

	/**
	 * Get status text for display
	 */
	private getStatusText(status: AgentStatus): string {
		switch (status) {
			case "ready":
				return "";
			case "missing-api-key":
				return "API key not set";
			case "missing-path":
				return "Path not configured";
			case "incomplete":
				return "Configuration incomplete";
		}
	}

	/**
	 * Get all agents with their status
	 */
	private getAllAgentsWithStatus(): Array<{
		id: string;
		displayName: string;
		status: AgentStatus;
		isBuiltIn: boolean;
	}> {
		const agents: Array<{
			id: string;
			displayName: string;
			status: AgentStatus;
			isBuiltIn: boolean;
		}> = [];

		// Built-in agents
		agents.push({
			id: this.plugin.settings.claude.id,
			displayName:
				this.plugin.settings.claude.displayName ||
				this.plugin.settings.claude.id,
			status: this.getAgentStatus(
				this.plugin.settings.claude.command,
				this.plugin.settings.claude.apiKey,
			),
			isBuiltIn: true,
		});

		agents.push({
			id: this.plugin.settings.codex.id,
			displayName:
				this.plugin.settings.codex.displayName ||
				this.plugin.settings.codex.id,
			status: this.getAgentStatus(
				this.plugin.settings.codex.command,
				this.plugin.settings.codex.apiKey,
			),
			isBuiltIn: true,
		});

		agents.push({
			id: this.plugin.settings.gemini.id,
			displayName:
				this.plugin.settings.gemini.displayName ||
				this.plugin.settings.gemini.id,
			status: this.getAgentStatus(
				this.plugin.settings.gemini.command,
				this.plugin.settings.gemini.apiKey,
			),
			isBuiltIn: true,
		});

		// Custom agents
		for (const agent of this.plugin.settings.customAgents) {
			agents.push({
				id: agent.id,
				displayName: agent.displayName || agent.id,
				status: this.getCustomAgentStatus(agent),
				isBuiltIn: false,
			});
		}

		return agents;
	}

	/**
	 * Determine agent status based on configuration
	 */
	private getAgentStatus(command: string, apiKey?: string): AgentStatus {
		if (!command || command.trim().length === 0) {
			return "missing-path";
		}
		// API key is optional for built-in agents (can use account login)
		if (apiKey !== undefined && apiKey.trim().length === 0) {
			return "missing-api-key";
		}
		return "ready";
	}

	/**
	 * Determine custom agent status
	 */
	private getCustomAgentStatus(agent: CustomAgentSettings): AgentStatus {
		if (!agent.command || agent.command.trim().length === 0) {
			return "missing-path";
		}
		if (!agent.id || agent.id.trim().length === 0) {
			return "incomplete";
		}
		return "ready";
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
		const status = this.getAgentStatus(gemini.command, gemini.apiKey);

		const blockEl = sectionEl.createDiv({
			cls: "agent-client-builtin-agent",
		});

		// Header with status
		const headerEl = blockEl.createDiv({ cls: "agent-header-with-status" });
		headerEl.createEl("h4", {
			text: gemini.displayName || "Gemini CLI",
			cls: "agent-header-title",
		});
		const statusBadge = headerEl.createDiv({ cls: "agent-status-badge" });
		this.setStatusIcon(statusBadge, status);
		statusBadge.createSpan({ text: this.getStatusBadgeText(status) });

		new Setting(blockEl)
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

		new Setting(blockEl)
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

		new Setting(blockEl)
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

		// Environment variables with key-value UI
		this.renderEnvVarsEditor(
			blockEl,
			gemini.env,
			"GOOGLE_CLOUD_PROJECT=...",
			async (envVars) => {
				this.plugin.settings.gemini.env = envVars;
				await this.plugin.saveSettings();
			},
			"GEMINI_API_KEY is derived from the API key field above.",
		);
	}

	private renderClaudeSettings(sectionEl: HTMLElement) {
		const claude = this.plugin.settings.claude;
		const status = this.getAgentStatus(claude.command, claude.apiKey);

		const blockEl = sectionEl.createDiv({
			cls: "agent-client-builtin-agent",
		});

		// Header with status
		const headerEl = blockEl.createDiv({ cls: "agent-header-with-status" });
		headerEl.createEl("h4", {
			text: claude.displayName || "Claude Code (ACP)",
			cls: "agent-header-title",
		});
		const statusBadge = headerEl.createDiv({ cls: "agent-status-badge" });
		this.setStatusIcon(statusBadge, status);
		statusBadge.createSpan({ text: this.getStatusBadgeText(status) });

		new Setting(blockEl)
			.setName("API key")
			.setDesc(
				"Anthropic API key. Required if not logging in with a Anthropic account. (Stored as plain text)",
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

		new Setting(blockEl)
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

		new Setting(blockEl)
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

		// Environment variables with key-value UI
		this.renderEnvVarsEditor(
			blockEl,
			claude.env,
			"",
			async (envVars) => {
				this.plugin.settings.claude.env = envVars;
				await this.plugin.saveSettings();
			},
			"ANTHROPIC_API_KEY is derived from the API key field above.",
		);
	}

	private renderCodexSettings(sectionEl: HTMLElement) {
		const codex = this.plugin.settings.codex;
		const status = this.getAgentStatus(codex.command, codex.apiKey);

		const blockEl = sectionEl.createDiv({
			cls: "agent-client-builtin-agent",
		});

		// Header with status
		const headerEl = blockEl.createDiv({ cls: "agent-header-with-status" });
		headerEl.createEl("h4", {
			text: codex.displayName || "Codex",
			cls: "agent-header-title",
		});
		const statusBadge = headerEl.createDiv({ cls: "agent-status-badge" });
		this.setStatusIcon(statusBadge, status);
		statusBadge.createSpan({ text: this.getStatusBadgeText(status) });

		new Setting(blockEl)
			.setName("API key")
			.setDesc(
				"OpenAI API key. Required if not logging in with a OpenAI account. (Stored as plain text)",
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

		new Setting(blockEl)
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

		new Setting(blockEl)
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

		// Environment variables with key-value UI
		this.renderEnvVarsEditor(
			blockEl,
			codex.env,
			"",
			async (envVars) => {
				this.plugin.settings.codex.env = envVars;
				await this.plugin.saveSettings();
			},
			"OPENAI_API_KEY is derived from the API key field above.",
		);
	}

	/**
	 * Get badge text for status
	 */
	private getStatusBadgeText(status: AgentStatus): string {
		switch (status) {
			case "ready":
				return "Ready";
			case "missing-api-key":
				return "API key missing";
			case "missing-path":
				return "Path missing";
			case "incomplete":
				return "Incomplete";
		}
	}

	/**
	 * Render custom agents section with import/export and drag-and-drop
	 */
	private renderCustomAgentsSection(containerEl: HTMLElement): void {
		// Import/Export buttons
		const actionsEl = containerEl.createDiv({
			cls: "custom-agents-actions",
		});

		new Setting(actionsEl)
			.setName("Agent configuration")
			.setDesc("Import or export custom agent configurations")
			.addButton((button) => {
				button
					.setButtonText("Import")
					.setTooltip("Import agents from JSON file")
					.onClick(() => this.importAgentConfig());
			})
			.addButton((button) => {
				button
					.setButtonText("Export")
					.setTooltip("Export agents to JSON file")
					.onClick(() => this.exportAgentConfig());
			});

		// Custom agents list
		const agentsListEl = containerEl.createDiv({
			cls: "custom-agents-list",
		});

		if (this.plugin.settings.customAgents.length === 0) {
			agentsListEl.createEl("p", {
				text: "No custom agents configured yet. Add one below or import from a JSON file.",
				cls: "custom-agents-empty",
			});
		} else {
			this.plugin.settings.customAgents.forEach((agent, index) => {
				this.renderCustomAgent(agentsListEl, agent, index);
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
		const status = this.getCustomAgentStatus(agent);
		const blockEl = containerEl.createDiv({
			cls: "agent-client-custom-agent",
			attr: {
				draggable: "true",
				"data-index": String(index),
			},
		});

		// Drag and drop handlers
		blockEl.addEventListener("dragstart", (e) => {
			this.draggedIndex = index;
			blockEl.addClass("dragging");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", String(index));
			}
		});

		blockEl.addEventListener("dragend", () => {
			this.draggedIndex = null;
			blockEl.removeClass("dragging");
			// Remove all drag-over classes
			containerEl
				.querySelectorAll(".drag-over")
				.forEach((el) => el.removeClass("drag-over"));
		});

		blockEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (this.draggedIndex !== null && this.draggedIndex !== index) {
				blockEl.addClass("drag-over");
			}
		});

		blockEl.addEventListener("dragleave", () => {
			blockEl.removeClass("drag-over");
		});

		blockEl.addEventListener("drop", async (e) => {
			e.preventDefault();
			blockEl.removeClass("drag-over");
			if (this.draggedIndex !== null && this.draggedIndex !== index) {
				await this.reorderAgents(this.draggedIndex, index);
			}
		});

		// Header with drag handle and status
		const headerEl = blockEl.createDiv({ cls: "custom-agent-header" });

		// Drag handle
		const dragHandle = headerEl.createDiv({ cls: "drag-handle" });
		setIcon(dragHandle, "grip-vertical");
		dragHandle.setAttribute("aria-label", "Drag to reorder");

		// Status indicator
		const statusIndicator = headerEl.createDiv({
			cls: "custom-agent-status-indicator",
		});
		this.setStatusIcon(statusIndicator, status);

		// Agent title
		headerEl.createSpan({
			text: agent.displayName || agent.id || "New Agent",
			cls: "custom-agent-title",
		});

		// Delete button
		const deleteBtn = headerEl.createEl("button", {
			cls: "custom-agent-delete-btn",
			attr: { "aria-label": "Delete this agent" },
		});
		setIcon(deleteBtn, "trash-2");
		deleteBtn.addEventListener("click", async () => {
			this.plugin.settings.customAgents.splice(index, 1);
			this.plugin.ensureActiveAgentId();
			await this.plugin.saveSettings();
			this.display();
		});

		// Collapsible content
		const contentEl = blockEl.createDiv({ cls: "custom-agent-content" });

		const idSetting = new Setting(contentEl)
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

		new Setting(contentEl)
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

		new Setting(contentEl)
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

		new Setting(contentEl)
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

		// Environment variables with key-value UI
		this.renderEnvVarsEditor(
			contentEl,
			agent.env,
			"TOKEN=...",
			async (envVars) => {
				this.plugin.settings.customAgents[index].env = envVars;
				await this.plugin.saveSettings();
			},
		);
	}

	/**
	 * Render environment variables editor with key-value pairs
	 */
	private renderEnvVarsEditor(
		containerEl: HTMLElement,
		envVars: AgentEnvVar[],
		placeholder: string,
		onChange: (envVars: AgentEnvVar[]) => Promise<void>,
		description?: string,
	): void {
		const envSection = containerEl.createDiv({ cls: "env-vars-section" });

		const headerEl = envSection.createDiv({ cls: "env-vars-header" });
		headerEl.createSpan({
			text: "Environment variables",
			cls: "env-vars-title",
		});

		if (description) {
			envSection.createDiv({
				text: description,
				cls: "env-vars-description",
			});
		}

		const listEl = envSection.createDiv({ cls: "env-vars-list" });

		// Render existing env vars
		envVars.forEach((envVar, idx) => {
			this.renderEnvVarRow(listEl, envVar, idx, envVars, onChange);
		});

		// Add button
		const addBtnEl = envSection.createDiv({ cls: "env-vars-add" });
		const addBtn = addBtnEl.createEl("button", {
			text: "Add variable",
			cls: "env-vars-add-btn",
		});
		setIcon(addBtn, "plus");
		addBtn.prepend(addBtn.querySelector("svg") as SVGSVGElement);
		addBtn.addEventListener("click", async () => {
			envVars.push({ key: "", value: "" });
			await onChange(envVars);
			this.display();
		});
	}

	/**
	 * Render a single environment variable row
	 */
	private renderEnvVarRow(
		containerEl: HTMLElement,
		envVar: AgentEnvVar,
		index: number,
		envVars: AgentEnvVar[],
		onChange: (envVars: AgentEnvVar[]) => Promise<void>,
	): void {
		const rowEl = containerEl.createDiv({ cls: "env-var-row" });

		// Key input
		const keyInput = rowEl.createEl("input", {
			cls: "env-var-key",
			attr: {
				type: "text",
				placeholder: "KEY",
				value: envVar.key,
				"aria-label": "Environment variable name",
			},
		});
		keyInput.addEventListener("change", async (e) => {
			const target = e.target as HTMLInputElement;
			envVars[index].key = target.value.trim();
			await onChange(normalizeEnvVars(envVars));
		});

		// Equals sign
		rowEl.createSpan({ text: "=", cls: "env-var-equals" });

		// Value input
		const valueInput = rowEl.createEl("input", {
			cls: "env-var-value",
			attr: {
				type: "text",
				placeholder: "value",
				value: envVar.value,
				"aria-label": "Environment variable value",
			},
		});
		valueInput.addEventListener("change", async (e) => {
			const target = e.target as HTMLInputElement;
			envVars[index].value = target.value;
			await onChange(normalizeEnvVars(envVars));
		});

		// Delete button
		const deleteBtn = rowEl.createEl("button", {
			cls: "env-var-delete",
			attr: { "aria-label": "Remove this variable" },
		});
		setIcon(deleteBtn, "x");
		deleteBtn.addEventListener("click", async () => {
			envVars.splice(index, 1);
			await onChange(normalizeEnvVars(envVars));
			this.display();
		});
	}

	/**
	 * Reorder agents via drag and drop
	 */
	private async reorderAgents(
		fromIndex: number,
		toIndex: number,
	): Promise<void> {
		const agents = [...this.plugin.settings.customAgents];
		const [removed] = agents.splice(fromIndex, 1);
		agents.splice(toIndex, 0, removed);
		this.plugin.settings.customAgents = agents;
		await this.plugin.saveSettings();
		this.display();
	}

	/**
	 * Export agent configurations to JSON
	 */
	private exportAgentConfig(): void {
		if (this.plugin.settings.customAgents.length === 0) {
			new Notice("No custom agents to export");
			return;
		}

		const exportData: AgentConfigExport = {
			version: "1.0",
			exportedAt: new Date().toISOString(),
			agents: this.plugin.settings.customAgents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName,
				command: agent.command,
				args: [...agent.args],
				env: agent.env.map((e) => ({ key: e.key, value: e.value })),
			})),
		};

		const jsonStr = JSON.stringify(exportData, null, 2);
		const blob = new Blob([jsonStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);

		const a = document.createElement("a");
		a.href = url;
		a.download = `agent-client-config-${new Date().toISOString().slice(0, 10)}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		new Notice(
			`Exported ${this.plugin.settings.customAgents.length} agent(s)`,
		);
	}

	/**
	 * Import agent configurations from JSON
	 */
	private importAgentConfig(): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";

		input.addEventListener("change", async (e) => {
			const target = e.target as HTMLInputElement;
			const file = target.files?.[0];
			if (!file) return;

			try {
				const text = await file.text();
				const data = JSON.parse(text) as AgentConfigExport;

				if (!data.agents || !Array.isArray(data.agents)) {
					throw new Error("Invalid format: missing agents array");
				}

				let importedCount = 0;
				const existingIds = new Set(
					this.plugin.settings.customAgents.map((a) => a.id),
				);

				for (const agent of data.agents) {
					if (!agent.id || !agent.command) {
						continue;
					}

					// Generate unique ID if collision
					let newId = agent.id;
					let counter = 2;
					while (existingIds.has(newId)) {
						newId = `${agent.id}-${counter}`;
						counter++;
					}

					this.plugin.settings.customAgents.push({
						id: newId,
						displayName: agent.displayName || newId,
						command: agent.command,
						args: Array.isArray(agent.args) ? agent.args : [],
						env: Array.isArray(agent.env)
							? agent.env.filter((e) => e.key && e.key.length > 0)
							: [],
					});

					existingIds.add(newId);
					importedCount++;
				}

				if (importedCount > 0) {
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
					new Notice(`Imported ${importedCount} agent(s)`);
				} else {
					new Notice("No valid agents found in file");
				}
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Unknown error";
				new Notice(`Import failed: ${message}`);
			}
		});

		input.click();
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
