import { Notice, Platform, Setting, setIcon } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import type { AgentSecretBinding, ChatViewLocation } from "../../../plugin";
import {
	CHAT_FONT_SIZE_MAX,
	CHAT_FONT_SIZE_MIN,
	parseChatFontSize,
} from "../../../shared/display-settings";
import { resolveCommandFromShell } from "../../../shared/shell-utils";
import { renderSectionHeader } from "../settings-ui-helpers";

const secretBindingPickerCleanup = new WeakMap<HTMLElement, () => void>();

export const renderCoreSections = (
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	redisplay: () => void,
): void => {
	const store = plugin.settingsStore;

	renderSectionHeader(containerEl, "settings", "General");

	let nodeTextRef: { setValue: (v: string) => unknown } | null = null;
	const nodeSetting = new Setting(containerEl)
		.setName("Node.js path")
		.setDesc(
			'Absolute path to Node.js executable. On macOS/Linux, use "which node", and on Windows, use "where node" to find it.',
		)
		.addText((text) => {
			nodeTextRef = text;
			text
				.setPlaceholder("Absolute path to node")
				.setValue(plugin.settings.nodePath)
				.onChange(async (value) => {
					await store.updateSettings({ nodePath: value.trim() });
				});
		});
	nodeSetting.addExtraButton((button) => {
		button
			.setIcon("search")
			.setTooltip("Detect from shell PATH") // eslint-disable-line obsidianmd/ui/sentence-case
			.onClick(async () => {
				button.setDisabled(true);
				try {
					const resolved = await resolveCommandFromShell("node");
					if (resolved) {
						nodeTextRef?.setValue(resolved);
						await store.updateSettings({ nodePath: resolved });
						new Notice(`Found: ${resolved}`);
					} else {
						new Notice('"node" not found in shell PATH.'); // eslint-disable-line obsidianmd/ui/sentence-case
					}
				} finally {
					button.setDisabled(false);
				}
			});
	});

	new Setting(containerEl)
		.setName("Send message shortcut")
		.setDesc(
			"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
		)
		.addDropdown((dropdown) =>
			dropdown
				.addOption("enter", "Enter to send, Shift+Enter for newline")
				.addOption("cmd-enter", "Cmd/Ctrl+Enter to send, Enter for newline")
				.setValue(plugin.settings.sendMessageShortcut)
				.onChange(async (value) => {
					await store.updateSettings({
						sendMessageShortcut: value as "enter" | "cmd-enter",
					});
				}),
		);

	new Setting(containerEl)
		.setName("Completion sound")
		.setDesc("Play a short chime when an agent finishes responding.")
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.displaySettings.completionSound)
				.onChange(async (value) => {
					await store.updateSettings({
						displaySettings: {
							...plugin.settings.displaySettings,
							completionSound: value,
						},
					});
				}),
		);
	renderGlobalSecretBindings(containerEl, plugin, redisplay);

	renderMentionsSection(containerEl, plugin);
	renderDisplaySection(containerEl, plugin, redisplay);
	renderPermissionSection(containerEl, plugin);
	renderWindowsSection(containerEl, plugin, redisplay);
	renderDeveloperSection(containerEl, plugin);
};

function renderGlobalSecretBindings(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	redisplay: () => void,
): void {
	const store = plugin.settingsStore;
	const bindings = plugin.settings.secretBindings;
	const availableSecrets = getAvailableSecretIds(plugin);
	const description =
		"Bind environment variable names to Obsidian keychain secrets. Example: GEMINI_API_KEY -> nano-banana-api.";

	new Setting(containerEl)
		.setName("Secret bindings")
		.setDesc(description)
		.addButton((button) =>
			button.setButtonText("Add binding").onClick(async () => {
				await store.updateSettings({
					secretBindings: [
						...plugin.settings.secretBindings,
						{ envKey: "", secretId: "" },
					],
				});
				redisplay();
			}),
		);

	if (bindings.length === 0) {
		return;
	}

	const updateBinding = async (
		index: number,
		patch: Partial<AgentSecretBinding>,
	): Promise<void> => {
		const next = plugin.settings.secretBindings.map((binding, i) =>
			i === index ? { ...binding, ...patch } : binding,
		);
		await store.updateSettings({ secretBindings: next });
	};

	const orderedBindings = bindings
		.map((binding, index) => ({ binding, index }))
		.sort((left, right) => {
			const leftIsGemini = left.binding.envKey.trim() === "GEMINI_API_KEY";
			const rightIsGemini = right.binding.envKey.trim() === "GEMINI_API_KEY";
			if (leftIsGemini === rightIsGemini) {
				return left.index - right.index;
			}
			return leftIsGemini ? 1 : -1;
		});

	orderedBindings.forEach(({ binding, index }) => {
		const rowWrapper = containerEl.createDiv();
		const row = new Setting(rowWrapper);
		row
			.addText((text) =>
				text
					.setPlaceholder("GEMINI_API_KEY")
					.setValue(binding.envKey)
					.onChange(async (value) => {
						await updateBinding(index, { envKey: value.trim() });
					}),
			)
			.addButton((button) => {
				const label = binding.secretId.length > 0 ? binding.secretId : "Link...";
				button
					.setButtonText(label)
					.setTooltip("Choose keychain secret")
					.onClick(() => {
						toggleSecretBindingPicker(
							rowWrapper,
							binding.secretId,
							availableSecrets,
							async (secretId) => {
								await updateBinding(index, { secretId });
								redisplay();
							},
						);
					});
			})
			.addButton((button) =>
				button.setButtonText("Refresh").onClick(() => {
					redisplay();
				}),
			)
			.addExtraButton((button) =>
				button
					.setIcon("trash")
					.setTooltip("Remove binding")
					.onClick(async () => {
						const next = plugin.settings.secretBindings.filter(
							(_, i) => i !== index,
						);
						await store.updateSettings({ secretBindings: next });
						redisplay();
					}),
			);
	});
}

function destroySecretBindingPicker(picker: HTMLElement): void {
	const cleanup = secretBindingPickerCleanup.get(picker);
	if (cleanup) {
		cleanup();
		secretBindingPickerCleanup.delete(picker);
	}
	picker.remove();
}

function toggleSecretBindingPicker(
	wrapper: HTMLElement,
	selectedSecretId: string,
	availableSecrets: string[],
	onSelect: (secretId: string) => Promise<void>,
): void {
	const existing: HTMLElement | null = wrapper.querySelector(
		".obsius-secret-binding-picker",
	);
	if (existing) {
		destroySecretBindingPicker(existing);
		return;
	}

	const picker = wrapper.createDiv({
		cls: "obsius-model-picker obsius-secret-binding-picker",
	});
	const listEl = picker.createDiv({ cls: "obsius-model-picker-list" });
	const options = Array.from(new Set(availableSecrets)).sort((a, b) =>
		a.localeCompare(b),
	);

	if (options.length === 0) {
		listEl.createDiv({
			text: "No keychain secrets found.",
			cls: "obsius-model-picker-empty",
		});
	} else {
		for (const secretId of options) {
			const isSelected = secretId === selectedSecretId;
			const item = listEl.createDiv({
				cls: `obsius-model-picker-item${isSelected ? " is-selected" : ""}`,
			});
			const checkEl = item.createSpan({ cls: "obsius-model-picker-check" });
			if (isSelected) {
				setIcon(checkEl, "check");
			}

			const textEl = item.createDiv({ cls: "obsius-model-picker-item-text" });
			textEl.createSpan({
				text: secretId,
				cls: "obsius-model-picker-item-name",
			});
			textEl.createSpan({
				text: "Obsidian keychain secret",
				cls: "obsius-model-picker-item-desc",
			});

			item.addEventListener("click", () => {
				void (async () => {
					await onSelect(secretId);
					destroySecretBindingPicker(picker);
				})();
			});
		}
	}

	const onClickOutside = (event: MouseEvent) => {
		if (!picker.contains(event.target as Node)) {
			destroySecretBindingPicker(picker);
		}
	};
	document.addEventListener("mousedown", onClickOutside, true);
	secretBindingPickerCleanup.set(picker, () => {
		document.removeEventListener("mousedown", onClickOutside, true);
	});
}

function getAvailableSecretIds(plugin: AgentClientPlugin): string[] {
	const options = new Set<string>();
	for (const secretId of plugin.app.secretStorage.listSecrets()) {
		if (secretId.length > 0) {
			options.add(secretId);
		}
	}
	options.add(plugin.settings.gemini.apiKeySecretId);
	options.add(plugin.settings.claude.apiKeySecretId);
	options.add(plugin.settings.codex.apiKeySecretId);
	for (const binding of plugin.settings.secretBindings) {
		if (binding.secretId.length > 0) {
			options.add(binding.secretId);
		}
	}
	return Array.from(options).sort((a, b) => a.localeCompare(b));
}

function renderMentionsSection(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	const store = plugin.settingsStore;

	renderSectionHeader(containerEl, "at-sign", "Mentions");

	new Setting(containerEl)
		.setName("Max note length")
		.setDesc(
			"Maximum characters per mentioned note. Notes longer than this will be truncated.",
		)
		.addText((text) =>
			text
				.setPlaceholder("10000")
				.setValue(String(plugin.settings.displaySettings.maxNoteLength))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num >= 1) {
						await store.updateSettings({
							displaySettings: {
								...plugin.settings.displaySettings,
								maxNoteLength: num,
							},
						});
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
				.setValue(String(plugin.settings.displaySettings.maxSelectionLength))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num >= 1) {
						await store.updateSettings({
							displaySettings: {
								...plugin.settings.displaySettings,
								maxSelectionLength: num,
							},
						});
					}
				}),
		);
}

function renderDisplaySection(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	redisplay: () => void,
): void {
	const store = plugin.settingsStore;

	renderSectionHeader(containerEl, "monitor", "Display");

	new Setting(containerEl)
		.setName("Chat view location")
		.setDesc("Where to open new chat views")
		.addDropdown((dropdown) =>
			dropdown
				.addOption("right-tab", "Right pane (tabs)")
				.addOption("right-split", "Right pane (split)")
				.addOption("editor-tab", "Editor area (tabs)")
				.addOption("editor-split", "Editor area (split)")
				.setValue(plugin.settings.chatViewLocation)
				.onChange(async (value) => {
					await store.updateSettings({
						chatViewLocation: value as ChatViewLocation,
					});
				}),
		);

	new Setting(containerEl)
		.setName("Chat font size")
		.setDesc(
			`Adjust the font size of the chat message area (${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}px).`,
		)
		.addText((text) => {
			const getCurrentDisplayValue = (): string => {
				const currentFontSize = plugin.settings.displaySettings.fontSize;
				return currentFontSize === null ? "" : String(currentFontSize);
			};

			const persistChatFontSize = async (
				fontSize: number | null,
			): Promise<void> => {
				if (plugin.settings.displaySettings.fontSize === fontSize) {
					return;
				}
				await store.updateSettings({
					displaySettings: {
						...plugin.settings.displaySettings,
						fontSize,
					},
				});
			};

			text
				.setPlaceholder(`${CHAT_FONT_SIZE_MIN}-${CHAT_FONT_SIZE_MAX}`)
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
					if (plugin.settings.displaySettings.fontSize !== parsedFontSize) {
						await persistChatFontSize(parsedFontSize);
					}
				});

			text.inputEl.addEventListener("blur", () => {
				const currentInputValue = text.getValue();
				const parsedFontSize = parseChatFontSize(currentInputValue);
				if (currentInputValue.trim().length > 0 && parsedFontSize === null) {
					text.setValue(getCurrentDisplayValue());
					return;
				}
				if (parsedFontSize !== null) {
					text.setValue(String(parsedFontSize));
					if (plugin.settings.displaySettings.fontSize !== parsedFontSize) {
						void persistChatFontSize(parsedFontSize);
					}
					return;
				}
				text.setValue("");
			});
		});

	new Setting(containerEl)
		.setName("Auto-collapse long diffs")
		.setDesc("Automatically collapse diffs that exceed the line threshold.")
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.displaySettings.autoCollapseDiffs)
				.onChange(async (value) => {
					await store.updateSettings({
						displaySettings: {
							...plugin.settings.displaySettings,
							autoCollapseDiffs: value,
						},
					});
					redisplay();
				}),
		);

	if (plugin.settings.displaySettings.autoCollapseDiffs) {
		new Setting(containerEl)
			.setName("Collapse threshold")
			.setDesc("Diffs with more lines than this will be collapsed by default.")
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(
						String(plugin.settings.displaySettings.diffCollapseThreshold),
					)
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							await store.updateSettings({
								displaySettings: {
									...plugin.settings.displaySettings,
									diffCollapseThreshold: num,
								},
							});
						}
					}),
			);
	}
}

function renderPermissionSection(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	renderSectionHeader(containerEl, "shield", "Permissions");
	const store = plugin.settingsStore;

	new Setting(containerEl)
		.setName("Terminal permission mode")
		.setDesc(
			"Choose whether terminal/execute calls are disabled, prompt each time, or always allow/deny.",
		)
		.addDropdown((dropdown) =>
			dropdown
				.addOption("disabled", "Disable terminal tool calls")
				.addOption("prompt_once", "Prompt each command (allow/deny once)")
				.addOption("always_allow", "Always allow terminal permissions")
				.addOption("always_deny", "Always deny terminal permissions")
				.setValue(plugin.settings.terminalPermissionMode)
				.onChange(async (value) => {
					await store.updateSettings({
						terminalPermissionMode: value as
							| "disabled"
							| "prompt_once"
							| "always_allow"
							| "always_deny",
					});
				}),
		);
}

function renderWindowsSection(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	redisplay: () => void,
): void {
	if (!Platform.isWin) {
		return;
	}

	const store = plugin.settingsStore;

	renderSectionHeader(containerEl, "terminal", "Windows Subsystem for Linux");

	new Setting(containerEl)
		.setName("Enable WSL mode")
		.setDesc(
			"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.", // eslint-disable-line obsidianmd/ui/sentence-case
		)
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.windowsWslMode)
				.onChange(async (value) => {
					await store.updateSettings({ windowsWslMode: value });
					redisplay();
				}),
		);

	if (plugin.settings.windowsWslMode) {
		new Setting(containerEl)
			.setName("WSL distribution")
			.setDesc(
				"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
			)
			.addText((text) =>
				text
					.setPlaceholder("Leave empty for default")
					.setValue(plugin.settings.windowsWslDistribution || "")
					.onChange(async (value) => {
						await store.updateSettings({
							windowsWslDistribution: value.trim() || undefined,
						});
					}),
			);
	}
}

function renderDeveloperSection(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
): void {
	renderSectionHeader(containerEl, "code", "Developer");
	new Setting(containerEl)
		.setName("Debug mode")
		.setDesc(
			"Enable debug logging to console. Useful for development and troubleshooting.",
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.debugMode).onChange(async (value) => {
				await plugin.settingsStore.updateSettings({ debugMode: value });
			}),
		);
}
