import type { SecretStorage } from "obsidian";
import type { AgentClientPluginSettings } from "../plugin";

type BuiltInApiKeyAgent = "claude" | "codex" | "gemini";

const BUILTIN_API_KEY_SECRET_IDS: Record<BuiltInApiKeyAgent, string> = {
	claude: "obsius-claude-api-key",
	codex: "obsius-codex-api-key",
	gemini: "obsius-gemini-api-key",
};

export function setBuiltInApiKeySecret(
	secretStorage: SecretStorage,
	agent: BuiltInApiKeyAgent,
	apiKey: string,
): void {
	secretStorage.setSecret(BUILTIN_API_KEY_SECRET_IDS[agent], apiKey.trim());
}

export function getBuiltInApiKeySecret(
	secretStorage: SecretStorage,
	agent: BuiltInApiKeyAgent,
): string {
	return secretStorage.getSecret(BUILTIN_API_KEY_SECRET_IDS[agent]) ?? "";
}

export function getApiKeyForAgentId(
	secretStorage: SecretStorage,
	settings: AgentClientPluginSettings,
	agentId: string,
): string {
	if (agentId === settings.claude.id) {
		return getBuiltInApiKeySecret(secretStorage, "claude");
	}
	if (agentId === settings.codex.id) {
		return getBuiltInApiKeySecret(secretStorage, "codex");
	}
	if (agentId === settings.gemini.id) {
		return getBuiltInApiKeySecret(secretStorage, "gemini");
	}
	return "";
}
