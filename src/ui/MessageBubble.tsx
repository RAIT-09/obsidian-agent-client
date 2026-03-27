import * as React from "react";
const { useState, useCallback } = React;
import { setIcon } from "obsidian";
import type {
	ChatMessage,
	MessageContent,
} from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import { MarkdownRenderer } from "./shared/MarkdownRenderer";
import { TerminalBlock } from "./TerminalBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { LucideIcon } from "./shared/IconButton";

// ---------------------------------------------------------------------------
// TextWithMentions (internal helper)
// ---------------------------------------------------------------------------

interface TextWithMentionsProps {
	text: string;
	plugin: AgentClientPlugin;
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

// Function to render text with @mentions and optional auto-mention
function TextWithMentions({
	text,
	plugin,
	autoMentionContext,
}: TextWithMentionsProps): React.ReactElement {
	// Match @[[filename]] format only
	const mentionRegex = /@\[\[([^\]]+)\]\]/g;
	const parts: React.ReactNode[] = [];

	// Add auto-mention badge first if provided
	if (autoMentionContext) {
		const displayText = autoMentionContext.selection
			? `@${autoMentionContext.noteName}:${autoMentionContext.selection.fromLine}-${autoMentionContext.selection.toLine}`
			: `@${autoMentionContext.noteName}`;

		parts.push(
			<span
				key="auto-mention"
				className="agent-client-text-mention"
				onClick={() => {
					void plugin.app.workspace.openLinkText(
						autoMentionContext.notePath,
						"",
					);
				}}
			>
				{displayText}
			</span>,
		);
		parts.push("\n");
	}

	let lastIndex = 0;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Add text before the mention
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		// Extract filename from [[brackets]]
		const noteName = match[1];

		// Check if file actually exists
		const file = plugin.app.vault
			.getMarkdownFiles()
			.find((f) => f.basename === noteName);

		if (file) {
			// File exists - render as clickable mention
			parts.push(
				<span
					key={match.index}
					className="agent-client-text-mention"
					onClick={() => {
						void plugin.app.workspace.openLinkText(file.path, "");
					}}
				>
					@{noteName}
				</span>,
			);
		} else {
			// File doesn't exist - render as plain text
			parts.push(`@${noteName}`);
		}

		lastIndex = match.index + match[0].length;
	}

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <div className="agent-client-text-with-mentions">{parts}</div>;
}

// ---------------------------------------------------------------------------
// CollapsibleThought (internal helper)
// ---------------------------------------------------------------------------

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	return (
		<div
			className="agent-client-collapsible-thought"
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div className="agent-client-collapsible-thought-header">
				{showEmojis && (
					<LucideIcon
						name="lightbulb"
						className="agent-client-collapsible-thought-label-icon"
					/>
				)}
				Thinking
				<span className="agent-client-collapsible-thought-icon">
					{isExpanded ? "▼" : "▶"}
				</span>
			</div>
			{isExpanded && (
				<div className="agent-client-collapsible-thought-content">
					<MarkdownRenderer text={text} plugin={plugin} />
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// ContentBlock (internal helper, formerly MessageContentRenderer)
// ---------------------------------------------------------------------------

interface ContentBlockProps {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	messageRole?: "user" | "assistant";
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

function ContentBlock({
	content,
	plugin,
	messageId,
	messageRole,
	terminalClient,
	onApprovePermission,
}: ContentBlockProps) {
	switch (content.type) {
		case "text":
			// User messages: render with mention support
			// Assistant messages: render as markdown
			if (messageRole === "user") {
				return <TextWithMentions text={content.text} plugin={plugin} />;
			}
			return <MarkdownRenderer text={content.text} plugin={plugin} />;

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
				<ToolCallBlock
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
				<TerminalBlock
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

// ---------------------------------------------------------------------------
// MessageBubble (exported, formerly MessageRenderer)
// ---------------------------------------------------------------------------

export interface MessageBubbleProps {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

/**
 * Extract plain text from message contents for clipboard copy.
 */
function extractTextContent(contents: MessageContent[]): string {
	return contents
		.filter((c) => c.type === "text" || c.type === "text_with_context")
		.map((c) => ("text" in c ? c.text : ""))
		.join("\n");
}

/**
 * Copy button that shows a check icon briefly after copying.
 * Uses callback ref for Obsidian's setIcon DOM manipulation.
 */
function CopyButton({ contents }: { contents: MessageContent[] }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(() => {
		const text = extractTextContent(contents);
		if (!text) return;
		void navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => {});
	}, [contents]);

	const iconRef = useCallback(
		(el: HTMLButtonElement | null) => {
			if (el) setIcon(el, copied ? "check" : "copy");
		},
		[copied],
	);

	return (
		<button
			className="clickable-icon agent-client-message-action-button"
			onClick={handleCopy}
			aria-label="Copy message"
			ref={iconRef}
		/>
	);
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

export const MessageBubble = React.memo(function MessageBubble({
	message,
	plugin,
	terminalClient,
	onApprovePermission,
}: MessageBubbleProps) {
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
								<ContentBlock
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
							<ContentBlock
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
			{message.content.some(
				(c) =>
					(c.type === "text" || c.type === "text_with_context") &&
					c.text,
			) && (
				<div className="agent-client-message-actions">
					<CopyButton contents={message.content} />
				</div>
			)}
		</div>
	);
});
