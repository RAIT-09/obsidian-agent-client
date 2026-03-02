import type { SecretStorage } from "obsidian";
import type { AgentClientPluginSettings } from "../plugin";

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
