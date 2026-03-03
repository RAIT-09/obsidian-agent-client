import { describe, expect, it } from "vitest";
import {
	getMigrationPath,
	hasMigrationPath,
	migrateSettings,
	registerMigration,
} from "../src/shared/settings-migrations";
import {
	createDefaultSettings,
	parseStoredSettings,
	SETTINGS_SCHEMA_VERSION,
} from "../src/shared/settings-schema";

describe("settings migrations", () => {
	it("accepts defaults at current schema version", () => {
		const defaults = createDefaultSettings();
		const result = parseStoredSettings(defaults);

		expect(result.resetReason).toBeUndefined();
		expect(result.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
	});

	it("resets when no migration path exists", () => {
		const data = { schemaVersion: 0, foo: "bar" };
		const result = parseStoredSettings(data);

		expect(result.resetReason).toContain("schema version mismatch");
		expect(result.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
	});

	it("resets for null/undefined input", () => {
		expect(parseStoredSettings(null).resetReason).toBeDefined();
		expect(parseStoredSettings(undefined).resetReason).toBeDefined();
	});

	it("migrateSettings applies registered migrations sequentially", () => {
		registerMigration(100, 101, (data) => ({
			...data,
			addedInV101: true,
		}));
		registerMigration(101, 102, (data) => ({
			...data,
			addedInV102: "hello",
		}));

		const input = { schemaVersion: 100, existing: "value" };
		const result = migrateSettings(input, 102);

		expect(result.migrated).toBe(true);
		expect(result.data.schemaVersion).toBe(102);
		expect(result.data.addedInV101).toBe(true);
		expect(result.data.addedInV102).toBe("hello");
		expect(result.data.existing).toBe("value");
	});

	it("migrateSettings returns unmigrated when already at target", () => {
		const input = { schemaVersion: 102 };
		const result = migrateSettings(input, 102);

		expect(result.migrated).toBe(false);
		expect(result.data.schemaVersion).toBe(102);
	});

	it("hasMigrationPath returns true for valid path", () => {
		expect(hasMigrationPath(100, 102)).toBe(true);
	});

	it("hasMigrationPath returns false for missing path", () => {
		expect(hasMigrationPath(50, 102)).toBe(false);
	});

	it("getMigrationPath returns full version chain", () => {
		expect(getMigrationPath(100, 102)).toEqual([100, 101, 102]);
	});

	it("getMigrationPath returns single entry when no path", () => {
		expect(getMigrationPath(50, 102)).toEqual([50]);
	});
});
