import { describe, it, expect } from "vitest";
import {
	getDefaultAgentId,
	getAvailableAgentsFromSettings,
	getAllAgentsFromSettings,
	getCurrentAgent,
	findAgentSettings,
	buildAgentConfigWithApiKey,
	isAgentEnabled,
	firstEnabledAgentId,
	repairNoEnabledAgents,
} from "../src/services/session-helpers";
import type { AgentClientPluginSettings } from "../src/plugin";
import type {
	PresetAgentUserSettings,
	CustomAgentSettings,
} from "../src/types/agent";

// Characterization tests: every expected value below is a string literal,
// deliberately NOT derived from PRESET_AGENTS. A transcription mistake in the
// registry (wrong id, wrong env var, wrong order) must fail here.

const preset = (
	id: string,
	displayName: string,
	command: string,
	overrides: Partial<PresetAgentUserSettings> = {},
): PresetAgentUserSettings => ({
	id,
	displayName,
	apiKeySecretId: "",
	command,
	args: [],
	env: [],
	...overrides,
});

const custom = (id: string, displayName: string): CustomAgentSettings => ({
	id,
	displayName,
	command: "my-cmd",
	args: [],
	env: [],
});

function makeSettings(
	overrides: Partial<AgentClientPluginSettings> = {},
): AgentClientPluginSettings {
	return {
		presetAgents: {
			"claude-code-acp": preset(
				"claude-code-acp",
				"Claude Code",
				"claude-agent-acp",
			),
			"codex-acp": preset("codex-acp", "Codex", "codex-acp"),
			"gemini-cli": preset("gemini-cli", "Gemini CLI", "gemini", {
				args: ["--experimental-acp"],
			}),
			"mistral-vibe": preset("mistral-vibe", "Mistral Vibe", "vibe-acp"),
			opencode: preset("opencode", "OpenCode", "opencode", {
				args: ["acp"],
			}),
			"kiro-cli": preset("kiro-cli", "Kiro", "kiro-cli", {
				args: ["acp"],
			}),
			"hermes-agent": preset("hermes-agent", "Hermes Agent", "hermes", {
				args: ["acp"],
			}),
			"grok-build": preset("grok-build", "Grok Build", "grok", {
				args: ["agent", "stdio"],
			}),
		},
		customAgents: [],
		defaultAgentId: "",
		...overrides,
	} as AgentClientPluginSettings;
}

describe("getAvailableAgentsFromSettings", () => {
	it("enumerates the presets in registry order, then customs", () => {
		const settings = makeSettings({
			customAgents: [custom("my-custom", "My Custom")],
		});
		expect(getAvailableAgentsFromSettings(settings)).toEqual([
			{ id: "claude-code-acp", displayName: "Claude Code" },
			{ id: "codex-acp", displayName: "Codex" },
			{ id: "gemini-cli", displayName: "Gemini CLI" },
			{ id: "mistral-vibe", displayName: "Mistral Vibe" },
			{ id: "opencode", displayName: "OpenCode" },
			{ id: "kiro-cli", displayName: "Kiro" },
			{ id: "hermes-agent", displayName: "Hermes Agent" },
			{ id: "grok-build", displayName: "Grok Build" },
			{ id: "my-custom", displayName: "My Custom" },
		]);
	});

	it("falls back to the id when a displayName is empty", () => {
		const settings = makeSettings();
		settings.presetAgents["codex-acp"].displayName = "";
		const agents = getAvailableAgentsFromSettings(settings);
		expect(agents[1]).toEqual({
			id: "codex-acp",
			displayName: "codex-acp",
		});
	});

	it("excludes disabled presets and customs; undefined means enabled", () => {
		const settings = makeSettings({
			customAgents: [
				custom("my-custom", "My Custom"),
				{ ...custom("off-custom", "Off Custom"), enabled: false },
			],
		});
		settings.presetAgents["codex-acp"].enabled = false;
		settings.presetAgents["claude-code-acp"].enabled = true;
		expect(
			getAvailableAgentsFromSettings(settings).map((a) => a.id),
		).toEqual([
			"claude-code-acp",
			"gemini-cli",
			"mistral-vibe",
			"opencode",
			"kiro-cli",
			"hermes-agent",
			"grok-build",
			"my-custom",
		]);
	});
});

describe("getAllAgentsFromSettings", () => {
	it("includes disabled agents (unfiltered contract for command registration)", () => {
		const settings = makeSettings({
			customAgents: [
				{ ...custom("off-custom", "Off Custom"), enabled: false },
			],
		});
		settings.presetAgents["codex-acp"].enabled = false;
		expect(getAllAgentsFromSettings(settings)).toEqual([
			{ id: "claude-code-acp", displayName: "Claude Code" },
			{ id: "codex-acp", displayName: "Codex" },
			{ id: "gemini-cli", displayName: "Gemini CLI" },
			{ id: "mistral-vibe", displayName: "Mistral Vibe" },
			{ id: "opencode", displayName: "OpenCode" },
			{ id: "kiro-cli", displayName: "Kiro" },
			{ id: "hermes-agent", displayName: "Hermes Agent" },
			{ id: "grok-build", displayName: "Grok Build" },
			{ id: "off-custom", displayName: "Off Custom" },
		]);
	});
});

describe("enabled helpers", () => {
	it("isAgentEnabled treats only explicit false as disabled", () => {
		expect(isAgentEnabled({})).toBe(true);
		expect(isAgentEnabled({ enabled: true })).toBe(true);
		expect(isAgentEnabled({ enabled: false })).toBe(false);
	});

	it("firstEnabledAgentId walks presets in registry order, then customs", () => {
		const settings = makeSettings({
			customAgents: [custom("my-custom", "My Custom")],
		});
		expect(firstEnabledAgentId(settings)).toBe("claude-code-acp");

		settings.presetAgents["claude-code-acp"].enabled = false;
		expect(firstEnabledAgentId(settings)).toBe("codex-acp");

		for (const entry of Object.values(settings.presetAgents)) {
			entry.enabled = false;
		}
		expect(firstEnabledAgentId(settings)).toBe("my-custom");

		settings.customAgents[0].enabled = false;
		// Backstop when everything is disabled (repair prevents persisting).
		expect(firstEnabledAgentId(settings)).toBe("claude-code-acp");
	});

	it("repairNoEnabledAgents re-enables the first preset only when everything is disabled", () => {
		const healthy = makeSettings();
		expect(repairNoEnabledAgents(healthy)).toBeNull();

		const broken = makeSettings();
		for (const entry of Object.values(broken.presetAgents)) {
			entry.enabled = false;
		}
		const repaired = repairNoEnabledAgents(broken);
		expect(repaired?.["claude-code-acp"].enabled).toBe(true);
		expect(repaired?.["codex-acp"].enabled).toBe(false);
	});
});

describe("findAgentSettings", () => {
	it("resolves a preset before a custom agent with the same id", () => {
		const settings = makeSettings({
			customAgents: [custom("gemini-cli", "Shadowed Custom")],
		});
		const found = findAgentSettings(settings, "gemini-cli");
		expect(found?.displayName).toBe("Gemini CLI");
	});

	it("resolves custom agents and returns null for unknown ids", () => {
		const settings = makeSettings({
			customAgents: [custom("my-custom", "My Custom")],
		});
		expect(findAgentSettings(settings, "my-custom")?.displayName).toBe(
			"My Custom",
		);
		expect(findAgentSettings(settings, "ghost")).toBeNull();
	});

	it("does not let a preserved unknown presetAgents entry shadow a same-id custom", () => {
		const settings = makeSettings({
			customAgents: [custom("future-preset", "My Future Agent")],
		});
		settings.presetAgents["future-preset"] = preset(
			"future-preset",
			"Stale Synced Entry",
			"future-preset",
		);
		expect(findAgentSettings(settings, "future-preset")?.displayName).toBe(
			"My Future Agent",
		);
	});

	it("resolves disabled agents (disabling filters enumeration, not resolution)", () => {
		const settings = makeSettings();
		settings.presetAgents["gemini-cli"].enabled = false;
		expect(findAgentSettings(settings, "gemini-cli")?.displayName).toBe(
			"Gemini CLI",
		);
	});
});

describe("getCurrentAgent", () => {
	it("keeps the display name of a disabled agent", () => {
		const settings = makeSettings();
		settings.presetAgents["gemini-cli"].enabled = false;
		expect(getCurrentAgent(settings, "gemini-cli")).toEqual({
			id: "gemini-cli",
			displayName: "Gemini CLI",
		});
	});

	it("degrades to the raw id for unknown agents", () => {
		expect(getCurrentAgent(makeSettings(), "ghost")).toEqual({
			id: "ghost",
			displayName: "ghost",
		});
	});
});

describe("buildAgentConfigWithApiKey", () => {
	it.each([
		["claude-code-acp", "ANTHROPIC_API_KEY"],
		["codex-acp", "OPENAI_API_KEY"],
		["gemini-cli", "GEMINI_API_KEY"],
		["mistral-vibe", "MISTRAL_API_KEY"],
		["kiro-cli", "KIRO_API_KEY"],
		["grok-build", "XAI_API_KEY"],
	])("attaches the %s secret as %s", (agentId, envVarName) => {
		const agentSettings = preset(agentId, "Name", "cmd", {
			apiKeySecretId: "my-secret",
		});
		const config = buildAgentConfigWithApiKey(
			agentSettings,
			agentId,
			"/wd",
		);
		expect(config).toMatchObject({
			id: agentId,
			workingDirectory: "/wd",
			apiKey: { secretId: "my-secret", envVarName },
		});
	});

	it("skips API key wiring when no secret is configured", () => {
		const agentSettings = preset("claude-code-acp", "Claude Code", "cmd");
		const config = buildAgentConfigWithApiKey(
			agentSettings,
			"claude-code-acp",
			"/wd",
		);
		expect(config).not.toHaveProperty("apiKey");
	});

	it("passes custom agents through without API key injection", () => {
		const config = buildAgentConfigWithApiKey(
			custom("my-custom", "My Custom"),
			"my-custom",
			"/wd",
		);
		expect(config).not.toHaveProperty("apiKey");
	});
});

describe("getDefaultAgentId", () => {
	it("returns the stored default when set", () => {
		expect(
			getDefaultAgentId(makeSettings({ defaultAgentId: "codex-acp" })),
		).toBe("codex-acp");
	});

	it("falls back to the first preset when unset", () => {
		expect(getDefaultAgentId(makeSettings())).toBe("claude-code-acp");
	});

	it("falls back to the first enabled agent when the stored default is disabled", () => {
		const settings = makeSettings({ defaultAgentId: "claude-code-acp" });
		settings.presetAgents["claude-code-acp"].enabled = false;
		expect(getDefaultAgentId(settings)).toBe("codex-acp");
	});
});
