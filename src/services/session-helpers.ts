/**
 * Pure helper functions for agent session management.
 * Extracted from useSession hook for reusability and testability.
 */

import type { AgentClientPluginSettings } from "../plugin";
import type {
	BaseAgentSettings,
	PresetAgentUserSettings,
} from "../types/agent";
import type { ChatSession, SavedSessionInfo } from "../types/session";
import type { ChatMessage } from "../types/chat";
import { toAgentConfig } from "./settings-normalizer";
import { PRESET_AGENTS } from "./preset-agents";
import { truncateTitle } from "../utils/text";
import type { AgentUpdateNotification } from "./update-checker";

// ============================================================================
// Types
// ============================================================================

/**
 * Agent information for display.
 * (Inlined from SwitchAgentUseCase)
 */
export interface AgentDisplayInfo {
	/** Unique agent ID */
	id: string;
	/** Display name for UI */
	displayName: string;
}

// ============================================================================
// Helper Functions (Inlined from SwitchAgentUseCase)
// ============================================================================

/**
 * Whether an agent participates in enumeration (lists, menus, commands).
 * `undefined` means enabled — data stored before the toggle existed.
 */
export function isAgentEnabled(
	agent: Pick<BaseAgentSettings, "enabled">,
): boolean {
	return agent.enabled !== false;
}

/**
 * First enabled agent, registry-ordered presets before customs. Backstops to
 * the first preset when nothing is enabled (repairNoEnabledAgents prevents
 * that state from persisting).
 */
export function firstEnabledAgentId(
	settings: AgentClientPluginSettings,
): string {
	for (const def of PRESET_AGENTS) {
		const preset = settings.presetAgents[def.presetId];
		if (!preset || isAgentEnabled(preset)) {
			return def.presetId;
		}
	}
	const custom = settings.customAgents.find(isAgentEnabled);
	return custom ? custom.id : PRESET_AGENTS[0].presetId;
}

/**
 * Repair for the "everything disabled" state: returns a presetAgents record
 * with the first preset re-enabled, or null when no repair is needed.
 * Callers write the repaired record back (plugin.ensureAtLeastOneEnabled).
 */
export function repairNoEnabledAgents(
	settings: AgentClientPluginSettings,
): Record<string, PresetAgentUserSettings> | null {
	if (getAvailableAgentsFromSettings(settings).length > 0) {
		return null;
	}
	const firstId = PRESET_AGENTS[0].presetId;
	const first = settings.presetAgents[firstId];
	if (!first) {
		return null;
	}
	return {
		...settings.presetAgents,
		[firstId]: { ...first, enabled: true },
	};
}

/**
 * Get the default agent ID from settings (for new views). Falls back to the
 * first enabled agent when the stored default is unknown or disabled —
 * second line of defense behind plugin.ensureDefaultAgentId, so a stale
 * default can't keep spawning a disabled agent.
 */
export function getDefaultAgentId(settings: AgentClientPluginSettings): string {
	const stored = settings.defaultAgentId;
	if (stored) {
		const agent = findAgentSettings(settings, stored);
		if (agent && isAgentEnabled(agent)) {
			return stored;
		}
	}
	return firstEnabledAgentId(settings);
}

/**
 * The single enumeration implementation: ordering (registry-ordered presets,
 * then customs) and display-name resolution are defined here and nowhere
 * else. `enabled` is decided alongside each entry — including the "missing
 * presetAgents record entry counts as enabled" rule — so the public views
 * below never re-resolve ids. Unknown presetAgents entries (version skew)
 * are not enumerated.
 */
function enumerateAgents(
	settings: AgentClientPluginSettings,
): Array<AgentDisplayInfo & { enabled: boolean }> {
	return [
		...PRESET_AGENTS.map((def) => {
			const preset = settings.presetAgents[def.presetId];
			return {
				id: def.presetId,
				displayName: preset?.displayName || def.presetId,
				enabled: !preset || isAgentEnabled(preset),
			};
		}),
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
			enabled: isAgentEnabled(agent),
		})),
	];
}

/**
 * All agents regardless of enabled state — for surfaces that register
 * everything and gate visibility live (command palette checkCallback).
 */
export function getAllAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentDisplayInfo[] {
	return enumerateAgents(settings).map(({ id, displayName }) => ({
		id,
		displayName,
	}));
}

/**
 * Enabled agents only (plugin.getAvailableAgents delegates here) — the
 * enumeration every list, menu, and dropdown consumes. Resolution
 * (findAgentSettings) stays unfiltered.
 */
export function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentDisplayInfo[] {
	return enumerateAgents(settings)
		.filter((agent) => agent.enabled)
		.map(({ id, displayName }) => ({ id, displayName }));
}

/**
 * Get the currently active agent information from settings.
 *
 * Resolves by unfiltered lookup, not enumeration: a session on a disabled
 * agent must keep its display name (view titles, export frontmatter) instead
 * of degrading to the raw id.
 */
export function getCurrentAgent(
	settings: AgentClientPluginSettings,
	agentId?: string,
): AgentDisplayInfo {
	const activeId = agentId || getDefaultAgentId(settings);
	const found = findAgentSettings(settings, activeId);
	return found
		? { id: activeId, displayName: found.displayName || found.id }
		: { id: activeId, displayName: activeId };
}

// ============================================================================
// Helper Functions (Inlined from ManageSessionUseCase)
// ============================================================================

/**
 * Find agent settings by ID from plugin settings.
 *
 * Presets resolve before custom agents (a custom sharing a preset id has
 * never been reachable). The preset lookup is gated on registry membership
 * so preserved unknown presetAgents entries (version skew) never shadow a
 * same-id custom agent.
 */
export function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (PRESET_AGENTS.some((def) => def.presetId === agentId)) {
		const preset = settings.presetAgents[agentId];
		if (preset) {
			return preset;
		}
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Build AgentConfig with API key injection intent for preset agents.
 *
 * For presets with API-key wiring in the registry, attaches an `apiKey`
 * intent (secretId + envVarName) to the config. AcpClient.initialize()
 * resolves the secret value from Obsidian's secret storage just before
 * spawn.
 *
 * Custom agents (and presets without an apiKey registry entry) pass through
 * unchanged (they manage env vars directly).
 */
export function buildAgentConfigWithApiKey(
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);

	const def = PRESET_AGENTS.find((d) => d.presetId === agentId);
	// Skip the wiring entirely when no secret is configured (account-based
	// logins): attaching an empty secretId would export an empty env var
	// (e.g. ANTHROPIC_API_KEY="") into the agent process.
	if (def?.apiKey) {
		const presetSettings = agentSettings as PresetAgentUserSettings;
		if (presetSettings.apiKeySecretId) {
			return {
				...baseConfig,
				apiKey: {
					secretId: presetSettings.apiKeySecretId,
					envVarName: def.apiKey.envVarName,
				},
			};
		}
	}

	// Custom agents — no API key injection
	return baseConfig;
}

// ============================================================================
// Initial State
// ============================================================================

/**
 * Create initial session state.
 */
export function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected",
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Session Title Derivation
// ============================================================================

/** Derive the session display title (saved title > first user message > "New session"). */
export function computeSessionTitle(
	sessionId: string | null,
	savedSessions: SavedSessionInfo[],
	messages: ChatMessage[],
): string {
	if (sessionId) {
		const saved = savedSessions.find((s) => s.sessionId === sessionId);
		if (saved?.title) return saved.title;
	}
	const firstUserMessage = messages.find((m) => m.role === "user");
	if (firstUserMessage) {
		const textContent = firstUserMessage.content.find(
			(c) => c.type === "text" || c.type === "text_with_context",
		);
		if (textContent && "text" in textContent) {
			return truncateTitle(textContent.text);
		}
	}
	return "New session";
}

// ============================================================================
// Gemini CLI Deprecation Notice
// ============================================================================

/** Docs URL for the Gemini CLI deprecation announcement. */
export const GEMINI_DEPRECATION_DOCS_URL =
	"https://rait-09.github.io/obsidian-agent-client/announcements/gemini-cli-deprecation.html";

/**
 * Build the static removal notice shown while the Gemini CLI preset is selected.
 */
export function buildGeminiDeprecationNotice(): AgentUpdateNotification {
	return {
		variant: "info",
		title: "Gemini CLI preset removal in 0.14.0",
		message:
			"Use the Antigravity CLI preset for Google account login. " +
			"The Gemini CLI preset will be removed in 0.14.0; saved settings and Keychain API keys will be kept. " +
			"To keep using Gemini CLI, configure a custom agent.",
		link: { text: "Learn more", url: GEMINI_DEPRECATION_DOCS_URL },
	};
}
