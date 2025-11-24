/**
 * Agent Types
 *
 * Type definitions for AI agents, their configuration, and errors.
 */

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variable for agent process.
 */
export interface AgentEnvVar {
	key: string;
	value: string;
}

// ============================================================================
// Agent Settings (stored in plugin settings)
// ============================================================================

/**
 * Base configuration shared by all agent types.
 */
export interface BaseAgentSettings {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env: AgentEnvVar[];
}

/**
 * Configuration for Claude Code agent.
 */
export interface ClaudeAgentSettings extends BaseAgentSettings {
	apiKey: string;
}

/**
 * Configuration for Codex CLI agent.
 */
export interface CodexAgentSettings extends BaseAgentSettings {
	apiKey: string;
}

/**
 * Configuration for Gemini CLI agent.
 */
export interface GeminiAgentSettings extends BaseAgentSettings {
	apiKey: string;
}

/**
 * Configuration for custom ACP-compatible agents.
 */
export interface CustomAgentSettings extends BaseAgentSettings {}

// ============================================================================
// Runtime Agent Configuration (used when spawning agent process)
// ============================================================================

/**
 * Runtime configuration for launching an AI agent process.
 *
 * This is the execution-time configuration used when spawning an agent,
 * converted from BaseAgentSettings with resolved environment variables.
 */
export interface AgentConfig {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	workingDirectory: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Categories of errors that can occur during agent operations.
 */
export type AgentErrorCategory =
	| "connection"
	| "authentication"
	| "configuration"
	| "communication"
	| "permission"
	| "timeout"
	| "rate_limit"
	| "unknown";

/**
 * Severity level of an error.
 */
export type AgentErrorSeverity = "error" | "warning" | "info";

/**
 * User-facing error information.
 */
export interface ErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
}

/**
 * Complete error information with metadata.
 */
export interface AgentError extends ErrorInfo {
	id: string;
	category: AgentErrorCategory;
	severity: AgentErrorSeverity;
	occurredAt: Date;
	agentId?: string;
	sessionId?: string | null;
	code?: string | number;
	originalError?: unknown;
}
