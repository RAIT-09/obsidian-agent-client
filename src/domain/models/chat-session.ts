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

	/** Available authentication methods for this session */
	authMethods: AuthenticationMethod[];

	/** Timestamp when the session was created */
	createdAt: Date;

	/** Timestamp of the last activity in this session */
	lastActivityAt: Date;

	/** Working directory for agent file operations */
	workingDirectory: string;
}
