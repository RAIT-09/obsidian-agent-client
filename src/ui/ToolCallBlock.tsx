import * as React from "react";
const { useMemo } = React;
import { FileSystemAdapter } from "obsidian";
import type { MessageContent } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import { LucideIcon } from "./shared/IconButton";
import { toRelativePath } from "../utils/paths";
import { ToolCallContentView } from "./ToolCallContentView";
// import { MarkdownRenderer } from "./shared/MarkdownRenderer";

interface ToolCallBlockProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	terminalClient?: AcpClient;
	/** Whether this tool call's body is expanded */
	isExpanded?: boolean;
	/** Toggle the body. Owned above the virtualized list so the state
	 *  survives scrolling the row out of view. */
	onToggleExpanded?: (toolCallId: string) => void;
}

export const ToolCallBlock = React.memo(function ToolCallBlock({
	content,
	plugin,
	terminalClient,
	isExpanded = false,
	onToggleExpanded,
}: ToolCallBlockProps) {
	const {
		toolCallId,
		kind,
		title,
		status,
		locations,
		rawInput,
		rawOutput,
		content: toolContent,
	} = content;

	// Images render beside the collapsed row, so they stay visible without
	// expanding; everything else lives in the collapsible body.
	const images = useMemo(
		() =>
			(toolContent ?? []).flatMap((item) =>
				item.type === "content" && item.content.type === "image"
					? [item.content]
					: [],
			),
		[toolContent],
	);

	// Get vault path for relative path display
	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}, [plugin]);

	// Get showEmojis setting
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	// Get Lucide icon name based on tool kind
	const getKindIconName = (kind?: string): string => {
		switch (kind) {
			case "read":
				return "book-open";
			case "edit":
				return "pencil";
			case "delete":
				return "trash";
			case "move":
				return "folder-open";
			case "search":
				return "search";
			case "execute":
				return "square-terminal";
			case "think":
				return "message-circle-more";
			case "fetch":
				return "globe";
			case "switch_mode":
				return "arrow-left-right";
			default:
				return "hammer";
		}
	};

	return (
		<div className="agent-client-message-tool-call">
			{/* Header — the whole row toggles, like CollapsibleThought */}
			<div
				className="agent-client-message-tool-call-header agent-client-message-tool-call-header-toggle"
				onClick={() => onToggleExpanded?.(toolCallId)}
			>
				<div className="agent-client-message-tool-call-title">
					{showEmojis && (
						<LucideIcon
							name={getKindIconName(kind)}
							className="agent-client-message-tool-call-icon"
						/>
					)}
					<span className="agent-client-message-tool-call-title-text">
						{title}
					</span>
					{status !== "completed" && (
						<LucideIcon
							name={status === "failed" ? "x" : "ellipsis"}
							className={`agent-client-message-tool-call-status-icon agent-client-status-${status}`}
						/>
					)}
					<LucideIcon
						name={isExpanded ? "chevron-down" : "chevron-right"}
						className="agent-client-message-tool-call-expand-icon"
					/>
				</div>
				{kind === "execute" &&
					rawInput &&
					typeof rawInput.command === "string" && (
						<div className="agent-client-message-tool-call-command">
							<code>
								{rawInput.command}
								{Array.isArray(rawInput.args) &&
									rawInput.args.length > 0 &&
									` ${(rawInput.args as string[]).join(" ")}`}
							</code>
						</div>
					)}
				{locations && locations.length > 0 && (
					<div className="agent-client-message-tool-call-locations">
						{locations.map((loc, idx) => (
							<span
								key={idx}
								className="agent-client-message-tool-call-location"
							>
								{toRelativePath(loc.path, vaultPath)}
								{loc.line != null && `:${loc.line}`}
							</span>
						))}
					</div>
				)}
			</div>

			{/* Images sit outside the collapsible body: a result you want to
			    see at a glance, not detail you open. */}
			{images.length > 0 && (
				<div className="agent-client-tool-result-images-strip">
					{images.map((image, index) => (
						<img
							key={index}
							className="agent-client-tool-result-image-thumbnail"
							src={`data:${image.mimeType};base64,${image.data}`}
							alt="Tool result"
						/>
					))}
				</div>
			)}

			{/* Collapsible body. Hidden with CSS rather than unmounted so an
			    embedded TerminalBlock keeps polling: the client drops a
			    released terminal 30s later, and a remount after that would
			    find nothing left to show. */}
			<div
				className="agent-client-message-tool-call-body"
				hidden={!isExpanded}
			>
				<ToolCallContentView
					content={toolContent}
					rawOutput={rawOutput}
					plugin={plugin}
					terminalClient={terminalClient}
					omitImages
				/>
			</div>
		</div>
	);
});
