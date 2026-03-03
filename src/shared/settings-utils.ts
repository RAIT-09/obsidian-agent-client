import { z } from "zod";
import type { BaseAgentSettings } from "../domain/models/agent-config";
import type { AgentConfig } from "../domain/ports/agent-client.port";
import type {
	AgentEnvVar,
	AgentSecretBinding,
	CustomAgentSettings,
} from "../plugin";

const envVarSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});

const secretBindingSchema = z.object({
	envKey: z.string().min(1),
	secretId: z.string().regex(/^[a-z0-9-]+$/),
});

const baseAgentSettingsSchema = z.object({
	id: z.string().min(1),
	displayName: z.string().min(1),
	command: z.string(),
	args: z.array(z.string()),
	env: z.array(envVarSchema),
	secretBindings: z.array(secretBindingSchema),
});

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
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
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

export const normalizeSecretBindings = (
	value: unknown,
): AgentSecretBinding[] => {
	const pairs: AgentSecretBinding[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const entryObj = entry as Record<string, unknown>;
			const envKey =
				typeof entryObj.envKey === "string" ? entryObj.envKey.trim() : "";
			const secretId =
				typeof entryObj.secretId === "string" ? entryObj.secretId.trim() : "";
			if (!envKey || !secretId || !/^[a-z0-9-]+$/.test(secretId)) {
				continue;
			}
			pairs.push({ envKey, secretId });
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.envKey)) {
			return false;
		}
		seen.add(pair.envKey);
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
		secretBindings: normalizeSecretBindings(agent?.secretBindings),
	};
};

// Ensure custom agent IDs are unique within the collection
export const ensureUniqueCustomAgentIds = (
	agents: CustomAgentSettings[],
): CustomAgentSettings[] => {
	const seen = new Set<string>();
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0 ? agent.id.trim() : "custom-agent";
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
 * needed by IAgentClient.initialize().
 *
 * @param settings - Agent settings from plugin configuration
 * @param workingDirectory - Working directory for the agent session
 * @returns AgentConfig ready for agent process spawning
 */
export const toAgentConfig = (
	settings: BaseAgentSettings,
	workingDirectory: string,
): AgentConfig => {
	const parsedSettings = baseAgentSettingsSchema.safeParse(settings);
	if (!parsedSettings.success) {
		throw new Error(
			`Invalid agent settings payload: ${parsedSettings.error.issues
				.map((issue) => issue.path.join(".") || "root")
				.join(", ")}`,
		);
	}

	// Convert AgentEnvVar[] to Record<string, string> for process.spawn()
	const env = parsedSettings.data.env.reduce(
		(acc, { key, value }) => {
			acc[key] = value;
			return acc;
		},
		{} as Record<string, string>,
	);

	return {
		id: parsedSettings.data.id,
		displayName: parsedSettings.data.displayName,
		command: parsedSettings.data.command,
		args: parsedSettings.data.args,
		env,
		workingDirectory,
	};
};
