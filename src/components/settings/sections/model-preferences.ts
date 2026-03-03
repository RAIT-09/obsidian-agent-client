import { Setting, setIcon } from "obsidian";
import type AgentClientPlugin from "../../../plugin";

interface CachedModel {
	modelId: string;
	name: string;
	description?: string;
}

interface CachedMode {
	id: string;
	name: string;
	description?: string;
}

const pickerCleanup = new WeakMap<HTMLElement, () => void>();

function getValidCandidates(
	plugin: AgentClientPlugin,
	agentId: string,
	models: CachedModel[],
): string[] {
	return (plugin.settings.candidateModels?.[agentId] ?? []).filter((id) =>
		models.some((m) => m.modelId === id),
	);
}

async function saveCandidates(
	plugin: AgentClientPlugin,
	agentId: string,
	nextCandidates: string[],
): Promise<void> {
	await plugin.settingsStore.updateSettings({
		candidateModels: {
			...plugin.settings.candidateModels,
			[agentId]: nextCandidates,
		},
	});
}

/**
 * Render candidate-model picker + mode-model mapping for a single agent.
 * Called from each agent's settings section (after env vars).
 */
export function renderAgentModelSettings(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
): void {
	const models = plugin.settings.cachedAgentModels?.[agentId];
	if (!models || models.length === 0) return;

	const modes = plugin.settings.cachedAgentModes?.[agentId];
	let modeMappingContainer: HTMLElement | null = null;
	const renderModeMapping = () => {
		if (!modeMappingContainer) return;
		modeMappingContainer.empty();
		if (modes && modes.length > 0) {
			renderModeModelMapping(modeMappingContainer, plugin, agentId, modes, models);
		}
	};

	renderCandidateModelPicker(
		containerEl,
		plugin,
		agentId,
		models,
		renderModeMapping,
	);
	modeMappingContainer = containerEl.createDiv();
	renderModeMapping();
}

// ============================================================================
// Candidate Model Picker
// ============================================================================

function renderCandidateModelPicker(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
	models: CachedModel[],
	onCandidatesChange: () => void,
): void {
	const wrapper = containerEl.createDiv({
		cls: "obsius-model-prefs-agent",
	});

	const headerSetting = new Setting(wrapper)
		.setName("Candidate models")
		.setDesc(
			`All ${models.length} models are available. Add candidates to filter the chat selector.`,
		);

	const orderedListEl = wrapper.createDiv({
		cls: "obsius-model-order-list",
	});

	const refresh = () => {
		updateDescription(
			headerSetting,
			orderedListEl,
			plugin,
			agentId,
			models,
			onCandidatesChange,
		);
	};

	refresh();

	headerSetting.addExtraButton((btn) => {
		btn.setIcon("plus").setTooltip("Add model");
		btn.onClick(() => {
			togglePicker(wrapper, plugin, agentId, models, () => {
				refresh();
			});
		});
	});
}

function updateDescription(
	headerSetting: Setting,
	orderedListEl: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
	models: CachedModel[],
	onCandidatesChange: () => void,
): void {
	const updated = getValidCandidates(plugin, agentId, models);

	refreshCandidateOrderList(orderedListEl, plugin, agentId, models, () =>
		updateDescription(
			headerSetting,
			orderedListEl,
			plugin,
			agentId,
			models,
			onCandidatesChange,
		),
	);

	if (updated.length > 0) {
		headerSetting.setDesc(
			"Only these models appear in the chat selector. Drag to reorder.",
		);
	} else {
		headerSetting.setDesc(
			`All ${models.length} models are available. Add candidates to filter the chat selector.`,
		);
	}

	onCandidatesChange();
}

function moveArrayItem<T>(
	items: T[],
	fromIndex: number,
	toIndex: number,
): T[] {
	const next = [...items];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
}

function refreshCandidateOrderList(
	listEl: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
	models: CachedModel[],
	onUpdate: () => void,
): void {
	listEl.empty();
	const candidates = getValidCandidates(plugin, agentId, models);
	listEl.toggleClass("is-hidden", candidates.length === 0);
	let dragIndex: number | null = null;

	for (const [index, modelId] of candidates.entries()) {
		const model = models.find((m) => m.modelId === modelId);
		const row = listEl.createDiv({ cls: "obsius-model-order-item" });
		row.draggable = true;

		const dragHandle = row.createSpan({ cls: "obsius-model-order-handle" });
		setIcon(dragHandle, "grip-vertical");

		row.createSpan({
			text: model?.name ?? modelId,
			cls: "obsius-model-order-label",
		});
		const removeBtn = row.createSpan({
			text: "\u00d7",
			cls: "obsius-model-order-remove",
			attr: { "aria-label": `Remove ${model?.name ?? modelId}` },
		});

		row.addEventListener("dragstart", (e) => {
			dragIndex = index;
			row.addClass("is-dragging");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", modelId);
			}
		});
		row.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (dragIndex !== index) {
				row.addClass("is-drop-target");
			}
		});
		row.addEventListener("dragleave", () => {
			row.removeClass("is-drop-target");
		});
		row.addEventListener("drop", (e) => {
			e.preventDefault();
			row.removeClass("is-drop-target");
			if (dragIndex === null || dragIndex === index) {
				dragIndex = null;
				return;
			}
			void (async () => {
				const fromIndex = dragIndex;
				const reordered = moveArrayItem(candidates, fromIndex, index);
				await saveCandidates(plugin, agentId, reordered);
				onUpdate();
			})();
			dragIndex = null;
		});
		row.addEventListener("dragend", () => {
			dragIndex = null;
			for (const child of Array.from(listEl.children)) {
				const item = child as HTMLElement;
				item.removeClass("is-dragging");
				item.removeClass("is-drop-target");
			}
		});

		removeBtn.addEventListener("click", () => {
			void (async () => {
				const current = getValidCandidates(plugin, agentId, models);
				await saveCandidates(
					plugin,
					agentId,
					current.filter((id) => id !== modelId),
				);
				onUpdate();
			})();
		});
	}
}

function destroyPicker(picker: HTMLElement): void {
	const cleanup = pickerCleanup.get(picker);
	if (cleanup) {
		cleanup();
		pickerCleanup.delete(picker);
	}
	picker.remove();
}

interface ProviderGroup {
	provider: string;
	models: CachedModel[];
}

function groupModelsByProvider(models: CachedModel[]): ProviderGroup[] {
	const groups = new Map<string, CachedModel[]>();

	for (const model of models) {
		const slashIdx = model.name.indexOf("/");
		const provider =
			slashIdx !== -1 ? model.name.substring(0, slashIdx).trim() : "Other";
		const list = groups.get(provider) ?? [];
		list.push(model);
		groups.set(provider, list);
	}

	const result: ProviderGroup[] = [];
	for (const [provider, providerModels] of groups) {
		if (provider !== "Other") {
			result.push({ provider, models: providerModels });
		}
	}
	result.sort((a, b) => a.provider.localeCompare(b.provider));

	const other = groups.get("Other");
	if (other) {
		result.push({ provider: "Other", models: other });
	}

	return result;
}

function togglePicker(
	wrapper: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
	models: CachedModel[],
	onUpdate: () => void,
): void {
	const existing: HTMLElement | null = wrapper.querySelector(
		".obsius-model-picker",
	);
	if (existing) {
		destroyPicker(existing);
		return;
	}

	const picker = wrapper.createDiv({ cls: "obsius-model-picker" });
	const listEl = picker.createDiv({ cls: "obsius-model-picker-list" });
	const groups = groupModelsByProvider(models);

	const renderProviders = () => {
		listEl.empty();

		if (groups.length <= 1) {
			renderModels(models, null);
			return;
		}

		for (const group of groups) {
			const currentCandidates =
				plugin.settings.candidateModels?.[agentId] ?? [];
			const selectedCount = group.models.filter((m) =>
				currentCandidates.includes(m.modelId),
			).length;

			const item = listEl.createDiv({
				cls: "obsius-model-picker-item obsius-model-picker-provider",
			});

			const iconEl = item.createSpan({
				cls: "obsius-model-picker-provider-icon",
			});
			setIcon(iconEl, "chevron-right");

			const textEl = item.createDiv({
				cls: "obsius-model-picker-item-text",
			});
			textEl.createSpan({
				text: group.provider,
				cls: "obsius-model-picker-item-name",
			});
			textEl.createSpan({
				text: `${group.models.length} model${group.models.length !== 1 ? "s" : ""}${selectedCount > 0 ? ` \u00b7 ${selectedCount} selected` : ""}`,
				cls: "obsius-model-picker-item-desc",
			});

			item.addEventListener("click", () => {
				renderModels(group.models, group.provider);
			});
		}
	};

	const renderModels = (
		modelList: CachedModel[],
		providerName: string | null,
	) => {
		listEl.empty();

		if (providerName !== null && groups.length > 1) {
			const backItem = listEl.createDiv({
				cls: "obsius-model-picker-back",
			});
			const backIcon = backItem.createSpan({
				cls: "obsius-model-picker-back-icon",
			});
			setIcon(backIcon, "arrow-left");
			backItem.createSpan({ text: providerName });
			backItem.addEventListener("click", renderProviders);
		}

		const currentCandidates = plugin.settings.candidateModels?.[agentId] ?? [];

		for (const model of modelList) {
			const isSelected = currentCandidates.includes(model.modelId);
			const item = listEl.createDiv({
				cls: `obsius-model-picker-item${isSelected ? " is-selected" : ""}`,
			});

			const checkEl = item.createSpan({
				cls: "obsius-model-picker-check",
			});
			if (isSelected) {
				setIcon(checkEl, "check");
			}

			const slashIdx = model.name.indexOf("/");
			const displayName =
				slashIdx !== -1
					? model.name.substring(slashIdx + 1).trim()
					: model.name;

			const textEl = item.createDiv({
				cls: "obsius-model-picker-item-text",
			});
			textEl.createSpan({
				text: displayName,
				cls: "obsius-model-picker-item-name",
			});
			if (model.description) {
				textEl.createSpan({
					text: model.description,
					cls: "obsius-model-picker-item-desc",
				});
			}

			item.addEventListener("click", () => {
				void (async () => {
					const current = getValidCandidates(plugin, agentId, models);
					const next = isSelected
						? current.filter((id) => id !== model.modelId)
						: [...current, model.modelId];
					await saveCandidates(plugin, agentId, next);
					renderModels(modelList, providerName);
					onUpdate();
				})();
			});
		}
	};

	const onClickOutside = (e: MouseEvent) => {
		if (!picker.contains(e.target as Node)) {
			destroyPicker(picker);
		}
	};
	document.addEventListener("mousedown", onClickOutside, true);
	pickerCleanup.set(picker, () => {
		document.removeEventListener("mousedown", onClickOutside, true);
	});

	renderProviders();
}

// ============================================================================
// Mode → Model Mapping
// ============================================================================

function renderModeModelMapping(
	containerEl: HTMLElement,
	plugin: AgentClientPlugin,
	agentId: string,
	modes: CachedMode[],
	allModels: CachedModel[],
): void {
	new Setting(containerEl)
		.setName("Model per mode")
		.setDesc(
			"Optionally assign a default model for each mode. When switching modes in chat, the model will change automatically.",
		);

	const defaults = plugin.settings.modeModelDefaults?.[agentId] ?? {};
	const candidates = getValidCandidates(plugin, agentId, allModels);
	const modelMap = new Map(
		allModels.map((model) => [model.modelId, model] as const),
	);
	const dropdownModels =
		candidates.length > 0
			? candidates
					.map((modelId) => modelMap.get(modelId))
					.filter((model): model is CachedModel => model !== undefined)
			: [];

	const modeGroup = containerEl.createDiv({
		cls: "obsius-mode-model-group",
	});

	for (const mode of modes) {
		new Setting(modeGroup)
			.setName(mode.name)
			.setDesc(mode.description ?? "")
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"",
					dropdownModels.length > 0 ? "(auto)" : "(empty)",
				);
				for (const model of dropdownModels) {
					dropdown.addOption(model.modelId, model.name);
				}
				dropdown.setValue(defaults[mode.id] ?? "");
				dropdown.onChange((value) => {
					const current = plugin.settings.modeModelDefaults?.[agentId] ?? {};
					let modeDefaults: Record<string, string>;
					if (value === "") {
						modeDefaults = { ...current };
						delete modeDefaults[mode.id];
					} else {
						modeDefaults = { ...current, [mode.id]: value };
					}
					void plugin.settingsStore.updateSettings({
						modeModelDefaults: {
							...plugin.settings.modeModelDefaults,
							[agentId]: modeDefaults,
						},
					});
				});
			});
	}
}
