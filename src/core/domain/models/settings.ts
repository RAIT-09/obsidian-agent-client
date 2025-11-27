/**
 * Domain Models for Plugin Settings
 *
 * These types represent the plugin settings structure at the domain level,
 * independent of the infrastructure layer (Obsidian's data.json storage).
 * This allows the domain layer to work with settings without importing
 * from infrastructure, maintaining Clean Architecture principles.
 *
 * Note: Settings are intentionally mutable as they represent persisted
 * configuration that can be changed by the user. The infrastructure layer
 * (plugin.ts) re-exports this type as AgentClientPluginSettings.
 */

import type {
	ClaudeAgentSettings,
	CodexAgentSettings,
	GeminiAgentSettings,
	CustomAgentSettings,
} from "./agent-config";

// ============================================================================
// Export Settings
// ============================================================================

/**
 * Configuration for chat export functionality.
 */
export interface ExportSettings {
	/** Default folder path for exported chats */
	defaultFolder: string;

	/** Template for export filename (supports {date}, {time} placeholders) */
	filenameTemplate: string;

	/** Automatically export when starting a new chat */
	autoExportOnNewChat: boolean;

	/** Automatically export when closing a chat */
	autoExportOnCloseChat: boolean;

	/** Open the exported file in the editor after export */
	openFileAfterExport: boolean;
}

// ============================================================================
// Plugin Settings
// ============================================================================

/**
 * Complete plugin settings structure.
 *
 * This interface defines all configurable aspects of the plugin:
 * - Agent configurations (Claude, Codex, Gemini, custom)
 * - Active agent selection
 * - Permission handling preferences
 * - Auto-mention behavior
 * - Debug mode
 * - Node.js path for agent execution
 * - Export settings
 * - WSL settings (Windows only)
 *
 * Note: Settings are mutable as they represent user-configurable state
 * that is persisted to disk and modified via the settings UI.
 */
export interface PluginSettings {
	/** Gemini CLI agent configuration */
	gemini: GeminiAgentSettings;

	/** Claude Code agent configuration */
	claude: ClaudeAgentSettings;

	/** Codex CLI agent configuration */
	codex: CodexAgentSettings;

	/** User-defined custom agents */
	customAgents: CustomAgentSettings[];

	/** ID of the currently active agent */
	activeAgentId: string;

	/** Automatically approve permission requests without user confirmation */
	autoAllowPermissions: boolean;

	/** Automatically prepend active note reference to messages */
	autoMentionActiveNote: boolean;

	/** Enable debug logging to console */
	debugMode: boolean;

	/** Absolute path to Node.js executable */
	nodePath: string;

	/** Chat export configuration */
	exportSettings: ExportSettings;

	/** Enable WSL path conversion (Windows only) */
	windowsWslMode: boolean;

	/** WSL distribution name (Windows only, optional) */
	windowsWslDistribution?: string;
}

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default export settings.
 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	defaultFolder: "Agent Client",
	filenameTemplate: "agent_client_{date}_{time}",
	autoExportOnNewChat: false,
	autoExportOnCloseChat: false,
	openFileAfterExport: true,
};

/**
 * Default Claude agent settings.
 */
export const DEFAULT_CLAUDE_SETTINGS: ClaudeAgentSettings = {
	id: "claude-code-acp",
	displayName: "Claude Code",
	apiKey: "",
	command: "",
	args: [],
	env: [],
};

/**
 * Default Codex agent settings.
 */
export const DEFAULT_CODEX_SETTINGS: CodexAgentSettings = {
	id: "codex-acp",
	displayName: "Codex",
	apiKey: "",
	command: "",
	args: [],
	env: [],
};

/**
 * Default Gemini agent settings.
 */
export const DEFAULT_GEMINI_SETTINGS: GeminiAgentSettings = {
	id: "gemini-cli",
	displayName: "Gemini CLI",
	apiKey: "",
	command: "",
	args: ["--experimental-acp"],
	env: [],
};

/**
 * Default plugin settings.
 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
	claude: DEFAULT_CLAUDE_SETTINGS,
	codex: DEFAULT_CODEX_SETTINGS,
	gemini: DEFAULT_GEMINI_SETTINGS,
	customAgents: [],
	activeAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	debugMode: false,
	nodePath: "",
	exportSettings: DEFAULT_EXPORT_SETTINGS,
	windowsWslMode: false,
	windowsWslDistribution: undefined,
};
