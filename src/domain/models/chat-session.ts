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
export interface SessionModelState {
	/** List of models available in this session */
	availableModels: SessionModel[];

	/** ID of the currently active model */
	currentModelId: string;
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
	 * Mode state for this session.
	 * Contains available modes and the currently active mode.
	 * Updated via NewSessionResponse and `current_mode_update` notification.
	 */
	modes?: SessionModeState;

	/**
	 * Model state for this session (experimental).
	 * Contains available models and the currently active model.
	 * Updated via NewSessionResponse initially.
	 */
	models?: SessionModelState;

	/** Timestamp when the session was created */
	createdAt: Date;

	/** Timestamp of the last activity in this session */
	lastActivityAt: Date;

	/** Working directory for agent file operations */
	workingDirectory: string;
}
