/**
 * Domain Models for Chat Messages
 *
 * These types are independent of the Agent Client Protocol (ACP) library.
 * They represent the core domain concepts of this plugin and remain stable
 * even if the underlying protocol changes. The Adapter layer handles conversion
 * between these domain types and ACP protocol types.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Message role in a conversation.
 * - assistant: AI agent's messages
 * - user: User's messages
 */
export type Role = "assistant" | "user";

/**
 * Status of a tool call execution.
 */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * Categories of tool operations.
 */
export type ToolKind =
	| "read" // Reading files or data
	| "edit" // Modifying existing content
	| "delete" // Removing files or data
	| "move" // Moving or renaming
	| "search" // Searching through content
	| "execute" // Running commands or scripts
	| "think" // Agent reasoning/planning
	| "fetch" // Fetching external resources
	| "switch_mode" // Changing operation mode
	| "other"; // Other operations

// ============================================================================
// Tool Call Content Types
// ============================================================================

/**
 * Content that can be included in a tool call result.
 * Currently supports diffs and terminal output.
 */
export type ToolCallContent = DiffContent | TerminalContent;

/**
 * Represents a file modification with before/after content.
 */
export interface DiffContent {
	type: "diff";
	path: string;
	newText: string;
	oldText?: string | null; // null or undefined for new files
}

/**
 * Reference to a terminal session created by a tool call.
 */
export interface TerminalContent {
	type: "terminal";
	terminalId: string;
}

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * Location information for tool operations (e.g., which file/line was affected).
 */
export interface ToolCallLocation {
	path: string;
	line?: number | null; // null if the entire file is affected
}

/**
 * User's choice for permission requests.
 */
export interface PermissionOption {
	optionId: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

/**
 * Entry in an agent's plan/task list.
 */
export interface PlanEntry {
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority: "high" | "medium" | "low";
}

/**
 * Tool call information for permission requests.
 * Contains details about the operation being requested for user approval.
 */
export interface ToolCallInfo {
	toolCallId: string;
	title?: string | null;
	status?: ToolCallStatus | null;
	kind?: ToolKind | null;
	content?: ToolCallContent[] | null;
	locations?: ToolCallLocation[] | null;
	rawInput?: { [k: string]: unknown }; // Tool's input parameters
	rawOutput?: { [k: string]: unknown }; // Tool's output data
}

// ============================================================================
// Chat Message
// ============================================================================

/**
 * A single message in the chat history.
 *
 * Messages can contain multiple content blocks of different types
 * (text, images, tool calls, etc.) to represent rich conversations.
 */
export interface ChatMessage {
	id: string;
	role: Role;
	content: MessageContent[];
	timestamp: Date;
}

/**
 * Different types of content that can appear in a message.
 *
 * This union type represents all possible content blocks:
 * - text: Plain text from user or agent
 * - agent_thought: Agent's internal reasoning (often collapsed in UI)
 * - image: Visual content (base64 encoded)
 * - tool_call: Agent's tool execution with results
 * - plan: Agent's task breakdown
 * - permission_request: Request for user approval
 * - terminal: Reference to a terminal session
 */
export type MessageContent =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "text_with_context";
			text: string;
			autoMentionContext?: {
				noteName: string;
				notePath: string;
				selection?: {
					fromLine: number;
					toLine: number;
				};
			};
	  }
	| {
			type: "agent_thought";
			text: string;
	  }
	| {
			type: "image";
			data: string; // Base64 encoded image data
			mimeType: string; // e.g., "image/png"
			uri?: string; // Optional source URI
	  }
	| {
			type: "tool_call";
			toolCallId: string;
			title?: string | null;
			status: ToolCallStatus;
			kind?: ToolKind;
			content?: ToolCallContent[];
			locations?: ToolCallLocation[];
			rawInput?: { [k: string]: unknown };
			rawOutput?: { [k: string]: unknown };
			permissionRequest?: {
				requestId: string;
				options: PermissionOption[];
				selectedOptionId?: string;
				isCancelled?: boolean;
				isActive?: boolean;
			};
	  }
	| {
			type: "plan";
			entries: PlanEntry[];
	  }
	| {
			type: "permission_request";
			toolCall: ToolCallInfo;
			options: PermissionOption[];
			selectedOptionId?: string;
			isCancelled?: boolean;
			isActive?: boolean;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };
