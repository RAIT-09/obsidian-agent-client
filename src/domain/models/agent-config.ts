/**
 * Domain Models for Agent Configuration
 *
 * These types represent agent settings and configuration,
 * independent of the plugin infrastructure. They define
 * the core concepts of agent identity, capabilities, and
 * connection parameters.
 */

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variable for agent process.
 *
 * Used to pass configuration and credentials to agent processes
 * via environment variables (e.g., API keys, paths, feature flags).
 */
export interface AgentEnvVar {
	/** Environment variable name (e.g., "ANTHROPIC_API_KEY") */
	key: string;

	/** Environment variable value */
	value: string;
}

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Base configuration shared by all agent types.
 *
 * Defines the common properties needed to launch and communicate
 * with any ACP-compatible agent, regardless of the specific
 * implementation (Claude Code, Gemini CLI, custom agents, etc.).
 */
export interface BaseAgentSettings {
	/** Unique identifier for this agent (e.g., "claude", "gemini", "custom-1") */
	id: string;

	/** Human-readable display name shown in UI */
	displayName: string;

	/** Command to execute (full path to executable or command name) */
	command: string;

	/** Command-line arguments passed to the agent */
	args: string[];

	/** Environment variables for the agent process */
	env: AgentEnvVar[];
}

/**
 * Configuration for Gemini CLI agent.
 *
 * API key is stored in Obsidian SecretStorage, not plugin settings.
 */
export type GeminiAgentSettings = BaseAgentSettings;

/**
 * Configuration for Claude Code agent.
 *
 * API key is stored in Obsidian SecretStorage, not plugin settings.
 */
export type ClaudeAgentSettings = BaseAgentSettings;

/**
 * Configuration for Codex CLI agent.
 *
 * API key is stored in Obsidian SecretStorage, not plugin settings.
 */
export type CodexAgentSettings = BaseAgentSettings;

/**
 * Configuration for OpenCode agent.
 *
 * OpenCode natively supports ACP and authenticates via `opencode auth login`.
 * No API key field — uses only the base settings.
 */
export type OpenCodeAgentSettings = BaseAgentSettings;

/**
 * Configuration for custom ACP-compatible agents.
 *
 * Uses only the base settings, allowing users to configure
 * any agent that implements the Agent Client Protocol.
 */
export type CustomAgentSettings = BaseAgentSettings;
