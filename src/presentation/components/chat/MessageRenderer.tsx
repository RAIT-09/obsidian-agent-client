import * as React from "react";
import type { ChatMessage } from "../../../core/domain/models/chat-message";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
}

/**
 * Generates a stable key for message content items.
 * Uses toolCallId for tool_call content, otherwise falls back to message.id + index.
 */
function getContentKey(
	content: ChatMessage["content"][number],
	messageId: string,
	idx: number,
): string {
	if (content.type === "tool_call" && content.toolCallId) {
		return content.toolCallId;
	}
	return `${messageId}-${idx}`;
}

export const MessageRenderer = React.memo(function MessageRenderer({
	message,
	plugin,
	acpClient,
	handlePermissionUseCase,
}: MessageRendererProps) {
	return (
		<div
			className={`message-renderer ${message.role === "user" ? "message-user" : "message-assistant"}`}
		>
			{message.content.map((content, idx) => (
				<div key={getContentKey(content, message.id, idx)}>
					<MessageContentRenderer
						content={content}
						plugin={plugin}
						messageId={message.id}
						messageRole={message.role}
						acpClient={acpClient}
						handlePermissionUseCase={handlePermissionUseCase}
					/>
				</div>
			))}
		</div>
	);
});
