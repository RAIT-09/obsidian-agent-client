/**
 * Port for communicating with ACP-compatible AI agents
 *
 * This plugin is designed specifically for the Agent Client Protocol (ACP).
 * This interface abstracts the ACP connection lifecycle and messaging,
 * allowing the domain layer to work with agents without depending on
 * the specific ACP library implementation.
 *
 * Since ACP is a rapidly evolving protocol with frequent specification
 * changes, this port helps isolate the impact of those changes to the
 * adapter layer, keeping the domain logic stable.
 */

import type { ChatMessage, PermissionOption } from "../models/chat-message";
import type { AgentError } from "../models/agent-error";
import type {
	AuthenticationMethod,
	SessionModeState,
} from "../models/chat-session";

/**
 * Runtime configuration for launching an AI agent process.
 *
 * This is the execution-time configuration used when spawning an agent process,
 * as opposed to BaseAgentSettings which is the storage format in plugin settings.
 *
 * Key differences from BaseAgentSettings:
 * - env is converted to Record<string, string> format for process.spawn()
 * - workingDirectory is added for the session execution context
 *
 * Adapters are responsible for converting BaseAgentSettings → AgentConfig
 * before launching the agent process.
 */
export interface AgentConfig {
	/** Unique identifier for this agent (e.g., "claude", "gemini") */
	id: string;

	/** Display name for the agent */
	displayName: string;

	/** Command to execute (full path to executable) */
	command: string;

	/** Command-line arguments */
	args: string[];

	/**
	 * Environment variables for the agent process.
	 * Converted from AgentEnvVar[] to Record format for process.spawn().
	 */
	env?: Record<string, string>;

	/** Working directory for the agent session */
	workingDirectory: string;
}

/**
 * Permission request from an agent.
 *
 * Represents a request for user approval to perform an operation
 * (e.g., file read/write, command execution).
 */
export interface PermissionRequest {
	/** Unique identifier for this permission request */
	requestId: string;

	/** Tool call that triggered the permission request */
	toolCallId: string;

	/** Human-readable title of the operation */
	title?: string;

	/**
	 * Available permission options (allow once, always, deny, etc.).
	 * Uses PermissionOption from domain/models/chat-message.ts.
	 */
	options: PermissionOption[];
}

/**
 * Result of initializing a connection to an agent.
 */
export interface InitializeResult {
	/** Available authentication methods */
	authMethods: AuthenticationMethod[];

	/** Protocol version supported by the agent (ACP uses number) */
	protocolVersion: number;
}

/**
 * Result of creating a new session.
 */
export interface NewSessionResult {
	/** Unique identifier for the new session */
	sessionId: string;

	/**
	 * Mode state for this session.
	 * Contains available modes and the currently active mode.
	 * Undefined if the agent does not support modes.
	 */
	modes?: SessionModeState;
}

/**
 * Interface for communicating with ACP-compatible agents.
 *
 * Provides methods for connecting to agents, sending messages,
 * handling permission requests, and managing agent lifecycle.
 *
 * This port will be implemented by adapters that handle the actual
 * ACP protocol communication and process management.
 */
export interface IAgentClient {
	/**
	 * Initialize connection to an agent.
	 *
	 * Spawns the agent process and performs protocol handshake.
	 *
	 * @param config - Agent configuration
	 * @returns Promise resolving to initialization result
	 * @throws AgentError if connection fails
	 */
	initialize(config: AgentConfig): Promise<InitializeResult>;

	/**
	 * Create a new chat session.
	 *
	 * @param workingDirectory - Working directory for the session
	 * @returns Promise resolving to new session result
	 * @throws AgentError if session creation fails
	 */
	newSession(workingDirectory: string): Promise<NewSessionResult>;

	/**
	 * Authenticate with the agent.
	 *
	 * @param methodId - ID of the authentication method to use
	 * @returns Promise resolving to true if authentication succeeded
	 */
	authenticate(methodId: string): Promise<boolean>;

	/**
	 * Send a message to the agent.
	 *
	 * The agent will process the message and respond via the onMessage callback.
	 * May also trigger permission requests via onPermissionRequest callback.
	 *
	 * @param sessionId - Session identifier
	 * @param message - Message text to send
	 * @returns Promise resolving when agent completes processing
	 * @throws AgentError if sending fails
	 */
	sendMessage(sessionId: string, message: string): Promise<void>;

	/**
	 * Cancel ongoing agent operations.
	 *
	 * Stops the current message processing and cancels any pending operations.
	 *
	 * @param sessionId - Session identifier
	 * @returns Promise resolving when cancellation is complete
	 */
	cancel(sessionId: string): Promise<void>;

	/**
	 * Disconnect from the agent.
	 *
	 * Terminates the agent process and cleans up resources.
	 */
	disconnect(): Promise<void>;

	/**
	 * Register callback for receiving messages from the agent.
	 *
	 * Called when the agent sends a message or updates an existing message
	 * (e.g., streaming responses, tool call updates).
	 *
	 * @param callback - Function to call when agent sends a message
	 */
	onMessage(callback: (message: ChatMessage) => void): void;

	/**
	 * Register callback for errors.
	 *
	 * Called when an error occurs during agent communication.
	 *
	 * @param callback - Function to call when an error occurs
	 */
	onError(callback: (error: AgentError) => void): void;

	/**
	 * Register callback for permission requests.
	 *
	 * Called when the agent requests user permission to perform an operation.
	 * The UI should present the options to the user and call respondToPermission
	 * with the user's choice.
	 *
	 * @param callback - Function to call when agent requests permission
	 */
	onPermissionRequest(callback: (request: PermissionRequest) => void): void;

	/**
	 * Respond to a permission request.
	 *
	 * Sends the user's decision back to the agent, allowing or denying
	 * the requested operation.
	 *
	 * @param requestId - Permission request identifier
	 * @param optionId - Selected option identifier
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void>;

	/**
	 * Check if the agent connection is initialized and ready.
	 *
	 * Returns true if:
	 * - initialize() has been called successfully
	 * - The agent process is still running
	 * - The connection is still active
	 *
	 * @returns true if initialized and connected, false otherwise
	 */
	isInitialized(): boolean;

	/**
	 * Get the ID of the currently connected agent.
	 *
	 * Returns null if no agent is connected.
	 *
	 * @returns Agent ID or null
	 */
	getCurrentAgentId(): string | null;

	/**
	 * Set the session mode.
	 *
	 * Changes the agent's operating mode for the current session.
	 * The mode must be one of the available modes returned in NewSessionResult.
	 * After calling this, the agent will send a current_mode_update notification
	 * to confirm the mode change.
	 *
	 * @param sessionId - Session identifier
	 * @param modeId - ID of the mode to set (must be in availableModes)
	 * @returns Promise resolving when the mode change request is sent
	 * @throws Error if connection is not initialized or mode is invalid
	 */
	setSessionMode(sessionId: string, modeId: string): Promise<void>;
}
