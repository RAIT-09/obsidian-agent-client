import * as React from "react";
const { useMemo } = React;
import type { MessageContent, IAcpClient } from "../../types/acp-types";
import type AgentClientPlugin from "../../main";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";
import { Logger } from "../../utils/logger";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	acpClient?: IAcpClient;
	updateMessageContent?: (
		messageId: string,
		updatedContent: MessageContent,
	) => void;
}

export function MessageContentRenderer({
	content,
	plugin,
	messageId,
	acpClient,
	updateMessageContent,
}: MessageContentRendererProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	switch (content.type) {
		case "text":
			// Check if this is a user message by looking at the parent message role
			// For now, we'll detect @mentions and render them appropriately
			if (content.text.includes("@")) {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return <MarkdownTextRenderer text={content.text} plugin={plugin} />;

		case "agent_thought":
			return <CollapsibleThought text={content.text} plugin={plugin} />;

		case "tool_call":
			return (
				<div className="message-tool-call">
					<div className="message-tool-call-title">
						🔧 {content.title}
					</div>
					<div
						className="message-tool-call-status"
						style={{
							marginBottom: content.content ? "8px" : "0",
						}}
					>
						Status: {content.status}
						{content.kind && ` | Kind: ${content.kind}`}
					</div>
					{content.content &&
						content.content.map((item, index) => {
							if (item.type === "terminal") {
								return (
									<TerminalRenderer
										key={index}
										terminalId={item.terminalId}
										acpClient={acpClient || null}
										plugin={plugin}
									/>
								);
							}
							// Handle other content types here if needed
							return null;
						})}
				</div>
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

		case "permission_request":
			const isSelected = content.selectedOptionId !== undefined;
			const isCancelled = content.isCancelled === true;
			const selectedOption = content.options.find(
				(opt) => opt.optionId === content.selectedOptionId,
			);

			return (
				<div className="message-permission-request">
					<div className="message-permission-request-title">
						🔐 Permission Request
					</div>
					<div className="message-permission-request-description">
						The agent is requesting permission to perform an action.
						Please choose how to proceed:
					</div>
					<div className="message-permission-request-options">
						{content.options.map((option) => {
							const isThisSelected =
								content.selectedOptionId === option.optionId;
							const buttonClasses = [
								"permission-option",
								option.kind
									? `permission-kind-${option.kind}`
									: "",
								isThisSelected ? "selected" : "",
								isSelected || isCancelled ? "disabled" : "",
							]
								.filter(Boolean)
								.join(" ");

							return (
								<button
									key={option.optionId}
									disabled={isSelected || isCancelled}
									className={buttonClasses}
									onClick={() => {
										if (
											acpClient &&
											messageId &&
											updateMessageContent &&
											!isCancelled
										) {
											// Update UI immediately
											const updatedContent = {
												...content,
												selectedOptionId:
													option.optionId,
											};
											updateMessageContent(
												messageId,
												updatedContent,
											);

											// Send response to agent
											acpClient.handlePermissionResponse(
												messageId,
												option.optionId,
											);
										} else {
											logger.warn(
												"Cannot handle permission response: missing acpClient, messageId, or updateMessageContent",
											);
										}
									}}
								>
									{option.name}
								</button>
							);
						})}
					</div>
					{isSelected && selectedOption && (
						<div className="message-permission-request-result selected">
							✓ Selected: {selectedOption.name}
						</div>
					)}
					{isCancelled && (
						<div className="message-permission-request-result cancelled">
							⚠ Cancelled: Permission request was cancelled
						</div>
					)}
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
