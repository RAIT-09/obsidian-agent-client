/**
 * Chat Types
 *
 * Type definitions for chat messages, sessions, and related content.
 */

// ============================================================================
// Message Types
// ============================================================================

export type Role = "assistant" | "user";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switch_mode"
	| "other";

// ============================================================================
// Tool Call Content
// ============================================================================

export type ToolCallContent = DiffContent | TerminalContent;

export interface DiffContent {
	type: "diff";
	path: string;
	newText: string;
	oldText?: string | null;
}

export interface TerminalContent {
	type: "terminal";
	terminalId: string;
}

export interface ToolCallLocation {
	path: string;
	line?: number | null;
}

// ============================================================================
// Permission Types
// ============================================================================

export interface PermissionOption {
	optionId: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequest {
	requestId: string;
	toolCallId: string;
	title?: string;
	options: PermissionOption[];
}

// ============================================================================
// Plan Types
// ============================================================================

export interface PlanEntry {
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority: "high" | "medium" | "low";
}

// ============================================================================
// Tool Call Update (used in permission requests)
// ============================================================================

export interface ToolCallUpdate {
	toolCallId: string;
	title?: string | null;
	status?: ToolCallStatus | null;
	kind?: ToolKind | null;
	content?: ToolCallContent[] | null;
	locations?: ToolCallLocation[] | null;
	rawInput?: { [k: string]: unknown };
	rawOutput?: { [k: string]: unknown };
}

// ============================================================================
// Message Content (union type for all content blocks)
// ============================================================================

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
			data: string;
			mimeType: string;
			uri?: string;
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
			toolCall: ToolCallUpdate;
			options: PermissionOption[];
			selectedOptionId?: string;
			isCancelled?: boolean;
			isActive?: boolean;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };

// ============================================================================
// Chat Message
// ============================================================================

export interface ChatMessage {
	id: string;
	role: Role;
	content: MessageContent[];
	timestamp: Date;
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionState =
	| "initializing"
	| "authenticating"
	| "ready"
	| "busy"
	| "error"
	| "disconnected";

export interface AuthenticationMethod {
	id: string;
	name: string;
	description?: string | null;
}

export interface SlashCommand {
	name: string;
	description: string;
	hint?: string | null;
}

export interface ChatSession {
	sessionId: string | null;
	state: SessionState;
	agentId: string;
	agentDisplayName: string;
	authMethods: AuthenticationMethod[];
	availableCommands?: SlashCommand[];
	createdAt: Date;
	lastActivityAt: Date;
	workingDirectory: string;
}
