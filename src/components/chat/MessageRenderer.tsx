import * as React from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp.adapter";
import type AgentClientPlugin from "../../main";
import type { HandlePermissionUseCase } from "../../use-cases/handle-permission.use-case";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
}

export function MessageRenderer({
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
				<div key={idx}>
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
}
