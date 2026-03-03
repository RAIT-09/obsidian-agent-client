import { Setting } from "obsidian";
import type AgentClientPlugin from "../../../plugin";
import {
	type CachedModel,
	getValidCandidates,
	renderCandidateModelPicker,
} from "./model-candidate-picker";

interface CachedMode {
	id: string;
	name: string;
	description?: string;
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
	const root = containerEl.createDiv({ cls: "obsius-model-prefs-root" });

	const renderReadyState = (): void => {
		root.empty();
		const models = plugin.settings.cachedAgentModels?.[agentId];
		if (!models || models.length === 0) {
			return;
		}

		const modes = plugin.settings.cachedAgentModes?.[agentId];
		let modeMappingContainer: HTMLElement | null = null;
		const renderModeMapping = () => {
			if (!modeMappingContainer) return;
			modeMappingContainer.empty();
			if (modes && modes.length > 0) {
				renderModeModelMapping(
					modeMappingContainer,
					plugin,
					agentId,
					modes,
					models,
				);
			}
		};

		renderCandidateModelPicker(root, plugin, agentId, models, renderModeMapping);
		modeMappingContainer = root.createDiv();
		renderModeMapping();
	};

	const renderLoadingState = (message: string): HTMLButtonElement => {
		root.empty();
		const loading = new Setting(root)
			.setName("Model preferences")
			.setDesc(message)
			.addButton((button) => {
				button.setButtonText("Retry");
				button.onClick(() => {
					void loadCatalog(true);
				});
			});
		return loading.controlEl.querySelector("button") as HTMLButtonElement;
	};

	const loadCatalog = async (force: boolean): Promise<void> => {
		const settingsPlugin = plugin as AgentClientPlugin & {
			refreshAgentCatalog?: (
				targetAgentId: string,
				options?: { force?: boolean },
			) => Promise<boolean>;
		};
		if (typeof settingsPlugin.refreshAgentCatalog !== "function") {
			return;
		}

		const retryButton = renderLoadingState("Loading models and modes...");
		retryButton.disabled = true;
		const loaded = await settingsPlugin.refreshAgentCatalog(agentId, { force });
		if (loaded && (plugin.settings.cachedAgentModels?.[agentId]?.length ?? 0) > 0) {
			renderReadyState();
			return;
		}
		renderLoadingState(
			"No models found yet. Verify the command and authentication, then retry.",
		);
	};

	const models = plugin.settings.cachedAgentModels?.[agentId];
	if (models && models.length > 0) {
		renderReadyState();
		return;
	}

	void loadCatalog(false);
}

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
