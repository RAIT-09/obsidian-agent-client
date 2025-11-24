/**
 * Settings Types
 *
 * Type definitions for plugin settings.
 */

import type {
	ClaudeAgentSettings,
	CodexAgentSettings,
	GeminiAgentSettings,
	CustomAgentSettings,
} from "./agent";

/**
 * Plugin settings structure.
 * @alias AgentClientPluginSettings (legacy name for backward compatibility)
 */
export interface PluginSettings {
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	gemini: GeminiAgentSettings;
	customAgents: CustomAgentSettings[];
	activeAgentId: string;
	autoAllowPermissions: boolean;
	autoMentionActiveNote: boolean;
	debugMode: boolean;
	nodePath: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
	};
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
}

/**
 * Alias for backward compatibility with existing code.
 */
export type AgentClientPluginSettings = PluginSettings;

/**
 * Default plugin settings.
 */
export const DEFAULT_SETTINGS: PluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	customAgents: [],
	activeAgentId: "claude-code-acp",
	autoAllowPermissions: false,
	autoMentionActiveNote: true,
	debugMode: false,
	nodePath: "",
	exportSettings: {
		defaultFolder: "Agent Client",
		filenameTemplate: "agent_client_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
};
