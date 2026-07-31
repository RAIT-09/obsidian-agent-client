import { describe, expect, it } from "vitest";
import type { AgentClientPluginSettings } from "../src/plugin";
import type { MiniMaxAgentSettings } from "../src/types/agent";
import {
	buildAgentConfigWithApiKey,
	findAgentSettings,
	getAvailableAgentsFromSettings,
} from "../src/services/session-helpers";

const minimax: MiniMaxAgentSettings = {
	id: "minimax",
	displayName: "MiniMax",
	apiKeySecretId: "minimax-key",
	command: "claude-agent-acp",
	args: [],
	env: [
		{
			key: "ANTHROPIC_BASE_URL",
			value: "https://api.minimax.io/anthropic",
		},
		{ key: "ANTHROPIC_MODEL", value: "MiniMax-M3" },
	],
};

const settings = {
	minimax,
	claude: { id: "agent-a", displayName: "Agent A" },
	codex: { id: "agent-b", displayName: "Agent B" },
	gemini: { id: "agent-c", displayName: "Agent C" },
	customAgents: [],
	defaultAgentId: minimax.id,
} as AgentClientPluginSettings;

describe("MiniMax agent profile", () => {
	it("is available and resolves to its settings", () => {
		expect(getAvailableAgentsFromSettings(settings)).toContainEqual({
			id: "minimax",
			displayName: "MiniMax",
		});
		expect(findAgentSettings(settings, "minimax")).toBe(minimax);
	});

	it("keeps the endpoint and model defaults while injecting the API key", () => {
		expect(
			buildAgentConfigWithApiKey(settings, minimax, minimax.id, "/vault"),
		).toEqual({
			id: "minimax",
			displayName: "MiniMax",
			command: "claude-agent-acp",
			args: [],
			env: {
				ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
				ANTHROPIC_MODEL: "MiniMax-M3",
			},
			workingDirectory: "/vault",
			apiKey: {
				secretId: "minimax-key",
				envVarName: "ANTHROPIC_API_KEY",
			},
		});
	});
});
