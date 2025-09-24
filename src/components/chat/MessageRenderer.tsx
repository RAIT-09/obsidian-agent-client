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
}

export function MessageRenderer({
	message,
	plugin,
	acpClient,
	updateMessageContent,
}: MessageRendererProps) {
	return (
		<div
			style={{
				backgroundColor:
					message.role === "user"
						? "var(--background-primary)"
						: "transparent",
				padding: "0px 16px",
				borderRadius: message.role === "user" ? "8px" : "0px",
				width: "100%",
				border:
					message.role === "user"
						? "1px solid var(--background-modifier-border)"
						: "none",
				margin: "4px 0",
			}}
		>
			{message.content.map((content, idx) => (
				<div key={idx}>
					<MessageContentRenderer
						content={content}
						plugin={plugin}
						messageId={message.id}
						acpClient={acpClient}
						updateMessageContent={updateMessageContent}
					/>
				</div>
			))}
		</div>
	);
}
