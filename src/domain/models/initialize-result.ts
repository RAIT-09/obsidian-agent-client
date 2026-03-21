/**
 * Domain Models for Agent Initialization Results
 *
 * These types represent the result of agent initialization,
 * including capabilities, agent info, and authentication methods.
 * They are returned by IAgentClient.initialize() and stored
 * in ChatSession for the session lifetime.
 */

import type { AuthenticationMethod } from "./chat-session";

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
 * Note: This is distinct from the UI-level AgentInfo { id, displayName }
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
