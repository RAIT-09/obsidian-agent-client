import { Setting, setIcon } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import type { AgentSecretBinding } from "../../../plugin";

const secretBindingPickerCleanup = new WeakMap<HTMLElement, () => void>();

export function renderGlobalSecretBindings(
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
