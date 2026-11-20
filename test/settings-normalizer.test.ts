import { describe, it, expect, vi } from "vitest";
import {
	absorbCustomAgents,
	normalizePresetAgents,
	defaultPresetAgentSettings,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
	resolveDefaultAgentId,
	type ApiKeyMigrator,
} from "../src/services/settings-normalizer";
import { PRESET_AGENTS } from "../src/services/preset-agents";
import type { CustomAgentSettings } from "../src/types/agent";

// Pass-through migrator: returns the stored secret id unchanged. Tests that
// exercise the migration chain use a vi.fn wrapper instead.
const noMigration: ApiKeyMigrator = ({ current }) => current;

const PRESET_IDS = PRESET_AGENTS.map((def) => def.presetId);

describe("normalizePresetAgents", () => {
	it("adds Antigravity defaults without replacing a configured Gemini preset", () => {
		const result = normalizePresetAgents(
			{
				presetAgents: {
					"gemini-cli": {
						command: "/opt/gemini",
						args: ["--experimental-acp"],
						apiKeySecretId: "gemini-secret",
					},
				},
			},
			PRESET_AGENTS,
			noMigration,
		);
		expect(result["antigravity-cli"]).toEqual({
			id: "antigravity-cli",
			displayName: "Antigravity CLI",
			command: "agy",
			args: ["acp"],
			apiKeySecretId: "",
			env: [],
			enabled: true,
		});
		expect(result["gemini-cli"]).toMatchObject({
			command: "/opt/gemini",
			args: ["--experimental-acp"],
			apiKeySecretId: "gemini-secret",
		});
	});

	it("migrates the legacy per-agent sub-objects with values preserved", () => {
		const raw = {
			claude: {
				id: "claude-code-acp",
				displayName: "My Claude",
				apiKeySecretId: "claude-secret",
				command: "/opt/claude-agent-acp",
				args: ["--verbose"],
				env: [{ key: "FOO", value: "bar" }],
			},
			codex: { command: "/opt/codex-acp" },
			gemini: { displayName: "Gemini" },
			mistralVibe: { args: ["--x"] },
		};
		const result = normalizePresetAgents(raw, PRESET_AGENTS, noMigration);

		expect(result["claude-code-acp"]).toEqual({
			id: "claude-code-acp",
			displayName: "My Claude",
			apiKeySecretId: "claude-secret",
			command: "/opt/claude-agent-acp",
			args: ["--verbose"],
			env: [{ key: "FOO", value: "bar" }],
			enabled: true,
		});
		expect(result["codex-acp"].command).toBe("/opt/codex-acp");
		expect(result["gemini-cli"].displayName).toBe("Gemini");
		expect(result["mistral-vibe"].args).toEqual(["--x"]);
	});

	it("respects the legacy top-level command-path keys", () => {
		const raw = {
			claudeCodeAcpCommandPath: "/legacy/claude-agent-acp",
			geminiCommandPath: "/legacy/gemini",
		};
		const result = normalizePresetAgents(raw, PRESET_AGENTS, noMigration);

		expect(result["claude-code-acp"].command).toBe(
			"/legacy/claude-agent-acp",
		);
		expect(result["gemini-cli"].command).toBe("/legacy/gemini");
		// A stored command wins over the legacy top-level key.
		const withStored = normalizePresetAgents(
			{ ...raw, claude: { command: "/stored/claude" } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(withStored["claude-code-acp"].command).toBe("/stored/claude");
	});

	it("backfills empty gemini args to the registry default", () => {
		const empty = normalizePresetAgents(
			{ gemini: { args: [] } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(empty["gemini-cli"].args).toEqual(["--experimental-acp"]);

		const whitespace = normalizePresetAgents(
			{ gemini: { args: ["  ", ""] } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(whitespace["gemini-cli"].args).toEqual(["--experimental-acp"]);

		const explicit = normalizePresetAgents(
			{ gemini: { args: ["--experimental-acp", "--foo"] } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(explicit["gemini-cli"].args).toEqual([
			"--experimental-acp",
			"--foo",
		]);
	});

	it("force-syncs the entry id to the record key, never from raw", () => {
		const fromNew = normalizePresetAgents(
			{ presetAgents: { "claude-code-acp": { id: "polluted" } } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(fromNew["claude-code-acp"].id).toBe("claude-code-acp");

		const fromLegacy = normalizePresetAgents(
			{ claude: { id: "claude" } },
			PRESET_AGENTS,
			noMigration,
		);
		expect(fromLegacy["claude-code-acp"].id).toBe("claude-code-acp");
	});

	it("prefers the new presetAgents record over legacy sub-objects, and falls back to registry defaults when both are absent", () => {
		const both = normalizePresetAgents(
			{
				presetAgents: { "claude-code-acp": { command: "/new/path" } },
				claude: { command: "/old/path" },
			},
			PRESET_AGENTS,
			noMigration,
		);
		expect(both["claude-code-acp"].command).toBe("/new/path");

		const neither = normalizePresetAgents({}, PRESET_AGENTS, noMigration);
		for (const def of PRESET_AGENTS) {
			expect(neither[def.presetId]).toEqual(
				defaultPresetAgentSettings(def),
			);
		}
	});

	it("preserves unknown presetIds (version skew) across a save round-trip, including fields this version doesn't know", () => {
		const raw = {
			presetAgents: {
				opencode: {
					id: "opencode",
					displayName: "OpenCode",
					apiKeySecretId: "",
					command: "opencode",
					args: ["acp"],
					env: [],
					enabled: false,
				},
			},
		};
		const first = normalizePresetAgents(raw, PRESET_AGENTS, noMigration);
		expect(first.opencode).toMatchObject({
			id: "opencode",
			displayName: "OpenCode",
			command: "opencode",
			args: ["acp"],
			enabled: false,
		});

		// Round-trip: what got saved is normalized again on next load.
		const second = normalizePresetAgents(
			{ presetAgents: first },
			PRESET_AGENTS,
			noMigration,
		);
		expect(second.opencode).toEqual(first.opencode);
	});

	it("defaults enabled to true and preserves an explicit false", () => {
		const result = normalizePresetAgents(
			{
				presetAgents: {
					"codex-acp": { enabled: false },
				},
			},
			PRESET_AGENTS,
			noMigration,
		);
		expect(result["claude-code-acp"].enabled).toBe(true);
		expect(result["codex-acp"].enabled).toBe(false);
	});

	it("routes legacy plaintext apiKeys through the injected migrator with registry wiring", () => {
		const migrate = vi.fn<ApiKeyMigrator>(({ def, legacyPlain }) =>
			legacyPlain ? `migrated-${def.presetId}` : "",
		);
		const result = normalizePresetAgents(
			{
				claude: { apiKey: "sk-plain-key" },
			},
			PRESET_AGENTS,
			migrate,
		);

		// Called once per preset with legacy wiring (all four originals).
		expect(migrate).toHaveBeenCalledTimes(4);
		const claudeCall = migrate.mock.calls.find(
			([args]) => args.def.presetId === "claude-code-acp",
		);
		expect(claudeCall).toBeDefined();
		expect(claudeCall?.[0]).toMatchObject({
			current: "",
			legacyPlain: "sk-plain-key",
		});
		// The registry carries the historic Notice label ("Claude", not
		// "Claude Code") so the migrator reproduces the exact user-facing text.
		expect(claudeCall?.[0].def.apiKey?.legacy?.noticeLabel).toBe("Claude");
		expect(result["claude-code-acp"].apiKeySecretId).toBe(
			"migrated-claude-code-acp",
		);
		expect(result["codex-acp"].apiKeySecretId).toBe("");
	});
});

describe("ensureUniqueCustomAgentIds with reserved ids", () => {
	const custom = (id: string): CustomAgentSettings => ({
		id,
		displayName: id,
		command: "cmd",
		args: [],
		env: [],
	});

	it("suffix-renames a custom agent colliding with a preset id", () => {
		const result = ensureUniqueCustomAgentIds(
			[custom("claude-code-acp"), custom("my-agent")],
			PRESET_IDS,
		);
		expect(result.map((a) => a.id)).toEqual([
			"claude-code-acp-2",
			"my-agent",
		]);
	});

	it("keeps repairing duplicates among customs themselves", () => {
		const result = ensureUniqueCustomAgentIds(
			[custom("dup"), custom("dup")],
			PRESET_IDS,
		);
		expect(result.map((a) => a.id)).toEqual(["dup", "dup-2"]);
	});
});

describe("absorbCustomAgents", () => {
	it("keeps Antigravity customs separate and suffix-renames a preset-id collision", () => {
		const configured = {
			id: "antigravity-cli",
			displayName: "My Antigravity",
			command: "/opt/agy",
			args: ["acp", "--sandbox"],
			env: [{ key: "EXAMPLE", value: "value" }],
			enabled: false,
		};
		const result = absorbCustomAgents(
			{ customAgents: [configured] },
			PRESET_AGENTS,
		);
		expect(result.absorbed).toEqual([]);
		expect(result.presetAgents["antigravity-cli"]).toBeUndefined();
		const customs = ensureUniqueCustomAgentIds(
			result.customAgents.map((entry) =>
				normalizeCustomAgent(entry as Record<string, unknown>),
			),
			PRESET_IDS,
		);
		expect(customs).toEqual([{ ...configured, id: "antigravity-cli-2" }]);
	});

	const docsAdvisedCustom = {
		id: "opencode",
		displayName: "My OpenCode",
		command: "/opt/opencode",
		args: ["acp", "--verbose"],
		env: [{ key: "FOO", value: "bar" }],
		enabled: false,
	};

	it("adopts the docs-advised custom as the preset's raw source", () => {
		const raw = {
			customAgents: [docsAdvisedCustom, { id: "my-agent" }],
		};
		const result = absorbCustomAgents(raw, PRESET_AGENTS);

		expect(result.absorbed).toEqual([
			{ presetId: "opencode", displayName: "OpenCode" },
		]);
		expect(result.customAgents).toEqual([{ id: "my-agent" }]);
		expect(result.presetAgents.opencode).toBe(docsAdvisedCustom);

		// The adopted entry goes through the usual preset normalization:
		// id force-synced, apiKeySecretId defaulted, values preserved.
		const normalized = normalizePresetAgents(
			{ presetAgents: result.presetAgents },
			PRESET_AGENTS,
			noMigration,
		);
		expect(normalized.opencode).toEqual({
			id: "opencode",
			displayName: "My OpenCode",
			apiKeySecretId: "",
			command: "/opt/opencode",
			args: ["acp", "--verbose"],
			env: [{ key: "FOO", value: "bar" }],
			enabled: false,
		});
	});

	it("absorbs the docs-advised kiro-cli custom the same way", () => {
		const kiroCustom = {
			id: "kiro-cli",
			displayName: "My Kiro",
			command: "/opt/kiro-cli",
			args: ["acp"],
			env: [{ key: "KIRO_LOG_LEVEL", value: "debug" }],
		};
		const result = absorbCustomAgents(
			{ customAgents: [kiroCustom] },
			PRESET_AGENTS,
		);
		expect(result.absorbed).toEqual([
			{ presetId: "kiro-cli", displayName: "Kiro" },
		]);
		expect(result.customAgents).toEqual([]);
		expect(result.presetAgents["kiro-cli"]).toBe(kiroCustom);
	});

	it("skips when the preset already has a stored entry", () => {
		const raw = {
			presetAgents: { opencode: { command: "opencode" } },
			customAgents: [docsAdvisedCustom],
		};
		const result = absorbCustomAgents(raw, PRESET_AGENTS);
		// The colliding custom is left for the "{id}-2" rename instead.
		expect(result.absorbed).toEqual([]);
		expect(result.customAgents).toEqual([docsAdvisedCustom]);
		expect(result.presetAgents.opencode).toEqual({ command: "opencode" });
	});

	it("is a no-op without a matching custom", () => {
		const raw = { customAgents: [{ id: "my-agent" }] };
		const result = absorbCustomAgents(raw, PRESET_AGENTS);
		expect(result.absorbed).toEqual([]);
		expect(result.customAgents).toEqual([{ id: "my-agent" }]);
	});

	it("never absorbs into presets without the declaration", () => {
		const raw = {
			customAgents: [{ id: "mistral-vibe", command: "x" }],
		};
		const result = absorbCustomAgents(raw, PRESET_AGENTS);
		expect(result.absorbed).toEqual([]);
		expect(result.customAgents).toHaveLength(1);
	});

	it("is idempotent across a save round-trip", () => {
		const first = absorbCustomAgents(
			{ customAgents: [docsAdvisedCustom] },
			PRESET_AGENTS,
		);
		expect(first.absorbed).toHaveLength(1);

		const second = absorbCustomAgents(
			{
				customAgents: first.customAgents,
				presetAgents: first.presetAgents,
			},
			PRESET_AGENTS,
		);
		expect(second.absorbed).toEqual([]);
		expect(second.presetAgents.opencode).toBe(docsAdvisedCustom);
	});

	it("backfills empty absorbed args to the registry default", () => {
		const result = absorbCustomAgents(
			{
				customAgents: [
					{ id: "opencode", command: "opencode", args: [] },
				],
			},
			PRESET_AGENTS,
		);
		const normalized = normalizePresetAgents(
			{ presetAgents: result.presetAgents },
			PRESET_AGENTS,
			noMigration,
		);
		expect(normalized.opencode.args).toEqual(["acp"]);
	});
});

describe("normalizeCustomAgent", () => {
	it("defaults enabled to true and preserves an explicit false", () => {
		expect(normalizeCustomAgent({ id: "a" }).enabled).toBe(true);
		expect(normalizeCustomAgent({ id: "a", enabled: false }).enabled).toBe(
			false,
		);
	});
});

describe("resolveDefaultAgentId", () => {
	const available = ["claude-code-acp", "codex-acp", "my-custom"];

	it("keeps a stored defaultAgentId that is available", () => {
		expect(
			resolveDefaultAgentId({ defaultAgentId: "my-custom" }, available),
		).toBe("my-custom");
	});

	it("migrates the old activeAgentId name", () => {
		expect(
			resolveDefaultAgentId({ activeAgentId: "codex-acp" }, available),
		).toBe("codex-acp");
	});

	it("prefers defaultAgentId over activeAgentId", () => {
		expect(
			resolveDefaultAgentId(
				{ defaultAgentId: "codex-acp", activeAgentId: "my-custom" },
				available,
			),
		).toBe("codex-acp");
	});

	it("falls back to the first available id when unset or unknown", () => {
		expect(resolveDefaultAgentId({}, available)).toBe("claude-code-acp");
		expect(
			resolveDefaultAgentId({ defaultAgentId: "ghost" }, available),
		).toBe("claude-code-acp");
	});
});
