import * as acp from "@zed-industries/agent-client-protocol";

// ACP Client interface - extracted from ChatView.tsx
export interface IAcpClient extends acp.Client {
	handlePermissionResponse(requestId: string, optionId: string): void;
	cancelAllOperations(): void;
	resetCurrentMessage(): void;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
}

// Message types based on ACP schema
export type MessageRole = "user" | "assistant";

export type MessageContent =
	| {
			type: "text";
			text: string;
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
			status: "pending" | "in_progress" | "completed" | "failed";
			kind?:
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
			content?: acp.ToolCallContent[];
	  }
	| {
			type: "plan";
			entries: {
				content: string;
				status: "pending" | "in_progress" | "completed";
				priority: "high" | "medium" | "low";
			}[];
	  }
	| {
			type: "permission_request";
			toolCall: {
				toolCallId: string;
			};
			options: {
				optionId: string;
				name: string;
				kind?: "allow_always" | "allow_once" | "reject_once";
			}[];
			selectedOptionId?: string;
			isCancelled?: boolean;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: MessageContent[];
	timestamp: Date;
}
