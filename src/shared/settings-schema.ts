import { z } from "zod";
import type {
	AgentClientPluginSettings,
	ChatViewLocation,
	SendMessageShortcut,
} from "../plugin";
import { hasMigrationPath, migrateSettings } from "./settings-migrations";

export const SETTINGS_SCHEMA_VERSION = 6;

const sendMessageShortcutSchema = z.union([
	z.literal("enter"),
	z.literal("cmd-enter"),
]) satisfies z.ZodType<SendMessageShortcut>;

const chatViewLocationSchema = z.union([
	z.literal("right-tab"),
	z.literal("right-split"),
	z.literal("editor-tab"),
	z.literal("editor-split"),
]) satisfies z.ZodType<ChatViewLocation>;

const envVarSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});

const commonAgentSettingsSchema = z.object({
	id: z.string().min(1),
	displayName: z.string().min(1),
	command: z.string(),
	args: z.array(z.string()),
	env: z.array(envVarSchema),
});
const apiKeyAgentSettingsSchema = commonAgentSettingsSchema.extend({
	apiKeySecretId: z.string().regex(/^[a-z0-9-]+$/),
});

const displaySettingsSchema = z.object({
	autoCollapseDiffs: z.boolean(),
	diffCollapseThreshold: z.number().int().positive(),
	maxNoteLength: z.number().int().min(1),
	maxSelectionLength: z.number().int().min(1),
	fontSize: z.number().int().min(10).max(30).nullable(),
	completionSound: z.boolean(),
});

const savedSessionSchema = z.object({
	sessionId: z.string().min(1),
	agentId: z.string().min(1),
	cwd: z.string().min(1),
	title: z.string().optional(),
	createdAt: z.string().min(1),
	updatedAt: z.string().min(1),
});

const settingsSchema = z.object({
	schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
	claude: apiKeyAgentSettingsSchema,
	codex: apiKeyAgentSettingsSchema,
	gemini: apiKeyAgentSettingsSchema,
	opencode: commonAgentSettingsSchema,
	customAgents: z.array(commonAgentSettingsSchema),
	defaultAgentId: z.string().min(1),
	autoAllowPermissions: z.boolean(),
	autoMentionActiveNote: z.boolean(),
	debugMode: z.boolean(),
	nodePath: z.string(),
	windowsWslMode: z.boolean(),
	windowsWslDistribution: z.string().optional(),
	sendMessageShortcut: sendMessageShortcutSchema,
	chatViewLocation: chatViewLocationSchema,
	displaySettings: displaySettingsSchema,
	savedSessions: z.array(savedSessionSchema),
	lastUsedModels: z.record(z.string(), z.string()),
	candidateModels: z.record(z.string(), z.array(z.string())).optional(),
	cachedAgentModels: z
		.record(
			z.string(),
			z.array(
				z.object({
					modelId: z.string(),
					name: z.string(),
					description: z.string().optional(),
				}),
			),
		)
		.optional(),
	cachedAgentModes: z
		.record(
			z.string(),
			z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					description: z.string().optional(),
				}),
			),
		)
		.optional(),
	modeModelDefaults: z
		.record(z.string(), z.record(z.string(), z.string()))
		.optional(),
	lastModeModels: z
		.record(z.string(), z.record(z.string(), z.string()))
		.optional(),
}) satisfies z.ZodType<AgentClientPluginSettings>;

export const createDefaultSettings = (): AgentClientPluginSettings => ({
	schemaVersion: SETTINGS_SCHEMA_VERSION,
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKeySecretId: "obsius-claude-api-key",
		command: "",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKeySecretId: "obsius-codex-api-key",
		command: "",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKeySecretId: "obsius-gemini-api-key",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	opencode: {
		id: "opencode",
		displayName: "OpenCode",
		command: "",
		args: ["acp"],
		env: [],
	},
	customAgents: [],
	defaultAgentId: "opencode",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	debugMode: false,
	nodePath: "",
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
	chatViewLocation: "right-tab",
	displaySettings: {
		autoCollapseDiffs: false,
		diffCollapseThreshold: 10,
		maxNoteLength: 10000,
		maxSelectionLength: 10000,
		fontSize: null,
		completionSound: true,
	},
	savedSessions: [],
	lastUsedModels: {},
	candidateModels: {},
	cachedAgentModels: {},
	cachedAgentModes: {},
	modeModelDefaults: {},
	lastModeModels: {},
});

export function parseStoredSettings(raw: unknown): {
	settings: AgentClientPluginSettings;
	resetReason?: string;
	migrated?: boolean;
} {
	if (!raw || typeof raw !== "object") {
		return {
			settings: createDefaultSettings(),
			resetReason: "missing or non-object settings payload",
		};
	}

	let candidate = raw as Record<string, unknown>;
	const storedVersion = (candidate.schemaVersion as number) ?? 0;
	let migrated = false;

	if (storedVersion !== SETTINGS_SCHEMA_VERSION) {
		if (hasMigrationPath(storedVersion, SETTINGS_SCHEMA_VERSION)) {
			const result = migrateSettings(candidate, SETTINGS_SCHEMA_VERSION);
			candidate = result.data;
			migrated = result.migrated;
		} else {
			return {
				settings: createDefaultSettings(),
				resetReason: `no migration path from schema v${storedVersion} to v${SETTINGS_SCHEMA_VERSION}`,
			};
		}
	}

	if (
		candidate.displaySettings &&
		typeof candidate.displaySettings === "object"
	) {
		const ds = candidate.displaySettings as Record<string, unknown>;
		if (ds.completionSound === undefined) {
			ds.completionSound = true;
		}
	}

	const parsed = settingsSchema.safeParse(candidate);
	if (!parsed.success) {
		return {
			settings: createDefaultSettings(),
			resetReason: `invalid settings payload: ${parsed.error.issues
				.map((issue) => issue.path.join(".") || "root")
				.join(", ")}`,
		};
	}

	return { settings: parsed.data, migrated };
}
