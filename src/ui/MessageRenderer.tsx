import * as React from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../domain/models/chat-message";
import type { ITerminalClient } from "../domain/ports/terminal-client.port";
import type AgentClientPlugin from "../plugin";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	terminalClient?: ITerminalClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

/**
 * Group consecutive image/resource_link contents together for horizontal display.
 * Non-attachment contents are wrapped individually.
 */
function groupContent(
	contents: MessageContent[],
): Array<
	| { type: "attachments"; items: MessageContent[] }
	| { type: "single"; item: MessageContent }
> {
	const groups: Array<
		| { type: "attachments"; items: MessageContent[] }
		| { type: "single"; item: MessageContent }
	> = [];

	let currentAttachmentGroup: MessageContent[] = [];

	for (const content of contents) {
		if (content.type === "image" || content.type === "resource_link") {
			currentAttachmentGroup.push(content);
		} else {
			// Flush any pending attachment group
			if (currentAttachmentGroup.length > 0) {
				groups.push({
					type: "attachments",
					items: currentAttachmentGroup,
				});
				currentAttachmentGroup = [];
			}
			groups.push({ type: "single", item: content });
		}
	}

	// Flush remaining attachments
	if (currentAttachmentGroup.length > 0) {
		groups.push({ type: "attachments", items: currentAttachmentGroup });
	}

	return groups;
}

export function MessageRenderer({
	message,
	plugin,
	terminalClient,
	onApprovePermission,
}: MessageRendererProps) {
	const groups = groupContent(message.content);

	return (
		<div
			className={`agent-client-message-renderer ${message.role === "user" ? "agent-client-message-user" : "agent-client-message-assistant"}`}
		>
			{groups.map((group, idx) => {
				if (group.type === "attachments") {
					// Render attachments (images + resource_links) in horizontal strip
					return (
						<div
							key={idx}
							className="agent-client-message-images-strip"
						>
							{group.items.map((content, imgIdx) => (
								<MessageContentRenderer
									key={imgIdx}
									content={content}
									plugin={plugin}
									messageId={message.id}
									messageRole={message.role}
									terminalClient={terminalClient}
									onApprovePermission={onApprovePermission}
								/>
							))}
						</div>
					);
				} else {
					// Render single non-image content
					return (
						<div key={idx}>
							<MessageContentRenderer
								content={group.item}
								plugin={plugin}
								messageId={message.id}
								messageRole={message.role}
								terminalClient={terminalClient}
								onApprovePermission={onApprovePermission}
							/>
						</div>
					);
				}
			})}
		</div>
	);
}
