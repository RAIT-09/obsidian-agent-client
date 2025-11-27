// src/adapters/claude-config/claude-config.types.ts

/**
 * Claude Code configuration file types.
 * Based on Claude Code's ~/.claude/ configuration structure.
 */

/**
 * Available Claude models.
 */
export type ClaudeModel =
  | 'claude-sonnet-4-20250514'
  | 'claude-opus-4-20250514'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-opus-20240229'
  | string; // Allow custom model IDs

/**
 * Theme options for Claude Code.
 */
export type ClaudeTheme = 'dark' | 'light' | 'light-daltonized' | 'dark-daltonized';

/**
 * Tool permission levels.
 */
export interface ToolPermissions {
  /** Tools that are always allowed without prompting */
  allowedTools?: string[];
  /** Tools that are always denied */
  deniedTools?: string[];
  /** Whether to auto-approve file operations */
  autoApproveFileOps?: boolean;
  /** Whether to auto-approve terminal commands */
  autoApproveTerminal?: boolean;
}

/**
 * MCP (Model Context Protocol) server configuration.
 */
export interface McpServerConfig {
  /** Unique name for the server */
  name: string;
  /** Command to start the server */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Whether the server is enabled */
  enabled?: boolean;
  /** Optional description */
  description?: string;
}

/**
 * Claude Code settings structure.
 * Reflects the ~/.claude/settings.json format.
 */
export interface ClaudeSettings {
  /** Preferred Claude model */
  model?: ClaudeModel;
  /** UI theme */
  theme?: ClaudeTheme;
  /** Tool permissions configuration */
  permissions?: ToolPermissions;
  /** MCP servers configuration */
  mcpServers: McpServerConfig[];
  /** Custom system prompt additions */
  customSystemPrompt?: string;
  /** Whether to show thinking/reasoning */
  showThinking?: boolean;
  /** Maximum tokens for responses */
  maxTokens?: number;
  /** API endpoint override (for proxies) */
  apiEndpoint?: string;
  /** Whether telemetry is enabled */
  telemetryEnabled?: boolean;
}

/**
 * Configuration file names used by Claude Code.
 */
export const CONFIG_FILES = {
  /** Main settings file */
  settings: 'settings.json',
  /** Local settings override (not synced) */
  settingsLocal: 'settings.local.json',
  /** MCP servers configuration */
  mcpServers: 'mcp_servers.json',
  /** Credentials storage (encrypted) */
  credentials: 'credentials.json',
} as const;

/**
 * Default Claude settings.
 */
export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  model: 'claude-sonnet-4-20250514',
  theme: 'dark',
  permissions: {
    allowedTools: [],
    deniedTools: [],
    autoApproveFileOps: false,
    autoApproveTerminal: false,
  },
  mcpServers: [],
  showThinking: true,
  telemetryEnabled: true,
};
