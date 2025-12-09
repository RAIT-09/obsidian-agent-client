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
// Session Update Types
// ============================================================================

/**
 * Text chunk from agent's message stream.
 * Used for streaming text responses.
 */
export interface AgentMessageChunkUpdate {
	type: "agent_message_chunk";
	text: string;
}

/**
 * Text chunk from agent's internal reasoning.
 * Used for streaming thought/reasoning content.
 */
export interface AgentThoughtChunkUpdate {
	type: "agent_thought_chunk";
	text: string;
}

/**
 * New tool call event.
 * Creates or updates a tool call in the message history.
 */
export interface ToolCallUpdate {
	type: "tool_call";
	toolCallId: string;
	title?: string;
	status: ToolCallStatus;
	kind?: ToolKind;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
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
 * Semantically identical to ToolCallUpdate for processing purposes.
 */
export interface ToolCallUpdateUpdate {
	type: "tool_call_update";
	toolCallId: string;
	title?: string;
	status?: ToolCallStatus;
	kind?: ToolKind;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	permissionRequest?: {
		requestId: string;
		options: PermissionOption[];
		selectedOptionId?: string;
		isCancelled?: boolean;
		isActive?: boolean;
	};
}

/**
 * Agent's execution plan update.
 * Contains a list of tasks the agent intends to accomplish.
 */
export interface PlanUpdate {
	type: "plan";
	entries: PlanEntry[];
}

/**
 * Update to available slash commands.
 * Sent when the agent's available commands change.
 */
export interface AvailableCommandsUpdate {
	type: "available_commands_update";
	commands: SlashCommand[];
}

/**
 * Update to current session mode.
 * Sent when the agent switches to a different mode.
 */
export interface CurrentModeUpdate {
	type: "current_mode_update";
	currentModeId: string;
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
 * - tool_call: New tool call event
 * - tool_call_update: Update to existing tool call
 * - plan: Agent's task plan
 * - available_commands_update: Slash commands changed
 * - current_mode_update: Mode changed
 *
 * Note: user_message_chunk is not included as it's not typically processed
 * by the client in the same way (user messages are handled directly).
 */
export type SessionUpdate =
	| AgentMessageChunkUpdate
	| AgentThoughtChunkUpdate
	| ToolCallUpdate
	| ToolCallUpdateUpdate
	| PlanUpdate
	| AvailableCommandsUpdate
	| CurrentModeUpdate;
