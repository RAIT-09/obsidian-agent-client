import * as React from "react";
const { useMemo } = React;
import type { MessageContent, IAcpClient } from "../../types/acp-types";
import type AgentClientPlugin from "../../main";
import type { HandlePermissionUseCase } from "../../use-cases/handle-permission.use-case";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { Logger } from "../../utils/logger";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	messageRole?: "user" | "assistant";
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
	updateMessageContent?: (
		messageId: string,
		updatedContent: MessageContent,
	) => void;
	onPermissionSelected?: (requestId: string, optionId: string) => void;
}

export function MessageContentRenderer({
	content,
	plugin,
	messageId,
	messageRole,
	acpClient,
	handlePermissionUseCase,
	updateMessageContent,
	onPermissionSelected,
}: MessageContentRendererProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	switch (content.type) {
		case "text":
			// User messages: render with mention support
			// Assistant messages: render as markdown
			if (messageRole === "user") {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return <MarkdownTextRenderer text={content.text} plugin={plugin} />;

		case "agent_thought":
			return <CollapsibleThought text={content.text} plugin={plugin} />;

		case "tool_call":
			return (
				<ToolCallRenderer
					content={content}
					plugin={plugin}
					acpClient={acpClient}
					handlePermissionUseCase={handlePermissionUseCase}
					onPermissionSelected={onPermissionSelected}
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
}
