import * as React from "react";
import { setIcon } from "obsidian";
import type { MessageContent } from "../types/chat";
import type { ITerminalClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { LucideIcon } from "./LucideIcon";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	messageRole?: "user" | "assistant";
	terminalClient?: ITerminalClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export function MessageContentRenderer({
	content,
	plugin,
	messageId,
	messageRole,
	terminalClient,
	onApprovePermission,
}: MessageContentRendererProps) {
	switch (content.type) {
		case "text":
			// User messages: render with mention support
			// Assistant messages: render as markdown
			if (messageRole === "user") {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return <MarkdownTextRenderer text={content.text} plugin={plugin} />;

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
			return <CollapsibleThought text={content.text} plugin={plugin} />;

		case "tool_call":
			return (
				<ToolCallRenderer
					content={content}
					plugin={plugin}
					terminalClient={terminalClient}
					onApprovePermission={onApprovePermission}
				/>
			);

		case "plan": {
			const showEmojis = plugin.settings.displaySettings.showEmojis;
			return (
				<div className="agent-client-message-plan">
					<div className="agent-client-message-plan-title">
						{showEmojis && (
						<LucideIcon
							name="list-checks"
							className="agent-client-message-plan-label-icon"
						/>
					)}
					Plan
					</div>
					{content.entries.map((entry, idx) => (
						<div
							key={idx}
							className={`agent-client-message-plan-entry agent-client-plan-status-${entry.status}`}
						>
							{showEmojis && (
								<span
									className={`agent-client-message-plan-entry-icon agent-client-status-${entry.status}`}
								>
									<LucideIcon
										name={
											entry.status === "completed"
												? "check"
												: entry.status ===
													  "in_progress"
													? "loader"
													: "circle"
										}
									/>
								</span>
							)}{" "}
							{entry.content}
						</div>
					))}
				</div>
			);
		}

		case "terminal":
			return (
				<TerminalRenderer
					terminalId={content.terminalId}
					terminalClient={terminalClient || null}
					plugin={plugin}
				/>
			);

		case "image":
			return (
				<div className="agent-client-message-image">
					<img
						src={`data:${content.mimeType};base64,${content.data}`}
						alt="Attached image"
						className="agent-client-message-image-thumbnail"
					/>
				</div>
			);

		case "resource_link":
			return (
				<div className="agent-client-message-resource-link">
					<span
						className="agent-client-message-resource-link-icon"
						ref={(el) => {
							if (el) setIcon(el, "file");
						}}
					/>
					<span className="agent-client-message-resource-link-name">
						{content.name}
					</span>
				</div>
			);

		default:
			return <span>Unsupported content type</span>;
	}
}
