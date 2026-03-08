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
} from "./chat-message";
import type { SlashCommand } from "./chat-session";

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
	| ConfigOptionUpdate;
