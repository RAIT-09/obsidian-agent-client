import type { SecretStorage } from "obsidian";
import type { BaseAgentSettings } from "../../domain/models/agent-config";
import type { AgentClientPluginSettings } from "../../plugin";

type BuiltInApiKeyAgent = "claude" | "codex" | "gemini";

export function getBuiltInApiKeySecret(
	secretStorage: SecretStorage,
	secretId: string,
): string {
	return secretStorage.getSecret(secretId) ?? "";
}

export function getBuiltInApiKeySecretId(
	settings: AgentClientPluginSettings,
	agent: BuiltInApiKeyAgent,
): string {
	switch (agent) {
		case "claude":
			return settings.claude.apiKeySecretId;
		case "codex":
			return settings.codex.apiKeySecretId;
		case "gemini":
			return settings.gemini.apiKeySecretId;
	}
}

export function getApiKeyForAgentId(
	secretStorage: SecretStorage,
	settings: AgentClientPluginSettings,
	agentId: string,
): string {
	if (agentId === settings.claude.id) {
		return getBuiltInApiKeySecret(
			secretStorage,
			settings.claude.apiKeySecretId,
		);
	}
	if (agentId === settings.codex.id) {
		return getBuiltInApiKeySecret(secretStorage, settings.codex.apiKeySecretId);
	}
	if (agentId === settings.gemini.id) {
		return getBuiltInApiKeySecret(
			secretStorage,
			settings.gemini.apiKeySecretId,
		);
	}
	return "";
}

function resolveAgentSettingsById(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	if (agentId === settings.opencode.id) {
		return settings.opencode;
	}
	return settings.customAgents.find((agent) => agent.id === agentId) || null;
}

export function getSecretBindingEnvForAgentId(
	secretStorage: SecretStorage,
	settings: AgentClientPluginSettings,
	agentId: string,
): Record<string, string> {
	const agent = resolveAgentSettingsById(settings, agentId);
	const bindings = [
		...(settings.secretBindings || []),
		...(agent?.secretBindings || []),
	];
	if (bindings.length === 0) {
		return {};
	}

	const env: Record<string, string> = {};
	for (const binding of bindings) {
		const envKey = binding.envKey?.trim();
		const secretId = binding.secretId?.trim();
		if (!envKey || !secretId) {
			continue;
		}
		const value = secretStorage.getSecret(secretId);
		if (typeof value === "string" && value.length > 0) {
			env[envKey] = value;
		}
	}
	return env;
}
