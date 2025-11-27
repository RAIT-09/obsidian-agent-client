import * as React from "react";
import { setIcon } from "obsidian";
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

const Avatar = React.memo(function Avatar({ role }: { role: "user" | "assistant" }) {
	const iconRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, role === "user" ? "user" : "bot");
		}
	}, [role]);

	return (
		<div className="message-avatar">
			<div ref={iconRef} className="message-avatar-icon"></div>
		</div>
	);
});

export const MessageRenderer = React.memo(function MessageRenderer({
	message,
	plugin,
	acpClient,
	handlePermissionUseCase,
}: MessageRendererProps) {
	return (
		<div className={`message-renderer message-role-${message.role}`}>
			<Avatar role={message.role} />
			<div className="message-content-container">
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
		</div>
	);
});
