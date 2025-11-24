/**
 * Type Exports
 *
 * Central export point for all type definitions.
 */

// Agent types
export type {
	AgentEnvVar,
	BaseAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	GeminiAgentSettings,
	CustomAgentSettings,
	AgentConfig,
	AgentErrorCategory,
	AgentErrorSeverity,
	ErrorInfo,
	AgentError,
} from "./agent";

// Chat types
export type {
	Role,
	ToolCallStatus,
	ToolKind,
	ToolCallContent,
	DiffContent,
	TerminalContent,
	ToolCallLocation,
	PermissionOption,
	PermissionRequest,
	PlanEntry,
	ToolCallUpdate,
	MessageContent,
	ChatMessage,
	SessionState,
	AuthenticationMethod,
	SlashCommand,
	ChatSession,
} from "./chat";

// Vault types
export type { EditorPosition, NoteMetadata, MentionContext } from "./vault";

// Settings types
export type { PluginSettings, AgentClientPluginSettings } from "./settings";
export { DEFAULT_SETTINGS } from "./settings";

// Port interfaces
export type {
	InitializeResult,
	NewSessionResult,
	IAgentClient,
	IVaultAccess,
	ISettingsAccess,
} from "./ports";
