/**
 * Domain Models for Chat Sessions
 *
 * These types represent the state and lifecycle of an agent chat session,
 * independent of the ACP protocol implementation. They encapsulate connection
 * state, authentication, and session metadata.
 */

// ============================================================================
// Session State
// ============================================================================

/**
 * Represents the current state of a chat session.
 *
 * State transitions:
 * - initializing: Connection is being established
 * - authenticating: User authentication in progress
 * - ready: Session is ready to send/receive messages
 * - busy: Agent is processing a request
 * - error: An error occurred (connection failed, etc.)
 * - disconnected: Session has been closed
 */
export type SessionState =
	| "initializing" // Connection is being established
	| "authenticating" // User authentication in progress
	| "ready" // Ready to send/receive messages
	| "busy" // Agent is processing a request
	| "error" // An error occurred
	| "disconnected"; // Session has been closed

// ============================================================================
// Authentication
// ============================================================================

/**
 * Authentication method available for the session.
 *
 * Simplified from ACP's AuthMethod to domain concept.
 * Represents a way the user can authenticate with the agent
 * (e.g., API key, OAuth, etc.)
 */
export interface AuthenticationMethod {
	/** Unique identifier for this authentication method */
	id: string;

	/** Human-readable name (e.g., "API Key", "OAuth") */
	name: string;

	/** Optional description of the authentication method */
	description?: string | null;
}

// ============================================================================
// Slash Commands
// ============================================================================

/**
 * Represents a slash command available in the current session.
 *
 * Slash commands provide quick access to specific agent capabilities
 * and workflows (e.g., /web, /test, /plan). They are advertised by
 * the agent via the ACP protocol's `available_commands_update` notification.
 *
 * Commands can be invoked by users by typing `/` followed by the command
 * name and optional input in the chat input field.
 */
export interface SlashCommand {
	/** Command name (e.g., "web", "test", "plan") */
	name: string;

	/** Human-readable description of what the command does */
	description: string;

	/**
	 * Hint text to display when the command expects additional input.
	 * If null or undefined, the command does not require additional input.
	 *
	 * Example: "query to search for" for the /web command
	 */
	hint?: string | null;
}

// ============================================================================
// Session Mode
// ============================================================================

/**
 * Represents a mode available in the current session.
 *
 * Modes define how the agent behaves and processes requests.
 * For example, "build" mode for implementation tasks, "plan" mode for
 * architecture and design discussions.
 *
 * Modes are advertised by the agent in the NewSessionResponse and can
 * be changed during the session via the ACP protocol.
 */
/** DEPRECATED: Use SessionConfigOption instead. Kept for backward compatibility. */
export interface SessionMode {
	/** Unique identifier for this mode (e.g., "build", "plan") */
	id: string;

	/** Human-readable name for display */
	name: string;

	/** Optional description of what this mode does */
	description?: string;
}

/**
 * State of available modes in a session.
 *
 * Contains both the list of available modes and the currently active mode.
 * Updated via NewSessionResponse initially and current_mode_update notifications.
 */
/** DEPRECATED: Use SessionConfigOption instead. Kept for backward compatibility. */
export interface SessionModeState {
	/** List of modes available in this session */
	availableModes: SessionMode[];

	/** ID of the currently active mode */
	currentModeId: string;
}

// ============================================================================
// Model (Experimental)
// ============================================================================

/**
 * Represents an AI model available in a session.
 *
 * Models determine which AI model is used for responses.
 * This is an experimental feature and may change.
 */
/** DEPRECATED: Use SessionConfigOption instead. Kept for backward compatibility. */
export interface SessionModel {
	/** Unique identifier for this model (e.g., "claude-sonnet-4") */
	modelId: string;

	/** Human-readable name for display */
	name: string;

	/** Optional description of this model */
	description?: string;
}

/**
 * State of available models in a session.
 *
 * Contains both the list of available models and the currently active model.
 * Updated via NewSessionResponse initially.
 * Note: Unlike modes, there is no dedicated notification for model changes.
 */
/** DEPRECATED: Use SessionConfigOption instead. Kept for backward compatibility. */
export interface SessionModelState {
	/** List of models available in this session */
	availableModels: SessionModel[];

	/** ID of the currently active model */
	currentModelId: string;
}

/**
 * Context window usage and cost information for a session.
 * Reported by the agent via `usage_update` session notifications.
 */
export interface SessionUsage {
	/** Tokens currently in context */
	used: number;
	/** Total context window size in tokens */
	size: number;
	/** Cumulative session cost (optional — not all agents track this) */
	cost?: { amount: number; currency: string };
}

// ============================================================================
// Chat Session
// ============================================================================

/**
 * Represents a chat session with an AI agent.
 *
 * A session encapsulates:
 * - Connection state and readiness
 * - Authentication status and available methods
 * - Current agent configuration
 * - Session lifecycle metadata (creation time, last activity)
 * - Working directory for file operations
 *
 * Sessions are created when connecting to an agent and persist until
 * the user creates a new session or disconnects.
 */
export interface ChatSession {
	/** Unique identifier for this session (null if not yet created) */
	sessionId: string | null;

	/** Current state of the session */
	state: SessionState;

	/** ID of the active agent (claude, gemini, or custom agent ID) */
	agentId: string;

	/** Display name of the agent at session creation time */
	agentDisplayName: string;

	/** Available authentication methods for this session */
	authMethods: AuthenticationMethod[];

	/**
	 * Slash commands available in this session.
	 * Updated dynamically via ACP's `available_commands_update` notification.
	 */
	availableCommands?: SlashCommand[];

	/**
	 * DEPRECATED: Use configOptions instead. Kept for backward compatibility
	 * with agents that don't support configOptions.
	 */
	modes?: SessionModeState;

	/**
	 * DEPRECATED: Use configOptions instead. Kept for backward compatibility
	 * with agents that don't support configOptions.
	 */
	models?: SessionModelState;

	/**
	 * Session configuration options (mode, model, thought_level, etc.).
	 * Supersedes legacy modes/models fields.
	 * When present, UI should use this instead of modes/models.
	 */
	configOptions?: SessionConfigOption[];

	/**
	 * Context window usage and cost information.
	 * Updated dynamically via ACP's `usage_update` notification.
	 * Agent sends this after each prompt response and on session load/resume.
	 */
	usage?: SessionUsage;

	/**
	 * Prompt capabilities supported by the agent.
	 * Indicates which content types (image, audio, etc.) can be included in prompts.
	 * Set during initialization and persists for the session lifetime.
	 * (Convenience accessor - same as agentCapabilities.promptCapabilities)
	 */
	promptCapabilities?: PromptCapabilities;

	/**
	 * Full agent capabilities from initialization.
	 * Contains loadSession, sessionCapabilities, mcpCapabilities, and promptCapabilities.
	 * Set during initialization and persists for the session lifetime.
	 */
	agentCapabilities?: AgentCapabilities;

	/**
	 * Information about the connected agent.
	 * Contains agent name, title, and version.
	 * Set during initialization and persists for the session lifetime.
	 */
	agentInfo?: AgentInfo;

	/** Timestamp when the session was created */
	createdAt: Date;

	/** Timestamp of the last activity in this session */
	lastActivityAt: Date;

	/** Working directory for agent file operations */
	workingDirectory: string;

	/**
	 * Agent Workspace snapshot for seed-then-delta context shipping.
	 * `null` until the first successful prompt; subsequent prompts use this
	 * to compute deltas. Held in memory only — not persisted across reloads.
	 */
	workspaceSnapshot?: WorkspaceSnapshot | null;
}

/**
 * Hash digest set captured at the end of each successful agent turn.
 * Used by AgentWorkspace to compute the seed-vs-delta prelude on the next
 * prompt without re-walking files unchanged since the snapshot.
 */
export interface WorkspaceSnapshot {
	focusContextHash: string;
	resourcesManifestHash: string;
	outputDateString: string;
	hasSeed: boolean;
}
/**
 * Domain Models for Session Updates
 *
 * These types represent session update events from the agent,
 * independent of the ACP protocol implementation. They use the same
 * type names as ACP's sessionUpdate values for consistency.
 *
 * The Adapter layer receives ACP notifications and converts them to
 * these domain types, which are then handled by the application layer.
 */

import type {
	PlanEntry,
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
	ToolCallStatus,
	PermissionOption,
} from "./chat";
import type { ProcessError } from "./errors";

// ============================================================================
// Base Type
// ============================================================================

/**
 * Base interface for all session updates.
 * Contains the session ID that the update belongs to.
 */
interface SessionUpdateBase {
	/** The session ID this update belongs to */
	sessionId: string;
}

// ============================================================================
// Session Update Types
// ============================================================================

/**
 * Text chunk from agent's message stream.
 * Used for streaming text responses.
 */
export interface AgentMessageChunk extends SessionUpdateBase {
	type: "agent_message_chunk";
	text: string;
}

/**
 * Text chunk from agent's internal reasoning.
 * Used for streaming thought/reasoning content.
 */
export interface AgentThoughtChunk extends SessionUpdateBase {
	type: "agent_thought_chunk";
	text: string;
}

/**
 * Text chunk from user's message during session/load.
 * Used for reconstructing user messages when loading a saved session.
 */
export interface UserMessageChunk extends SessionUpdateBase {
	type: "user_message_chunk";
	text: string;
}

/**
 * New tool call event.
 * Creates a new tool call in the message history.
 */
export interface ToolCall extends SessionUpdateBase {
	type: "tool_call";
	toolCallId: string;
	title?: string;
	status: ToolCallStatus;
	kind?: ToolKind;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	rawInput?: { [k: string]: unknown };
	permissionRequest?: {
		requestId: string;
		options: PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
}

/**
 * Tool call update event.
 * Updates an existing tool call with new information.
 * Semantically identical to ToolCall for processing purposes.
 */
export interface ToolCallUpdate extends SessionUpdateBase {
	type: "tool_call_update";
	toolCallId: string;
	title?: string;
	status?: ToolCallStatus;
	kind?: ToolKind;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	rawInput?: { [k: string]: unknown };
	permissionRequest?: {
		requestId: string;
		options: PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
}

/**
 * Agent's execution plan.
 * Contains a list of tasks the agent intends to accomplish.
 */
export interface Plan extends SessionUpdateBase {
	type: "plan";
	entries: PlanEntry[];
}

/**
 * Update to available slash commands.
 * Sent when the agent's available commands change.
 */
export interface AvailableCommandsUpdate extends SessionUpdateBase {
	type: "available_commands_update";
	commands: SlashCommand[];
}

/**
 * Update to current session mode.
 * Sent when the agent switches to a different mode.
 */
export interface CurrentModeUpdate extends SessionUpdateBase {
	type: "current_mode_update";
	currentModeId: string;
}

/**
 * Session info update (title, timestamp).
 * Sent when the agent updates session metadata.
 */
export interface SessionInfoUpdate extends SessionUpdateBase {
	type: "session_info_update";
	title?: string | null;
	updatedAt?: string | null;
}

/**
 * Context window and cost update for a session.
 * Sent periodically to report token usage and cost.
 */
export interface UsageUpdate extends SessionUpdateBase {
	type: "usage_update";
	/** Total context window size in tokens */
	size: number;
	/** Tokens currently in context */
	used: number;
	/** Cumulative session cost */
	cost?: { amount: number; currency: string } | null;
}

/**
 * Session configuration options have been updated.
 * Sent when the agent changes config options (mode, model, thought_level, etc.).
 * Supersedes legacy modes/models API.
 */
export interface ConfigOptionUpdate extends SessionUpdateBase {
	type: "config_option_update";
	configOptions: SessionConfigOption[];
}

/**
 * Process-level error event.
 * Emitted when the agent process encounters a system error
 * (spawn failure, command not found, etc.).
 */
export interface ProcessErrorUpdate extends SessionUpdateBase {
	type: "process_error";
	error: ProcessError;
}

// ============================================================================
// Config Option Types
// ============================================================================

/**
 * A session configuration option (e.g. mode, model, thought_level).
 * Part of the ACP configOptions API that supersedes legacy modes/models.
 */
export interface SessionConfigOption {
	id: string;
	name: string;
	description?: string | null;
	category?: string | null;
	type: "select";
	currentValue: string;
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[];
}

export interface SessionConfigSelectOption {
	value: string;
	name: string;
	description?: string | null;
}

export interface SessionConfigSelectGroup {
	group: string;
	name: string;
	options: SessionConfigSelectOption[];
}

/**
 * Flatten grouped or flat config select options into a single array.
 */
export function flattenConfigSelectOptions(
	options: SessionConfigSelectOption[] | SessionConfigSelectGroup[],
): SessionConfigSelectOption[] {
	if (options.length === 0) return [];
	if ("value" in options[0]) return options as SessionConfigSelectOption[];
	return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all session update types.
 *
 * These types correspond to ACP's SessionNotification.update.sessionUpdate values:
 * - agent_message_chunk: Text chunk from agent's response
 * - agent_thought_chunk: Text chunk from agent's reasoning
 * - user_message_chunk: Text chunk from user's message (session/load)
 * - tool_call: New tool call event
 * - tool_call_update: Update to existing tool call
 * - plan: Agent's task plan
 * - available_commands_update: Slash commands changed
 * - current_mode_update: Mode changed
 * - session_info_update: Session metadata changed
 * - usage_update: Context window and cost update
 * - config_option_update: Session config options changed
 *
 * All session update types include a sessionId field to identify which
 * session the update belongs to. This enables filtering/routing of updates
 * in multi-session scenarios.
 */
export type SessionUpdate =
	| AgentMessageChunk
	| AgentThoughtChunk
	| UserMessageChunk
	| ToolCall
	| ToolCallUpdate
	| Plan
	| AvailableCommandsUpdate
	| CurrentModeUpdate
	| SessionInfoUpdate
	| UsageUpdate
	| ConfigOptionUpdate
	| ProcessErrorUpdate;

/**
 * Session metadata from session/list response.
 * Matches ACP SessionInfo type.
 */
export interface SessionInfo {
	/** Unique session identifier */
	sessionId: string;
	/** Working directory for the session */
	cwd: string;
	/** Human-readable session title */
	title?: string;
	/** ISO 8601 timestamp of last update */
	updatedAt?: string;
}

/**
 * Result of session/list (unstable).
 */
export interface ListSessionsResult {
	/** Array of session metadata */
	sessions: SessionInfo[];
	/** Cursor for pagination (load more sessions) */
	nextCursor?: string;
}

/**
 * Result of session operations (new, load, resume, fork).
 *
 * All session creation/restoration operations return the same structure:
 * a session ID with optional mode/model/config state.
 *
 * Note: modes and models are DEPRECATED in favor of configOptions.
 * They are kept for backward compatibility with agents that don't
 * support configOptions yet.
 */
export interface SessionResult {
	/** Unique session identifier */
	sessionId: string;

	/** DEPRECATED: Use configOptions instead. Kept for backward compatibility. */
	modes?: SessionModeState;

	/** DEPRECATED: Use configOptions instead. Kept for backward compatibility. */
	models?: SessionModelState;

	/** Session config options (supersedes modes/models) */
	configOptions?: SessionConfigOption[];
}

/**
 * Locally saved session metadata.
 *
 * Used when agent doesn't support session/list but supports load/resume/fork.
 * Saved to plugin settings via plugin.saveData().
 */
export interface SavedSessionInfo {
	/** Unique session identifier */
	sessionId: string;
	/** Agent ID that created this session */
	agentId: string;
	/** Working directory for the session */
	cwd: string;
	/** Human-readable session title (first 50 chars of first user message) */
	title?: string;
	/** ISO 8601 timestamp of session creation */
	createdAt: string;
	/** ISO 8601 timestamp of last activity */
	updatedAt: string;
}
/**
 * Domain Models for Agent Initialization Results
 *
 * These types represent the result of agent initialization,
 * including capabilities, agent info, and authentication methods.
 * They are returned by AcpClient.initialize() and stored
 * in ChatSession for the session lifetime.
 */

// ============================================================================
// Agent Capabilities
// ============================================================================

/**
 * Capabilities for prompt content types.
 *
 * Describes which content types the agent supports in prompts.
 * All capabilities default to false if not specified.
 */
export interface PromptCapabilities {
	/** Agent supports image content in prompts */
	image?: boolean;

	/** Agent supports audio content in prompts */
	audio?: boolean;

	/** Agent supports embedded context (Resource) in prompts */
	embeddedContext?: boolean;
}

/**
 * MCP (Model Context Protocol) capabilities supported by the agent.
 */
export interface McpCapabilities {
	/** Agent supports connecting to MCP servers over HTTP */
	http?: boolean;

	/** Agent supports connecting to MCP servers over SSE (deprecated) */
	sse?: boolean;
}

/**
 * Session-related capabilities (unstable features).
 * From agentCapabilities.sessionCapabilities in initialize response.
 */
export interface SessionCapabilities {
	/** session/resume support (unstable) */
	resume?: Record<string, unknown>;
	/** session/fork support (unstable) */
	fork?: Record<string, unknown>;
	/** session/list support (unstable) */
	list?: Record<string, unknown>;
}

/**
 * Full agent capabilities from ACP initialization.
 *
 * Contains all capability information returned by the agent,
 * including session features, MCP support, and prompt capabilities.
 */
export interface AgentCapabilities {
	/** Whether the agent supports session/load for resuming sessions (stable) */
	loadSession?: boolean;

	/** Session management capabilities (unstable features) */
	sessionCapabilities?: SessionCapabilities;

	/** MCP connection capabilities */
	mcpCapabilities?: McpCapabilities;

	/** Prompt content type capabilities */
	promptCapabilities?: PromptCapabilities;
}

// ============================================================================
// Agent Info
// ============================================================================

/**
 * Information about the agent implementation.
 *
 * Provided by the agent during initialization for identification
 * and debugging purposes.
 *
 * Note: This is distinct from the UI-level AgentDisplayInfo { id, displayName }
 * used in hooks/components for agent switching UI.
 */
export interface AgentInfo {
	/** Programmatic identifier for the agent */
	name: string;

	/** Human-readable display name */
	title?: string;

	/** Version string (e.g., "1.0.0") */
	version?: string;
}

// ============================================================================
// Initialize Result
// ============================================================================

/**
 * Result of initializing a connection to an agent.
 */
export interface InitializeResult {
	/** Available authentication methods */
	authMethods: AuthenticationMethod[];

	/** Protocol version supported by the agent (ACP uses number) */
	protocolVersion: number;

	/**
	 * Prompt capabilities supported by the agent.
	 * Indicates which content types can be included in prompts.
	 * (Convenience accessor - same as agentCapabilities.promptCapabilities)
	 */
	promptCapabilities?: PromptCapabilities;

	/**
	 * Full agent capabilities from initialization.
	 * Contains loadSession, sessionCapabilities, mcpCapabilities, and promptCapabilities.
	 */
	agentCapabilities?: AgentCapabilities;

	/**
	 * Information about the agent implementation.
	 * Contains name, title, and version.
	 */
	agentInfo?: AgentInfo;
}
