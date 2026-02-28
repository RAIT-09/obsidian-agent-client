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
import {
	CHAT_FONT_SIZE_MAX,
	CHAT_FONT_SIZE_MIN,
	parseChatFontSize,
} from "../../shared/display-settings";
import { getUiLanguage } from "../../shared/i18n";

export class AgentClientSettingTab extends PluginSettingTab {
	plugin: AgentClientPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: AgentClientPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private uiText(en: string, zh: string): string {
		return getUiLanguage(this.app) === "zh" ? zh : en;
	}

	display(): void {
		const { containerEl } = this;
		const t = (en: string, zh: string) => this.uiText(en, zh);

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
		docContainer.createSpan({
			text: t("Need help? Check out the ", "需要帮助？查看"),
		});
		docContainer.createEl("a", {
			text: t("documentation", "文档"),
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
			.setName(t("Node.js path", "Node.js 路径"))
			.setDesc(
				t(
					'Absolute path to Node.js executable. On macOS/Linux, use "which node", and on Windows, use "where node" to find it.',
					'Node.js 可执行文件的绝对路径。macOS/Linux 可用 "which node"，Windows 可用 "where node" 查找。',
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Absolute path to node", "node 的绝对路径"),
				)
					.setValue(this.plugin.settings.nodePath)
					.onChange(async (value) => {
						this.plugin.settings.nodePath = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("Send message shortcut", "发送消息快捷键"))
			.setDesc(
				t(
					"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
					"选择发送消息的快捷键。注意：如果使用 Cmd/Ctrl+Enter，可能需要先移除该快捷键在 Obsidian 中的占用（设置 → 快捷键）。",
				),
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						t(
							"Enter to send, Shift+Enter for newline",
							"Enter 发送，Shift+Enter 换行",
						),
					)
					.addOption(
						"cmd-enter",
						t(
							"Cmd/Ctrl+Enter to send, Enter for newline",
							"Cmd/Ctrl+Enter 发送，Enter 换行",
						),
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

		new Setting(containerEl).setName(t("Mentions", "引用")).setHeading();

		new Setting(containerEl)
			.setName(t("Auto-mention active note", "自动引用当前笔记"))
			.setDesc(
				t(
					"Include the current note in your messages automatically. The agent will have access to its content without typing @notename.",
					"自动将当前笔记加入消息上下文，无需手动输入 @笔记名。",
				),
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
			.setName(t("Max note length", "笔记最大长度"))
			.setDesc(
				t(
					"Maximum characters per mentioned note. Notes longer than this will be truncated.",
					"每个被引用笔记允许的最大字符数，超出将被截断。",
				),
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
			.setName(t("Max selection length", "选区最大长度"))
			.setDesc(
				t(
					"Maximum characters for text selection in auto-mention. Selections longer than this will be truncated.",
					"自动引用时选中文本的最大字符数，超出将被截断。",
				),
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

		new Setting(containerEl).setName(t("Display", "显示")).setHeading();

		new Setting(containerEl)
			.setName(t("Chat view location", "聊天视图位置"))
			.setDesc(t("Where to open new chat views", "新聊天视图的打开位置"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"right-tab",
						t("Right pane (tabs)", "右侧栏（标签）"),
					)
					.addOption(
						"right-split",
						t("Right pane (split)", "右侧栏（分栏）"),
					)
					.addOption(
						"editor-tab",
						t("Editor area (tabs)", "编辑区（标签）"),
					)
					.addOption(
						"editor-split",
						t("Editor area (split)", "编辑区（分栏）"),
					)
					.setValue(this.plugin.settings.chatViewLocation)
					.onChange(async (value) => {
						this.plugin.settings.chatViewLocation =
							value as ChatViewLocation;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("Chat font size", "聊天字体大小"))
			.setDesc(
				t(
					`Adjust the font size of the chat message area (${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}px).`,
					`调整聊天消息区域字体大小（${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}px）。`,
				),
			)
			.addText((text) => {
				const getCurrentDisplayValue = (): string => {
					const currentFontSize =
						this.plugin.settings.displaySettings.fontSize;
					return currentFontSize === null
						? ""
						: String(currentFontSize);
				};

				const persistChatFontSize = async (
					fontSize: number | null,
				): Promise<void> => {
					if (
						this.plugin.settings.displaySettings.fontSize ===
						fontSize
					) {
						return;
					}

					const nextSettings = {
						...this.plugin.settings,
						displaySettings: {
							...this.plugin.settings.displaySettings,
							fontSize,
						},
					};
					await this.plugin.saveSettingsAndNotify(nextSettings);
				};

				text.setPlaceholder(
					`${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}`,
				)
					.setValue(getCurrentDisplayValue())
					.onChange(async (value) => {
						if (value.trim().length === 0) {
							await persistChatFontSize(null);
							return;
						}

						const trimmedValue = value.trim();
						if (!/^-?\d+$/.test(trimmedValue)) {
							return;
						}

						const numericValue = Number.parseInt(trimmedValue, 10);
						if (
							numericValue < CHAT_FONT_SIZE_MIN ||
							numericValue > CHAT_FONT_SIZE_MAX
						) {
							return;
						}

						const parsedFontSize = parseChatFontSize(numericValue);
						if (parsedFontSize === null) {
							return;
						}

						const hasChanged =
							this.plugin.settings.displaySettings.fontSize !==
							parsedFontSize;
						if (hasChanged) {
							await persistChatFontSize(parsedFontSize);
						}
					});

				text.inputEl.addEventListener("blur", () => {
					const currentInputValue = text.getValue();
					const parsedFontSize = parseChatFontSize(currentInputValue);

					if (
						currentInputValue.trim().length > 0 &&
						parsedFontSize === null
					) {
						text.setValue(getCurrentDisplayValue());
						return;
					}

					if (parsedFontSize !== null) {
						text.setValue(String(parsedFontSize));
						const hasChanged =
							this.plugin.settings.displaySettings.fontSize !==
							parsedFontSize;
						if (hasChanged) {
							void persistChatFontSize(parsedFontSize);
						}
						return;
					}

					text.setValue("");
				});
			});

		new Setting(containerEl)
			.setName(t("Show emojis", "显示表情图标"))
			.setDesc(
				t(
					"Display emoji icons in tool calls, thoughts, plans, and terminal blocks.",
					"在工具调用、思考、计划和终端块中显示表情图标。",
				),
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
			.setName(t("Auto-collapse long diffs", "自动折叠长 diff"))
			.setDesc(
				t(
					"Automatically collapse diffs that exceed the line threshold.",
					"当 diff 行数超过阈值时自动折叠。",
				),
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
				.setName(t("Collapse threshold", "折叠阈值"))
				.setDesc(
					t(
						"Diffs with more lines than this will be collapsed by default.",
						"超过该行数的 diff 默认折叠。",
					),
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
		// Floating chat
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl)
			.setName(t("Floating chat", "悬浮聊天"))
			.setHeading();

		new Setting(containerEl)
			.setName(t("Show floating button", "显示悬浮按钮"))
			.setDesc(
				t(
					"Display a floating chat button that opens a draggable chat window.",
					"显示悬浮聊天按钮，可打开可拖拽聊天窗口。",
				),
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showFloatingButton)
					.onChange(async (value) => {
						const wasEnabled =
							this.plugin.settings.showFloatingButton;
						this.plugin.settings.showFloatingButton = value;
						await this.plugin.saveSettings();

						// Handle dynamic toggle of floating chat
						if (value && !wasEnabled) {
							// Turning ON: create floating chat instance
							this.plugin.openNewFloatingChat();
						} else if (!value && wasEnabled) {
							// Turning OFF: close all floating chat instances
							const instances =
								this.plugin.getFloatingChatInstances();
							for (const instanceId of instances) {
								this.plugin.closeFloatingChat(instanceId);
							}
						}
					}),
			);

		new Setting(containerEl)
			.setName(t("Floating button image", "悬浮按钮图片"))
			.setDesc(
				t(
					"URL or path to an image for the floating button. Leave empty for default icon.",
					"悬浮按钮图片的 URL 或路径，留空则使用默认图标。",
				),
			)
			.addText((text) =>
				text
					.setPlaceholder(
						t(
							"https://example.com/avatar.png",
							"https://example.com/avatar.png",
						),
					)
					.setValue(this.plugin.settings.floatingButtonImage)
					.onChange(async (value) => {
						this.plugin.settings.floatingButtonImage = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// ─────────────────────────────────────────────────────────────────────
		// Permissions
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName(t("Permissions", "权限")).setHeading();

		new Setting(containerEl)
			.setName(t("Auto-allow permissions", "自动允许权限请求"))
			.setDesc(
				t(
					"Automatically allow all permission requests from agents. Use with caution - this gives agents full access to your system.",
					"自动允许代理发起的所有权限请求。请谨慎使用，这会给代理较高系统权限。",
				),
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
				.setName(
					t(
						"Windows Subsystem for Linux",
						"Windows 子系统 Linux（WSL）",
					),
				)
				.setHeading();

			new Setting(containerEl)
				.setName(t("Enable WSL mode", "启用 WSL 模式"))
				.setDesc(
					t(
						"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.",
						"在 WSL 内运行代理。适用于在原生 Windows 环境下运行不稳定的代理（如 Codex）。",
					),
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
					.setName(t("WSL distribution", "WSL 发行版"))
					.setDesc(
						t(
							"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
							"指定 WSL 发行版名称（留空使用默认）。例如：Ubuntu、Debian",
						),
					)
					.addText((text) =>
						text
							.setPlaceholder(
								t("Leave empty for default", "留空使用默认"),
							)
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

		new Setting(containerEl)
			.setName(t("Built-in agents", "内置代理"))
			.setHeading();

		this.renderClaudeSettings(containerEl);
		this.renderCodexSettings(containerEl);
		this.renderGeminiSettings(containerEl);

		new Setting(containerEl)
			.setName(t("Custom agents", "自定义代理"))
			.setHeading();

		this.renderCustomAgents(containerEl);

		// ─────────────────────────────────────────────────────────────────────
		// Export
		// ─────────────────────────────────────────────────────────────────────

		new Setting(containerEl).setName(t("Export", "导出")).setHeading();

		new Setting(containerEl)
			.setName(t("Export folder", "导出文件夹"))
			.setDesc(
				t(
					"Folder where chat exports will be saved",
					"聊天导出的保存目录",
				),
			)
			.addText((text) =>
				text
					.setPlaceholder(t("Agent Client", "Agent Client"))
					.setValue(this.plugin.settings.exportSettings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.defaultFolder =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("Filename", "文件名"))
			.setDesc(
				t(
					"Template for exported filenames. Use {date} for date and {time} for time",
					"导出文件名模板，可使用 {date} 和 {time}。",
				),
			)
			.addText((text) =>
				text
					.setPlaceholder(
						t(
							"agent_client_{date}_{time}",
							"agent_client_{date}_{time}",
						),
					)
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
			.setName(t("Frontmatter tag", "Frontmatter 标签"))
			.setDesc(
				t(
					"Tag to add to exported notes. Supports nested tags (e.g., projects/agent-client). Leave empty to disable.",
					"为导出笔记添加标签。支持多级标签（如 projects/agent-client），留空则禁用。",
				),
			)
			.addText((text) =>
				text
					.setPlaceholder(t("agent-client", "agent-client"))
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
			.setName(t("Include images", "包含图片"))
			.setDesc(
				t(
					"Include images in exported markdown files",
					"在导出的 Markdown 中包含图片",
				),
			)
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
				.setName(t("Image location", "图片保存位置"))
				.setDesc(
					t("Where to save exported images", "导出图片的保存方式"),
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOption(
							"obsidian",
							t(
								"Use Obsidian's attachment setting",
								"使用 Obsidian 附件设置",
							),
						)
						.addOption(
							"custom",
							t("Save to custom folder", "保存到自定义文件夹"),
						)
						.addOption(
							"base64",
							t(
								"Embed as Base64 (not recommended)",
								"以内嵌 Base64 保存（不推荐）",
							),
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
					.setName(t("Custom image folder", "自定义图片文件夹"))
					.setDesc(
						t(
							"Folder path for exported images (relative to vault root)",
							"导出图片文件夹路径（相对于库根目录）",
						),
					)
					.addText((text) =>
						text
							.setPlaceholder(t("Agent Client", "Agent Client"))
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
			.setName(t("Auto-export on new chat", "新建聊天时自动导出"))
			.setDesc(
				t(
					"Automatically export the current chat when starting a new chat",
					"开始新聊天时自动导出当前聊天。",
				),
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
			.setName(t("Auto-export on close chat", "关闭聊天时自动导出"))
			.setDesc(
				t(
					"Automatically export the current chat when closing the chat view",
					"关闭聊天视图时自动导出当前聊天。",
				),
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
			.setName(t("Open note after export", "导出后打开笔记"))
			.setDesc(
				t(
					"Automatically open the exported note after exporting",
					"导出后自动打开导出的笔记",
				),
			)
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

		new Setting(containerEl).setName(t("Developer", "开发者")).setHeading();

		new Setting(containerEl)
			.setName(t("Debug mode", "调试模式"))
			.setDesc(
				t(
					"Enable debug logging to console. Useful for development and troubleshooting.",
					"启用控制台调试日志，便于开发和故障排查。",
				),
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
		const t = (en: string, zh: string) => this.uiText(en, zh);

		new Setting(containerEl)
			.setName(t("Default agent", "默认代理"))
			.setDesc(
				t(
					"Choose which agent is used when opening a new chat view.",
					"选择打开新聊天视图时使用的代理。",
				),
			)
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
		const t = (en: string, zh: string) => this.uiText(en, zh);

		new Setting(sectionEl)
			.setName(gemini.displayName || t("Gemini CLI", "Gemini CLI"))
			.setHeading();

		new Setting(sectionEl)
			.setName(t("API key", "API Key"))
			.setDesc(
				t(
					"Gemini API key. Required if not logging in with a Google account. (Stored as plain text)",
					"Gemini API Key。未使用 Google 账号登录时必填。（明文存储）",
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Enter your Gemini API key", "输入 Gemini API Key"),
				)
					.setValue(gemini.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.gemini.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName(t("Path", "路径"))
			.setDesc(
				t(
					'Absolute path to the Gemini CLI. On macOS/Linux, use "which gemini", and on Windows, use "where gemini" to find it.',
					'Gemini CLI 的绝对路径。macOS/Linux 可用 "which gemini"，Windows 可用 "where gemini" 查找。',
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Absolute path to gemini", "gemini 的绝对路径"),
				)
					.setValue(gemini.command)
					.onChange(async (value) => {
						this.plugin.settings.gemini.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName(t("Arguments", "参数"))
			.setDesc(
				t(
					'Enter one argument per line. Leave empty to run without arguments.(Currently, the Gemini CLI requires the "--experimental-acp" option.)',
					'每行一个参数。留空则不传参数。（当前 Gemini CLI 需要 "--experimental-acp" 选项。）',
				),
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
			.setName(t("Environment variables", "环境变量"))
			.setDesc(
				t(
					"Enter KEY=VALUE pairs, one per line. Required to authenticate with Vertex AI. GEMINI_API_KEY is derived from the field above.(Stored as plain text)",
					"每行一个 KEY=VALUE。使用 Vertex AI 认证时需要。GEMINI_API_KEY 会由上面的字段自动注入。（明文存储）",
				),
			)
			.addTextArea((text) => {
				text.setPlaceholder("Google cloud project=...")
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
		const t = (en: string, zh: string) => this.uiText(en, zh);

		new Setting(sectionEl)
			.setName(
				claude.displayName ||
					t("Claude Code (ACP)", "Claude Code (ACP)"),
			)
			.setHeading();

		new Setting(sectionEl)
			.setName(t("API key", "API Key"))
			.setDesc(
				t(
					"Anthropic API key. Required if not logging in with an Anthropic account. (Stored as plain text)",
					"Anthropic API Key。未使用 Anthropic 账号登录时必填。（明文存储）",
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Enter your Anthropic API key", "输入 Anthropic API Key"),
				)
					.setValue(claude.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.claude.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName(t("Path", "路径"))
			.setDesc(
				t(
					'Absolute path to the claude-agent-acp. On macOS/Linux, use "which claude-agent-acp", and on Windows, use "where claude-agent-acp" to find it.',
					'claude-agent-acp 的绝对路径。macOS/Linux 可用 "which claude-agent-acp"，Windows 可用 "where claude-agent-acp" 查找。',
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t(
						"Absolute path to claude-agent-acp",
						"claude-agent-acp 的绝对路径",
					),
				)
					.setValue(claude.command)
					.onChange(async (value) => {
						this.plugin.settings.claude.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName(t("Arguments", "参数"))
			.setDesc(
				t(
					"Enter one argument per line. Leave empty to run without arguments.",
					"每行一个参数。留空则不传参数。",
				),
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
			.setName(t("Environment variables", "环境变量"))
			.setDesc(
				t(
					"Enter KEY=VALUE pairs, one per line. ANTHROPIC_API_KEY is derived from the field above.",
					"每行一个 KEY=VALUE。ANTHROPIC_API_KEY 会由上面的字段自动注入。",
				),
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
		const t = (en: string, zh: string) => this.uiText(en, zh);

		new Setting(sectionEl)
			.setName(codex.displayName || t("Codex", "Codex"))
			.setHeading();

		new Setting(sectionEl)
			.setName(t("API key", "API Key"))
			.setDesc(
				t(
					"OpenAI API key. Required if not logging in with an OpenAI account. (Stored as plain text)",
					"OpenAI API Key。未使用 OpenAI 账号登录时必填。（明文存储）",
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Enter your OpenAI API key", "输入 OpenAI API Key"),
				)
					.setValue(codex.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.codex.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(sectionEl)
			.setName(t("Path", "路径"))
			.setDesc(
				t(
					'Absolute path to the codex-acp. On macOS/Linux, use "which codex-acp", and on Windows, use "where codex-acp" to find it.',
					'codex-acp 的绝对路径。macOS/Linux 可用 "which codex-acp"，Windows 可用 "where codex-acp" 查找。',
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Absolute path to codex-acp", "codex-acp 的绝对路径"),
				)
					.setValue(codex.command)
					.onChange(async (value) => {
						this.plugin.settings.codex.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(sectionEl)
			.setName(t("Arguments", "参数"))
			.setDesc(
				t(
					"Enter one argument per line. Leave empty to run without arguments.",
					"每行一个参数。留空则不传参数。",
				),
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
			.setName(t("Environment variables", "环境变量"))
			.setDesc(
				t(
					"Enter KEY=VALUE pairs, one per line. OPENAI_API_KEY is derived from the field above.",
					"每行一个 KEY=VALUE。OPENAI_API_KEY 会由上面的字段自动注入。",
				),
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
		const t = (en: string, zh: string) => this.uiText(en, zh);
		if (this.plugin.settings.customAgents.length === 0) {
			containerEl.createEl("p", {
				text: t(
					"No custom agents configured yet.",
					"还没有配置自定义代理。",
				),
			});
		} else {
			this.plugin.settings.customAgents.forEach((agent, index) => {
				this.renderCustomAgent(containerEl, agent, index);
			});
		}

		new Setting(containerEl).addButton((button) => {
			button
				.setButtonText(t("Add custom agent", "添加自定义代理"))
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
		const t = (en: string, zh: string) => this.uiText(en, zh);
		const blockEl = containerEl.createDiv({
			cls: "agent-client-custom-agent",
		});

		const idSetting = new Setting(blockEl)
			.setName(t("Agent ID", "代理 ID"))
			.setDesc(
				t(
					"Unique identifier used to reference this agent.",
					"用于引用此代理的唯一标识。",
				),
			)
			.addText((text) => {
				text.setPlaceholder(t("custom-agent", "自定义-id（建议英文）"))
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
				.setTooltip(t("Delete this agent", "删除该代理"))
				.onClick(async () => {
					this.plugin.settings.customAgents.splice(index, 1);
					this.plugin.ensureDefaultAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName(t("Display name", "显示名称"))
			.setDesc(t("Shown in menus and headers.", "显示在菜单和标题中。"))
			.addText((text) => {
				text.setPlaceholder(t("Custom agent", "自定义代理"))
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
			.setName(t("Path", "路径"))
			.setDesc(
				t(
					"Absolute path to the custom agent.",
					"自定义代理的绝对路径。",
				),
			)
			.addText((text) => {
				text.setPlaceholder(
					t("Absolute path to custom agent", "自定义代理的绝对路径"),
				)
					.setValue(agent.command)
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].command =
							value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(blockEl)
			.setName(t("Arguments", "参数"))
			.setDesc(
				t(
					"Enter one argument per line. Leave empty to run without arguments.",
					"每行一个参数。留空则不传参数。",
				),
			)
			.addTextArea((text) => {
				text.setPlaceholder(
					t("--flag\n--another=value", "--flag\n--another=value"),
				)
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						this.plugin.settings.customAgents[index].args =
							this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName(t("Environment variables", "环境变量"))
			.setDesc(
				t(
					"Enter KEY=VALUE pairs, one per line. (Stored as plain text)",
					"每行一个 KEY=VALUE。（明文存储）",
				),
			)
			.addTextArea((text) => {
				text.setPlaceholder(t("TOKEN=...", "TOKEN=..."))
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
		const base = this.uiText("Custom agent", "自定义代理");
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
