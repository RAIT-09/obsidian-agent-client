import { describe, expect, it } from "vitest";
import {
	createDefaultSettings,
	parseStoredSettings,
	SETTINGS_SCHEMA_VERSION,
} from "../src/shared/settings-schema";

describe("settings schema", () => {
	it("accepts defaults at current schema version", () => {
		const defaults = createDefaultSettings();
		const result = parseStoredSettings(defaults);

		expect(result.resetReason).toBeUndefined();
		expect(result.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
		expect(result.settings.terminalPermissionMode).toBe("disabled");
		expect(result.settings.secretBindings).toEqual([]);
		expect(result.settings.gemini.secretBindings).toEqual([]);
	});

	it("resets settings when schema version does not match current version", () => {
		const defaults = createDefaultSettings();
		const oldVersionData = {
			...defaults,
			schemaVersion: SETTINGS_SCHEMA_VERSION - 1,
		} as Record<string, unknown>;

		const result = parseStoredSettings(oldVersionData);
		expect(result.resetReason).toContain("schema version mismatch");
		expect(result.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
		expect(result.settings.terminalPermissionMode).toBe("disabled");
	});

	it("backfills missing secretBindings arrays", () => {
		const defaults = createDefaultSettings();
		const legacy = {
			...defaults,
			claude: { ...defaults.claude },
			codex: { ...defaults.codex },
			gemini: { ...defaults.gemini },
			opencode: { ...defaults.opencode },
			customAgents: [
				{
					id: "custom-1",
					displayName: "Custom 1",
					command: "custom",
					args: [],
					env: [],
				},
			],
		} as Record<string, unknown>;
		delete (legacy.claude as Record<string, unknown>).secretBindings;
		delete (legacy.codex as Record<string, unknown>).secretBindings;
		delete (legacy.gemini as Record<string, unknown>).secretBindings;
		delete (legacy.opencode as Record<string, unknown>).secretBindings;
		delete legacy.secretBindings;

		const result = parseStoredSettings(legacy);

		expect(result.resetReason).toBeUndefined();
		expect(result.settings.secretBindings).toEqual([]);
		expect(result.settings.claude.secretBindings).toEqual([]);
		expect(result.settings.customAgents[0].secretBindings).toEqual([]);
	});
});
