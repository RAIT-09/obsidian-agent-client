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

import type { PermissionOption } from "../models/chat-message";
import type {
	AuthenticationMethod,
	SessionModeState,
	SessionModelState,
} from "../models/chat-session";
import type { SessionUpdate } from "../models/session-update";
import type { AgentError } from "../models/agent-error";
import type { PromptContent } from "../models/prompt-content";

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
 * Full agent capabilities from ACP initialization.
 *
 * Contains all capability information returned by the agent,
 * including session features, MCP support, and prompt capabilities.
 */
export interface AgentCapabilities {
	/** Whether the agent supports session/load for resuming sessions */
	loadSession?: boolean;

	/** MCP connection capabilities */
	mcpCapabilities?: McpCapabilities;

	/** Prompt content type capabilities */
	promptCapabilities?: PromptCapabilities;
}

/**
 * Information about the agent implementation.
 *
 * Provided by the agent during initialization for identification
 * and debugging purposes.
 */
export interface AgentInfo {
	/** Programmatic identifier for the agent */
	name: string;

	/** Human-readable display name */
	title?: string;

	/** Version string (e.g., "1.0.0") */
	version?: string;
}

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
	 * Contains loadSession, mcpCapabilities, and promptCapabilities.
	 */
	agentCapabilities?: AgentCapabilities;

	/**
	 * Information about the agent implementation.
	 * Contains name, title, and version.
	 */
	agentInfo?: AgentInfo;
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

	/**
	 * Model state for this session (experimental).
	 * Contains available models and the currently active model.
	 * Undefined if the agent does not support model selection.
	 */
	models?: SessionModelState;
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
	 * Send a prompt to the agent.
	 *
	 * The prompt can contain multiple content blocks (text, images).
	 * The agent will process the prompt and respond via the onSessionUpdate callback.
	 * May also trigger permission requests.
	 *
	 * @param sessionId - Session identifier
	 * @param content - Array of content blocks to send (text and/or images)
	 * @returns Promise resolving when agent completes processing
	 * @throws AgentError if sending fails
	 */
	sendPrompt(sessionId: string, content: PromptContent[]): Promise<void>;

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
	 * Register callback for session updates.
	 *
	 * Called when the agent sends session update events such as:
	 * - agent_message_chunk: Text chunk from agent's response
	 * - agent_thought_chunk: Text chunk from agent's reasoning
	 * - tool_call: New tool call event
	 * - tool_call_update: Update to existing tool call
	 * - plan: Agent's task plan
	 * - available_commands_update: Slash commands changed
	 * - current_mode_update: Mode changed
	 *
	 * This is the unified callback for all session updates.
	 *
	 * @param callback - Function to call when agent sends a session update
	 */
	onSessionUpdate(callback: (update: SessionUpdate) => void): void;

	/**
	 * Register callback for error notifications.
	 *
	 * Called when errors occur during agent operations that cannot be
	 * propagated via exceptions (e.g., process spawn errors, exit code 127).
	 *
	 * @param callback - Function to call when an error occurs
	 */
	onError(callback: (error: AgentError) => void): void;

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

	/**
	 * Set the session model (experimental).
	 * @param sessionId - The session ID
	 * @param modelId - The model ID to set
	 */
	setSessionModel(sessionId: string, modelId: string): Promise<void>;
}
