import * as React from "react";
import type { MessageContent } from "../../../core/domain/models/chat-message";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { ToolCallRenderer } from "./ToolCallRenderer";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	messageRole?: "user" | "assistant";
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
}

export const MessageContentRenderer = React.memo(
	function MessageContentRenderer({
		content,
		plugin,
		messageId,
		messageRole,
		acpClient,
		handlePermissionUseCase,
	}: MessageContentRendererProps) {
		switch (content.type) {
			case "text":
				// User messages: render with mention support
				// Assistant messages: render as markdown
				if (messageRole === "user") {
					return (
						<TextWithMentions text={content.text} plugin={plugin} />
					);
				}
				return (
					<MarkdownTextRenderer text={content.text} plugin={plugin} />
				);

			case "text_with_context":
				// User messages with auto-mention context
				return (
					<TextWithMentions
						text={content.text}
						autoMentionContext={content.autoMentionContext}
						plugin={plugin}
					/>
				);

			case "agent_thought":
				return (
					<CollapsibleThought text={content.text} plugin={plugin} />
				);

			case "tool_call":
				return (
					<ToolCallRenderer
						content={content}
						plugin={plugin}
						acpClient={acpClient}
						handlePermissionUseCase={handlePermissionUseCase}
					/>
				);

			case "plan":
				return (
					<div className="message-plan">
						<div className="message-plan-title">📋 Plan</div>
						{content.entries.map((entry, idx) => (
							<div key={idx} className="message-plan-entry">
								<span
									className={`message-plan-entry-icon status-${entry.status}`}
								>
									{entry.status === "completed"
										? "✓"
										: entry.status === "in_progress"
											? "⏳"
											: "⭕"}
								</span>{" "}
								{entry.content}
							</div>
						))}
					</div>
				);

			case "terminal":
				return (
					<TerminalRenderer
						terminalId={content.terminalId}
						acpClient={acpClient || null}
						plugin={plugin}
					/>
				);

			default:
				return <span>Unsupported content type</span>;
		}
	},
);
