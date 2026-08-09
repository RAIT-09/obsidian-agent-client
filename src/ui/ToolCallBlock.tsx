import * as React from "react";
const { useState, useMemo } = React;
import { FileSystemAdapter } from "obsidian";
import type { MessageContent } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import { PermissionBanner } from "./PermissionBanner";
import { LucideIcon } from "./shared/IconButton";
import { toRelativePath } from "../utils/paths";
import { ToolCallContentView } from "./ToolCallContentView";
// import { MarkdownRenderer } from "./shared/MarkdownRenderer";

interface ToolCallBlockProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export const ToolCallBlock = React.memo(function ToolCallBlock({
	content,
	plugin,
	terminalClient,
	onApprovePermission,
}: ToolCallBlockProps) {
	const {
		kind,
		title,
		status,
		permissionRequest,
		locations,
		rawInput,
		rawOutput,
		content: toolContent,
	} = content;

	// Local state for selected option (for immediate UI feedback)
	const [selectedOptionId, setSelectedOptionId] = useState<
		string | undefined
	>(permissionRequest?.selectedOptionId);

	// Update selectedOptionId when permissionRequest changes
	React.useEffect(() => {
		if (permissionRequest?.selectedOptionId !== selectedOptionId) {
			setSelectedOptionId(permissionRequest?.selectedOptionId);
		}
	}, [permissionRequest?.selectedOptionId]);

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
			{/* Header */}
			<div className="agent-client-message-tool-call-header">
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

			{/* Tool call content (diffs, terminal output, etc.) */}
			<ToolCallContentView
				content={toolContent}
				rawOutput={rawOutput}
				plugin={plugin}
				terminalClient={terminalClient}
			/>

			{/* Permission request section */}
			{permissionRequest && (
				<PermissionBanner
					permissionRequest={{
						...permissionRequest,
						selectedOptionId: selectedOptionId,
					}}
					showEmojis={showEmojis}
					onApprovePermission={onApprovePermission}
					onOptionSelected={setSelectedOptionId}
				/>
			)}
		</div>
	);
});
