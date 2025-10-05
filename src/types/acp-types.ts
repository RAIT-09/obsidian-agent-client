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
			status: acp.ToolCallStatus;
			kind?: acp.ToolKind;
			content?: acp.ToolCallContent[];
			locations?: acp.ToolCallLocation[];
			rawInput?: { [k: string]: unknown };
			rawOutput?: { [k: string]: unknown };
			permissionRequest?: {
				requestId: string;
				options: acp.PermissionOption[];
				selectedOptionId?: string;
				isCancelled?: boolean;
			};
	  }
	| {
			type: "plan";
			entries: acp.PlanEntry[];
	  }
	| {
			type: "permission_request";
			toolCall: acp.ToolCallUpdate;
			options: acp.PermissionOption[];
			selectedOptionId?: string;
			isCancelled?: boolean;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };

export interface ChatMessage {
	id: string;
	role: acp.Role;
	content: MessageContent[];
	timestamp: Date;
}
