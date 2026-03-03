import type { AgentClientPluginSettings } from "../../plugin";
import type { BaseAgentSettings } from "../../domain/models/agent-config";
import { toAgentConfig } from "../../shared/settings-utils";

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
import type {
	SessionState,
	ChatSession,
} from "../../domain/models/chat-session";
import type { AgentInfo } from "./types";

export function getDefaultAgentId(settings: AgentClientPluginSettings): string {
	return settings.defaultAgentId || settings.claude.id;
}

export function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentInfo[] {
	return [
		{
			id: settings.opencode.id,
			displayName: settings.opencode.displayName || settings.opencode.id,
		},
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

export function getCurrentAgent(
	settings: AgentClientPluginSettings,
	agentId?: string,
): AgentInfo {
	const activeId = agentId || getDefaultAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

export function resolveExistingAgentId(
	settings: AgentClientPluginSettings,
	preferredAgentId?: string,
): string {
	const agents = getAvailableAgentsFromSettings(settings);

	if (
		preferredAgentId &&
		agents.some((agent) => agent.id === preferredAgentId)
	) {
		return preferredAgentId;
	}

	const defaultAgentId = getDefaultAgentId(settings);
	if (agents.some((agent) => agent.id === defaultAgentId)) {
		return defaultAgentId;
	}

	return agents[0]?.id ?? defaultAgentId;
}

export function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.opencode.id) {
		return settings.opencode;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

export function buildAgentConfigWithApiKey(
	settings: AgentClientPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
	apiKey: string,
	secretBindingEnv: Record<string, string>,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);
	const cleanedBaseEnv = removeKeychainOnlyEnv(baseConfig.env || {});
	const mergedEnv = {
		...cleanedBaseEnv,
		...secretBindingEnv,
	};

	if (agentId === settings.claude.id) {
		return {
			...baseConfig,
			env: {
				...mergedEnv,
				ANTHROPIC_API_KEY: apiKey,
			},
		};
	}
	if (agentId === settings.codex.id) {
		return {
			...baseConfig,
			env: {
				...mergedEnv,
				OPENAI_API_KEY: apiKey,
			},
		};
	}
	if (agentId === settings.gemini.id) {
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

export function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected" as SessionState,
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		models: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}
