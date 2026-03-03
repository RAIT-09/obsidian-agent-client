import * as React from "react";
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type AgentClientPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { ToolCallRenderer } from "./ToolCallRenderer";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	contentIndex?: number;
	messageRole?: "user" | "assistant";
	hasPlanContent?: boolean;
	activeSendingToolCallTarget?: { messageId: string; contentIndex: number } | null;
	agentClient?: IAgentClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (requestId: string, optionId: string) => Promise<void>;
}

export function MessageContentRenderer({
	content,
	plugin,
	messageId,
	contentIndex,
	messageRole,
	hasPlanContent = false,
	activeSendingToolCallTarget,
	agentClient,
	onApprovePermission,
}: MessageContentRendererProps): React.ReactElement | null {
	switch (content.type) {
		case "text":
			if (messageRole === "assistant" && content.text.trim().length === 0) {
				return null;
			}
			// User messages: render with mention support
			// Assistant messages: render as markdown
			if (messageRole === "user") {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return <MarkdownTextRenderer text={content.text} plugin={plugin} />;

		case "text_with_context":
			// User messages with auto-mention context
			if (
				messageRole === "assistant" &&
				content.text.trim().length === 0 &&
				!content.autoMentionContext
			) {
				return null;
			}
			return (
				<TextWithMentions
					text={content.text}
					autoMentionContext={content.autoMentionContext}
					plugin={plugin}
				/>
			);

		case "agent_thought":
			return <CollapsibleThought text={content.text} plugin={plugin} />;

		case "tool_call":
			return (
				<ToolCallRenderer
					content={content}
					plugin={plugin}
					hasPlanContent={hasPlanContent}
					showLiveIndicator={
						!!activeSendingToolCallTarget &&
						activeSendingToolCallTarget.messageId === messageId &&
						activeSendingToolCallTarget.contentIndex === contentIndex
					}
					agentClient={agentClient}
					onApprovePermission={onApprovePermission}
				/>
			);

		case "plan": {
			return (
				<div className="obsius-message-plan">
					<div className="obsius-message-plan-title">Todo Plan</div>
					<div className="obsius-message-plan-list" role="list">
						{content.entries.map((entry, idx) => (
							<div
								key={idx}
								role="listitem"
								className={`obsius-message-plan-entry obsius-plan-status-${entry.status}`}
							>
								<span className="obsius-message-plan-entry-icon" aria-hidden="true">
									{entry.status === "completed"
											? "\u00A0"
											: entry.status === "in_progress"
												? "◉"
												: "○"}
								</span>
								<span className="obsius-message-plan-entry-text">
									{entry.content}
								</span>
							</div>
						))}
					</div>
				</div>
			);
		}

		case "terminal":
			return (
				<TerminalRenderer
					terminalId={content.terminalId}
					agentClient={agentClient || null}
					plugin={plugin}
				/>
			);

		case "image":
			return (
				<div className="obsius-message-image">
					<img
						src={`data:${content.mimeType};base64,${content.data}`}
						alt="Attached image"
						className="obsius-message-image-thumbnail"
					/>
				</div>
			);

		default:
			return <span>Unsupported content type</span>;
	}
}
