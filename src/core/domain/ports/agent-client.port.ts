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

import type {
	ChatMessage,
	PermissionOption,
	AuthenticationMethod,
	AgentError,
	AgentConfig,
	PermissionRequest,
} from "../../../types";

// Re-export types for backward compatibility
export type { AgentConfig, PermissionRequest } from "../../../types";

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
}
