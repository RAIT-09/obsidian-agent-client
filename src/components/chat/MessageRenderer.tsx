import * as React from "react";
import type {
	ChatMessage,
	MessageContent,
	IAcpClient,
} from "../../types/acp-types";
import type AgentClientPlugin from "../../main";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	updateMessageContent?: (
		messageId: string,
		updatedContent: MessageContent,
	) => void;
	onPermissionSelected?: (requestId: string, optionId: string) => void;
}

export function MessageRenderer({
	message,
	plugin,
	acpClient,
	updateMessageContent,
	onPermissionSelected,
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
						updateMessageContent={updateMessageContent}
						onPermissionSelected={onPermissionSelected}
					/>
				</div>
			))}
		</div>
	);
}
