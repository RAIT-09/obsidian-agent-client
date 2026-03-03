import { AcpAdapter } from "../adapters/acp/acp.adapter";
import {
	getApiKeyForAgentId,
	getSecretBindingEnvForAgentId,
} from "../adapters/obsidian/secret-storage.adapter";
import type { BaseAgentSettings } from "../domain/models/agent-config";
import type { AgentConfig } from "../domain/ports/agent-client.port";
import type AgentClientPlugin from "../plugin";
import { toAgentConfig } from "../shared/settings-utils";
import { resolveVaultBasePath } from "../shared/vault-path";

const KEYCHAIN_ONLY_ENV_KEYS = new Set([
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
]);

function removeKeychainOnlyEnv(
	env: Record<string, string>,
): Record<string, string> {
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (KEYCHAIN_ONLY_ENV_KEYS.has(key)) {
			continue;
		}
		cleaned[key] = value;
	}
	return cleaned;
}

function getAgentSettingsById(
	plugin: AgentClientPlugin,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === plugin.settings.claude.id) {
		return plugin.settings.claude;
	}
	if (agentId === plugin.settings.opencode.id) {
		return plugin.settings.opencode;
	}
	if (agentId === plugin.settings.codex.id) {
		return plugin.settings.codex;
	}
	if (agentId === plugin.settings.gemini.id) {
		return plugin.settings.gemini;
	}
	return (
		plugin.settings.customAgents.find((agent) => agent.id === agentId) || null
	);
}

function buildAgentConfigForCatalog(
	plugin: AgentClientPlugin,
	agentId: string,
): AgentConfig | null {
	const agentSettings = getAgentSettingsById(plugin, agentId);
	if (!agentSettings) {
		return null;
	}

	const workingDirectory = resolveVaultBasePath(plugin.app);
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);
	const apiKey = getApiKeyForAgentId(
		plugin.app.secretStorage,
		plugin.settings,
		agentId,
	);
	const secretBindingEnv = getSecretBindingEnvForAgentId(
		plugin.app.secretStorage,
		plugin.settings,
		agentId,
	);
	const mergedEnv = {
		...removeKeychainOnlyEnv(baseConfig.env || {}),
		...secretBindingEnv,
	};

	if (agentId === plugin.settings.claude.id) {
		return {
			...baseConfig,
			env: {
				...mergedEnv,
				ANTHROPIC_API_KEY: apiKey,
			},
		};
	}
	if (agentId === plugin.settings.codex.id) {
		return {
			...baseConfig,
			env: {
				...mergedEnv,
				OPENAI_API_KEY: apiKey,
			},
		};
	}
	if (agentId === plugin.settings.gemini.id) {
		return {
			...baseConfig,
			env: {
				...mergedEnv,
				GEMINI_API_KEY: apiKey,
			},
		};
	}

	return {
		...baseConfig,
		env: mergedEnv,
	};
}

export async function refreshAgentCatalogForPlugin(
	plugin: AgentClientPlugin,
	inFlight: Map<string, Promise<boolean>>,
	agentId: string,
	options?: { force?: boolean },
): Promise<boolean> {
	const existingModels = plugin.settings.cachedAgentModels?.[agentId];
	const existingModes = plugin.settings.cachedAgentModes?.[agentId];
	if (
		!options?.force &&
		(existingModels?.length ?? 0) > 0 &&
		(existingModes?.length ?? 0) > 0
	) {
		return true;
	}

	const activeTask = inFlight.get(agentId);
	if (activeTask) {
		return activeTask;
	}

	const task = (async (): Promise<boolean> => {
		const config = buildAgentConfigForCatalog(plugin, agentId);
		if (!config) {
			return false;
		}

		const adapter = new AcpAdapter(plugin);
		try {
			await adapter.initialize(config);
			const session = await adapter.newSession(config.workingDirectory);
			await plugin.settingsStore.updateSettings({
				cachedAgentModels: {
					...plugin.settings.cachedAgentModels,
					[agentId]: session.models
						? session.models.availableModels.map((model) => ({
								modelId: model.modelId,
								name: model.name,
								description: model.description,
							}))
						: [],
				},
				cachedAgentModes: {
					...plugin.settings.cachedAgentModes,
					[agentId]: session.modes
						? session.modes.availableModes.map((mode) => ({
								id: mode.id,
								name: mode.name,
								description: mode.description,
							}))
						: [],
				},
			});
			return true;
		} catch (error) {
			console.warn(
				`[AgentClient] Failed to refresh model/mode catalog for agent "${agentId}":`,
				error,
			);
			return false;
		} finally {
			try {
				await adapter.disconnect();
			} catch {
				void 0;
			}
		}
	})().finally(() => {
		inFlight.delete(agentId);
	});

	inFlight.set(agentId, task);
	return await task;
}
