/**
 * Settings normalization and validation utilities.
 *
 * Pure functions for validating and normalizing plugin settings values.
 * Used by plugin.ts (loadSettings) and SettingsTab.ts.
 */

import type {
	AgentClientPluginSettings,
	AgentEnvVar,
	CustomAgentSettings,
} from "../plugin";
import type { BaseAgentSettings } from "../types/agent";
import type { AgentConfig } from "../acp/acp-client";

// ============================================================================
// Display Settings
// ============================================================================

export const CHAT_FONT_SIZE_MIN = 10;
export const CHAT_FONT_SIZE_MAX = 30;

export const parseChatFontSize = (value: unknown): number | null => {
	if (value === null || value === undefined) {
		return null;
	}

	const numericValue = (() => {
		if (typeof value === "number") {
			return value;
		}

		if (typeof value === "string") {
			const trimmedValue = value.trim();
			if (trimmedValue.length === 0) {
				return Number.NaN;
			}
			if (!/^-?\d+$/.test(trimmedValue)) {
				return Number.NaN;
			}
			return Number.parseInt(trimmedValue, 10);
		}

		return Number.NaN;
	})();

	if (!Number.isFinite(numericValue)) {
		return null;
	}

	return Math.min(
		CHAT_FONT_SIZE_MAX,
		Math.max(CHAT_FONT_SIZE_MIN, Math.round(numericValue)),
	);
};

// ============================================================================
// Settings Utilities
// ============================================================================

export const sanitizeArgs = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

// Convert stored env structures into a deduplicated list
export const normalizeEnvVars = (value: unknown): AgentEnvVar[] => {
	const pairs: AgentEnvVar[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (entry && typeof entry === "object") {
				// Type guard: check if entry has key and value properties
				const entryObj = entry as Record<string, unknown>;
				const key = "key" in entryObj ? entryObj.key : undefined;
				const val = "value" in entryObj ? entryObj.value : undefined;
				if (typeof key === "string" && key.trim().length > 0) {
					pairs.push({
						key: key.trim(),
						value: typeof val === "string" ? val : "",
					});
				}
			}
		}
	} else if (typeof value === "object") {
		for (const [key, val] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (typeof key === "string" && key.trim().length > 0) {
				pairs.push({
					key: key.trim(),
					value: typeof val === "string" ? val : "",
				});
			}
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.key)) {
			return false;
		}
		seen.add(pair.key);
		return true;
	});
};

// Rebuild a custom agent entry with defaults and cleaned values
export const normalizeCustomAgent = (
	agent: Record<string, unknown>,
): CustomAgentSettings => {
	const rawId =
		agent && typeof agent.id === "string" && agent.id.trim().length > 0
			? agent.id.trim()
			: "custom-agent";
	const rawDisplayName =
		agent &&
		typeof agent.displayName === "string" &&
		agent.displayName.trim().length > 0
			? agent.displayName.trim()
			: rawId;
	return {
		id: rawId,
		displayName: rawDisplayName,
		command:
			agent &&
			typeof agent.command === "string" &&
			agent.command.trim().length > 0
				? agent.command.trim()
				: "",
		args: sanitizeArgs(agent?.args),
		env: normalizeEnvVars(agent?.env),
	};
};

// Ensure custom agent IDs are unique within the collection
export const ensureUniqueCustomAgentIds = (
	agents: CustomAgentSettings[],
): CustomAgentSettings[] => {
	const seen = new Set<string>();
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0
				? agent.id.trim()
				: "custom-agent";
		let candidate = base;
		let suffix = 2;
		while (seen.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		seen.add(candidate);
		return { ...agent, id: candidate };
	});
};

/**
 * Convert BaseAgentSettings to AgentConfig for process execution.
 *
 * Transforms the storage format (BaseAgentSettings) to the runtime format (AgentConfig)
 * needed by AcpClient.initialize().
 */
export const toAgentConfig = (
	settings: BaseAgentSettings,
	workingDirectory: string,
): AgentConfig => {
	// Convert AgentEnvVar[] to Record<string, string> for process.spawn()
	const env = settings.env.reduce(
		(acc, { key, value }) => {
			acc[key] = value;
			return acc;
		},
		{} as Record<string, string>,
	);

	return {
		id: settings.id,
		displayName: settings.displayName,
		command: settings.command,
		args: settings.args,
		env,
		workingDirectory,
	};
};
