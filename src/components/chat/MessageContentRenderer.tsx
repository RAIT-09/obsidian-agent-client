import * as React from "react";
import type { MessageContent, AcpClient } from "../../types/acp-types";
import type AgentClientPlugin from "../../main";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleThought } from "./CollapsibleThought";
import { TerminalRenderer } from "./TerminalRenderer";
import { TextWithMentions } from "./TextWithMentions";

interface MessageContentRendererProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	acpClient?: AcpClient;
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
				<div
					style={{
						padding: "8px",
						marginTop: "4px",
						backgroundColor: "transparent",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "4px",
						fontSize: "12px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "4px",
							userSelect: "text",
						}}
					>
						🔧 {content.title}
					</div>
					<div
						style={{
							color: "var(--text-muted)",
							marginBottom: content.content ? "8px" : "0",
							userSelect: "text",
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
				<div
					style={{
						padding: "8px",
						marginTop: "4px",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "4px",
						fontSize: "12px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "4px",
							userSelect: "text",
						}}
					>
						📋 Plan
					</div>
					{content.entries.map((entry, idx) => (
						<div
							key={idx}
							style={{
								margin: "2px 0",
								padding: "2px 4px",
								borderLeft: "2px solid var(--text-muted)",
								userSelect: "text",
							}}
						>
							<span
								style={{
									color:
										entry.status === "completed"
											? "green"
											: entry.status === "in_progress"
												? "orange"
												: "var(--text-muted)",
									userSelect: "text",
								}}
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
				<div
					style={{
						padding: "12px",
						marginTop: "4px",
						backgroundColor: "var(--background-secondary)",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "8px",
						fontSize: "14px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "8px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							userSelect: "text",
						}}
					>
						🔐 Permission Request
					</div>
					<div
						style={{
							marginBottom: "12px",
							color: "var(--text-normal)",
							userSelect: "text",
						}}
					>
						The agent is requesting permission to perform an action.
						Please choose how to proceed:
					</div>
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "8px",
						}}
					>
						{content.options.map((option) => {
							const isThisSelected =
								content.selectedOptionId === option.optionId;
							return (
								<button
									key={option.optionId}
									disabled={isSelected || isCancelled}
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
											console.warn(
												"Cannot handle permission response: missing acpClient, messageId, or updateMessageContent",
											);
										}
									}}
									style={{
										padding: "8px 16px",
										border: "1px solid var(--background-modifier-border)",
										borderRadius: "6px",
										backgroundColor: isThisSelected
											? "var(--interactive-accent)"
											: isSelected || isCancelled
												? "var(--background-modifier-border)"
												: "var(--background-primary)",
										color: isThisSelected
											? "white"
											: isSelected || isCancelled
												? "var(--text-muted)"
												: "var(--text-normal)",
										cursor:
											isSelected || isCancelled
												? "not-allowed"
												: "pointer",
										fontSize: "13px",
										fontWeight: isThisSelected
											? "600"
											: "500",
										transition: "all 0.2s ease",
										minWidth: "80px",
										textAlign: "center",
										opacity:
											(isSelected && !isThisSelected) ||
											isCancelled
												? 0.5
												: 1,
										...(option.kind === "allow_always" &&
											!isSelected && {
												backgroundColor:
													"var(--color-green)",
												color: "white",
												borderColor:
													"var(--color-green)",
											}),
										...(option.kind === "reject_once" &&
											!isSelected && {
												backgroundColor:
													"var(--color-red)",
												color: "white",
												borderColor: "var(--color-red)",
											}),
										...(option.kind === "allow_once" &&
											!isSelected && {
												backgroundColor:
													"var(--color-orange)",
												color: "white",
												borderColor:
													"var(--color-orange)",
											}),
									}}
									onMouseEnter={(e) => {
										if (!option.kind && !isSelected) {
											e.currentTarget.style.backgroundColor =
												"var(--background-modifier-hover)";
										}
									}}
									onMouseLeave={(e) => {
										if (!option.kind && !isSelected) {
											e.currentTarget.style.backgroundColor =
												"var(--background-primary)";
										}
									}}
								>
									{option.name}
								</button>
							);
						})}
					</div>
					{isSelected && selectedOption && (
						<div
							style={{
								marginTop: "12px",
								padding: "8px",
								backgroundColor: "var(--background-primary)",
								borderRadius: "4px",
								fontSize: "13px",
								color: "var(--text-accent)",
								userSelect: "text",
							}}
						>
							✓ Selected: {selectedOption.name}
						</div>
					)}
					{isCancelled && (
						<div
							style={{
								marginTop: "12px",
								padding: "8px",
								backgroundColor: "var(--background-primary)",
								borderRadius: "4px",
								fontSize: "13px",
								color: "var(--color-orange)",
								userSelect: "text",
							}}
						>
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
				/>
			);

		default:
			return <span>Unsupported content type</span>;
	}
}
