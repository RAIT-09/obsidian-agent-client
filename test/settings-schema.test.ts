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
	});

	it("defaults allowTerminalCommands to false when missing", () => {
		const defaults = createDefaultSettings();
		const legacyLike = { ...defaults } as Record<string, unknown>;
		delete legacyLike.allowTerminalCommands;

		const result = parseStoredSettings(legacyLike);
		expect(result.resetReason).toBeUndefined();
		expect(result.settings.allowTerminalCommands).toBe(false);
	});
});
