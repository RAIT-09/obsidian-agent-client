import * as acp from "@zed-industries/agent-client-protocol";

/**
 * Bridge file for gradual migration to domain models.
 *
 * This file re-exports types from the domain layer, allowing existing
 * code to continue using `import { ... } from "./types/acp-types"` without
 * changes while we migrate to the new architecture.
 *
 * Once migration is complete, we can update imports to directly reference
 * domain models and remove this file.
 */

// Re-export domain models
export type {
	ChatMessage,
	MessageContent,
	Role,
	ToolCallStatus,
	ToolKind,
	ToolCallContent,
	DiffContent,
	TerminalContent,
	ToolCallLocation,
	PermissionOption,
	PlanEntry,
	ToolCallUpdate,
} from "../domain/models/chat-message";

// ACP Client interface - this is an adapter/service layer concern,
// not a domain model, so it remains here for now
export interface IAcpClient extends acp.Client {
	handlePermissionResponse(requestId: string, optionId: string): void;
	cancelAllOperations(): void;
	resetCurrentMessage(): void;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
}
