import * as React from "react";
import type { ChatMessage } from "../../../types";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<{ success: boolean; error?: string }>;
}

export function MessageRenderer({
	message,
	plugin,
	acpClient,
	onApprovePermission,
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
						onApprovePermission={onApprovePermission}
					/>
				</div>
			))}
		</div>
	);
}
