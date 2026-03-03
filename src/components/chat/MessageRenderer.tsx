import * as React from "react";
import type {
	ChatMessage,
	MessageContent,
} from "../../domain/models/chat-message";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type AgentClientPlugin from "../../plugin";
import { MessageContentRenderer } from "./MessageContentRenderer";

interface MessageRendererProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	agentClient?: IAgentClient;
	activeSendingToolCallTarget?: { messageId: string; contentIndex: number } | null;
	/** Callback to approve a permission request */
	onApprovePermission?: (requestId: string, optionId: string) => Promise<void>;
}

/**
 * Group consecutive image contents together for horizontal scrolling display.
 * Non-image contents are wrapped individually.
 */
function groupContent(
	contents: MessageContent[],
): Array<
	| { type: "images"; items: Array<{ content: MessageContent; index: number }> }
	| { type: "single"; item: MessageContent; index: number }
> {
	const groups: Array<
		| { type: "images"; items: Array<{ content: MessageContent; index: number }> }
		| { type: "single"; item: MessageContent; index: number }
	> = [];

	let currentImageGroup: Array<{ content: MessageContent; index: number }> = [];

	for (let i = 0; i < contents.length; i++) {
		const content = contents[i];
		if (content.type === "image") {
			currentImageGroup.push({ content, index: i });
		} else {
			// Flush any pending image group
			if (currentImageGroup.length > 0) {
				groups.push({ type: "images", items: currentImageGroup });
				currentImageGroup = [];
			}
			groups.push({ type: "single", item: content, index: i });
		}
	}

	// Flush remaining images
	if (currentImageGroup.length > 0) {
		groups.push({ type: "images", items: currentImageGroup });
	}

	return groups;
}

export function MessageRenderer({
	message,
	plugin,
	agentClient,
	activeSendingToolCallTarget,
	onApprovePermission,
}: MessageRendererProps) {
	const groups = groupContent(message.content);
	const hasPlanContent = message.content.some((content) => content.type === "plan");

	return (
		<div
			className={`obsius-message-renderer ${message.role === "user" ? "obsius-message-user" : "obsius-message-assistant"}`}
		>
			{message.role === "user" && (
				<div className="obsius-message-user-titlebar">User Prompt</div>
			)}
			{groups.map((group, idx) => {
				if (group.type === "images") {
					// Render images in horizontal scroll container
					return (
						<div key={idx} className="obsius-message-content-item">
							<div className="obsius-message-images-strip">
								{group.items.map((item, imgIdx) => (
									<MessageContentRenderer
										key={imgIdx}
										content={item.content}
										plugin={plugin}
										messageId={message.id}
										contentIndex={item.index}
										messageRole={message.role}
										hasPlanContent={hasPlanContent}
										activeSendingToolCallTarget={activeSendingToolCallTarget}
										agentClient={agentClient}
										onApprovePermission={onApprovePermission}
									/>
								))}
							</div>
						</div>
					);
				} else {
					// Render single non-image content
					return (
						<div key={idx} className="obsius-message-content-item">
							<MessageContentRenderer
								content={group.item}
								plugin={plugin}
								messageId={message.id}
								contentIndex={group.index}
								messageRole={message.role}
								hasPlanContent={hasPlanContent}
								activeSendingToolCallTarget={activeSendingToolCallTarget}
								agentClient={agentClient}
								onApprovePermission={onApprovePermission}
							/>
						</div>
					);
				}
			})}
		</div>
	);
}
