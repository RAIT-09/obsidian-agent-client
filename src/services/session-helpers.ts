/**
 * Pure helper functions for agent session management.
 * Extracted from useSession hook for reusability and testability.
 */

import type { AgentClientPluginSettings } from "../plugin";
import type {
	BaseAgentSettings,
	ClaudeAgentSettings,
	GeminiAgentSettings,
	CodexAgentSettings,
} from "../types/agent";
import type { ChatSession, SavedSessionInfo } from "../types/session";
import type { ChatMessage } from "../types/chat";
import { toAgentConfig } from "./settings-normalizer";
import { truncateTitle } from "../utils/text";

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
 * Get the default agent ID from settings (for new views).
 */
export function getDefaultAgentId(settings: AgentClientPluginSettings): string {
	return settings.defaultAgentId || settings.claude.id;
}

/**
 * Get list of all available agents from settings.
 */
export function getAvailableAgentsFromSettings(
	settings: AgentClientPluginSettings,
): AgentDisplayInfo[] {
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

/**
 * Get the currently active agent information from settings.
 */
export function getCurrentAgent(
	settings: AgentClientPluginSettings,
	agentId?: string,
): AgentDisplayInfo {
	const activeId = agentId || getDefaultAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

// ============================================================================
// Helper Functions (Inlined from ManageSessionUseCase)
// ============================================================================

/**
 * Find agent settings by ID from plugin settings.
 */
export function findAgentSettings(
	settings: AgentClientPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Build AgentConfig with API key injection intent for known agents.
 *
 * For built-in agents, attaches an `apiKey` intent (secretId + envVarName)
 * to the config. AcpClient.initialize() resolves the secret value from
 * Obsidian's secret storage just before spawn.
 *
 * Custom agents pass through unchanged (they manage env vars directly).
 */
export function buildAgentConfigWithApiKey(
	settings: AgentClientPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
) {
	const baseConfig = toAgentConfig(agentSettings, workingDirectory);

	if (agentId === settings.claude.id) {
		const claudeSettings = agentSettings as ClaudeAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: claudeSettings.apiKeySecretId,
				envVarName: "ANTHROPIC_API_KEY",
			},
		};
	}
	if (agentId === settings.codex.id) {
		const codexSettings = agentSettings as CodexAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: codexSettings.apiKeySecretId,
				envVarName: "OPENAI_API_KEY",
			},
		};
	}
	if (agentId === settings.gemini.id) {
		const geminiSettings = agentSettings as GeminiAgentSettings;
		return {
			...baseConfig,
			apiKey: {
				secretId: geminiSettings.apiKeySecretId,
				envVarName: "GEMINI_API_KEY",
			},
		};
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
		models: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Session Title Derivation
// ============================================================================

/**
 * Derive the display title for a session from its persisted metadata and
 * in-memory message list. Returns "New session" as the well-defined fallback.
 *
 * Source-of-truth precedence (highest first):
 *   1. Locally saved title (created on first message, edited via Rename UI)
 *   2. Truncated text of the first user message (50-char limit)
 *   3. "New session" (no sessionId yet, or no user messages)
 *
 * Pure function — shared by the Session Manager (via the live ChatPanelCallbacks
 * read against settings + refs) and the chat view tab header (via a useMemo
 * over React state).
 */
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
