import * as React from "react";
const { useState, useMemo } = React;
import { FileSystemAdapter } from "obsidian";
import type { MessageContent } from "../../domain/models/chat-message";
import type { ITerminalClient } from "../../domain/ports/terminal-client.port";
import type AgentClientPlugin from "../../plugin";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
import { LucideIcon } from "./LucideIcon";
import { toRelativePath } from "../../shared/path-utils";
import * as Diff from "diff";
// import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface ToolCallRendererProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	terminalClient?: ITerminalClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export function ToolCallRenderer({
	content,
	plugin,
	terminalClient,
	onApprovePermission,
}: ToolCallRendererProps) {
	const {
		kind,
		title,
		status,
		toolCallId,
		permissionRequest,
		locations,
		rawInput,
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
			{toolContent &&
				toolContent.map((item, index) => {
					if (item.type === "terminal") {
						return (
							<TerminalRenderer
								key={index}
								terminalId={item.terminalId}
								terminalClient={terminalClient || null}
								plugin={plugin}
							/>
						);
					}
					if (item.type === "diff") {
						return (
							<DiffRenderer
								key={index}
								diff={item}
								plugin={plugin}
								autoCollapse={
									plugin.settings.displaySettings
										.autoCollapseDiffs
								}
								collapseThreshold={
									plugin.settings.displaySettings
										.diffCollapseThreshold
								}
							/>
						);
					}
					return null;
				})}

			{/* Permission request section */}
			{permissionRequest && (
				<PermissionRequestSection
					permissionRequest={{
						...permissionRequest,
						selectedOptionId: selectedOptionId,
					}}
					toolCallId={toolCallId}
					plugin={plugin}
					onApprovePermission={onApprovePermission}
					onOptionSelected={setSelectedOptionId}
				/>
			)}
		</div>
	);
}

// ============================================================
// Diff renderer component
// ============================================================
interface DiffRendererProps {
	diff: {
		type: "diff";
		path: string;
		oldText?: string | null;
		newText: string;
	};
	plugin: AgentClientPlugin;
	autoCollapse?: boolean;
	collapseThreshold?: number;
}

/**
 * Represents a single line in a diff view
 * @property type - The type of change: added, removed, or unchanged context
 * @property oldLineNumber - Line number in the old file (undefined for added lines)
 * @property newLineNumber - Line number in the new file (undefined for removed lines)
 * @property content - The text content of the line
 * @property wordDiff - Optional word-level diff for lines that were modified (adjacent removed+added pairs)
 */
interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: { type: "added" | "removed" | "context"; value: string }[];
}

/**
 * Check if the diff represents a new file (no old content)
 */
function isNewFile(diff: DiffRendererProps["diff"]): boolean {
	return (
		diff.oldText === null ||
		diff.oldText === undefined ||
		diff.oldText === ""
	);
}

// Helper function to map diff parts to our internal format
function mapDiffParts(
	parts: Diff.Change[],
): { type: "added" | "removed" | "context"; value: string }[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

// Helper function to render word-level diffs
function renderWordDiff(
	wordDiff: { type: "added" | "removed" | "context"; value: string }[],
	lineType: "added" | "removed",
) {
	// Filter parts based on line type to avoid rendering null elements
	const filteredParts = wordDiff.filter((part) => {
		// For removed lines, skip added parts
		if (lineType === "removed" && part.type === "added") {
			return false;
		}
		// For added lines, skip removed parts
		if (lineType === "added" && part.type === "removed") {
			return false;
		}
		return true;
	});

	return (
		<>
			{filteredParts.map((part, partIdx) => {
				if (part.type === "added") {
					return (
						<span
							key={partIdx}
							className="agent-client-diff-word-added"
						>
							{part.value}
						</span>
					);
				} else if (part.type === "removed") {
					return (
						<span
							key={partIdx}
							className="agent-client-diff-word-removed"
						>
							{part.value}
						</span>
					);
				}
				return <span key={partIdx}>{part.value}</span>;
			})}
		</>
	);
}

// Number of context lines to show around changes
const CONTEXT_LINES = 3;

function DiffRenderer({
	diff,
	autoCollapse = false,
	collapseThreshold = 10,
}: DiffRendererProps) {
	// Generate diff using the diff library
	const diffLines = useMemo(() => {
		if (isNewFile(diff)) {
			// New file - all lines are added
			const lines = diff.newText.split("\n");
			return lines.map(
				(line, idx): DiffLine => ({
					type: "added",
					newLineNumber: idx + 1,
					content: line,
				}),
			);
		}

		// Use structuredPatch to get a proper unified diff
		// At this point, oldText is guaranteed to be a non-empty string (checked by isNewFile)
		const oldText = diff.oldText || "";
		const patch = Diff.structuredPatch(
			"old",
			"new",
			oldText,
			diff.newText,
			"",
			"",
			{ context: CONTEXT_LINES },
		);

		const result: DiffLine[] = [];
		let oldLineNum = 0;
		let newLineNum = 0;

		// Process hunks
		for (const hunk of patch.hunks) {
			// Add hunk header only if there are multiple hunks
			// (helps users see gaps between different sections of changes)
			if (patch.hunks.length > 1) {
				result.push({
					type: "context",
					content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
				});
			}

			oldLineNum = hunk.oldStart;
			newLineNum = hunk.newStart;

			for (const line of hunk.lines) {
				const marker = line[0];
				const content = line.substring(1);

				if (marker === "+") {
					result.push({
						type: "added",
						newLineNumber: newLineNum++,
						content,
					});
				} else if (marker === "-") {
					result.push({
						type: "removed",
						oldLineNumber: oldLineNum++,
						content,
					});
				} else {
					// Context line (unchanged)
					result.push({
						type: "context",
						oldLineNumber: oldLineNum++,
						newLineNumber: newLineNum++,
						content,
					});
				}
			}
		}

		// Add word-level diff for modified lines that are adjacent
		for (let i = 0; i < result.length - 1; i++) {
			const current = result[i];
			const next = result[i + 1];

			// If we have a removed line followed by an added line, compute word diff
			if (current.type === "removed" && next.type === "added") {
				const wordDiff = Diff.diffWords(current.content, next.content);
				const mappedDiff = mapDiffParts(wordDiff);
				current.wordDiff = mappedDiff;
				next.wordDiff = mappedDiff;
			}
		}

		return result;
	}, [diff.oldText, diff.newText]);

	const renderLine = (line: DiffLine, idx: number) => {
		const isHunkHeader =
			line.type === "context" && line.content.startsWith("@@");

		if (isHunkHeader) {
			return (
				<div key={idx} className="agent-client-diff-hunk-header">
					{line.content}
				</div>
			);
		}

		let lineClass = "agent-client-diff-line";

		if (line.type === "added") {
			lineClass += " agent-client-diff-line-added";
		} else if (line.type === "removed") {
			lineClass += " agent-client-diff-line-removed";
		} else {
			lineClass += " agent-client-diff-line-context";
		}

		return (
			<div key={idx} className={lineClass}>
				<span className="agent-client-diff-line-content">
					{line.wordDiff &&
					(line.type === "added" || line.type === "removed")
						? renderWordDiff(line.wordDiff, line.type)
						: line.content}
				</span>
			</div>
		);
	};

	// Determine if collapsing is needed (only when exceeding threshold)
	const shouldCollapse = autoCollapse && diffLines.length > collapseThreshold;

	// Collapse state (initially collapsed if shouldCollapse is true)
	const [isCollapsed, setIsCollapsed] = useState(shouldCollapse);

	// Lines to display (threshold lines when collapsed)
	const visibleLines = isCollapsed
		? diffLines.slice(0, collapseThreshold)
		: diffLines;

	// Remaining lines count
	const remainingLines = diffLines.length - collapseThreshold;

	return (
		<div className="agent-client-tool-call-diff">
			{isNewFile(diff) ? (
				<div className="agent-client-diff-line-info">New file</div>
			) : null}
			<div className="agent-client-tool-call-diff-content">
				{visibleLines.map((line, idx) => renderLine(line, idx))}
			</div>
			{shouldCollapse && (
				<div
					className="agent-client-diff-expand-bar"
					onClick={() => setIsCollapsed(!isCollapsed)}
				>
					<span className="agent-client-diff-expand-text">
						{isCollapsed
							? `${remainingLines} more lines`
							: "Collapse"}
					</span>
					<span className="agent-client-diff-expand-icon">
						{isCollapsed ? "▶" : "▲"}
					</span>
				</div>
			)}
		</div>
	);
}
