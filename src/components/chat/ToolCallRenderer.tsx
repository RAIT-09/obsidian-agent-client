import * as React from "react";
const { useState, useMemo } = React;
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
import { toRelativePath } from "../../shared/path-utils";
import * as Diff from "diff";
// import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface ToolCallRendererProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export function ToolCallRenderer({
	content,
	plugin,
	acpClient,
	onApprovePermission,
}: ToolCallRendererProps) {
	const {
		kind,
		title,
		status,
		toolCallId,
		permissionRequest,
		locations,
		// rawInput,
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
		const adapter = plugin.app.vault.adapter as { basePath?: string };
		return adapter.basePath || "";
	}, [plugin]);

	// Get icon based on kind
	const getKindIcon = (kind?: string) => {
		switch (kind) {
			case "read":
				return "📖";
			case "edit":
				return "✏️";
			case "delete":
				return "🗑️";
			case "move":
				return "📦";
			case "search":
				return "🔍";
			case "execute":
				return "💻";
			case "think":
				return "💭";
			case "fetch":
				return "🌐";
			case "switch_mode":
				return "🔄";
			default:
				return "🔧";
		}
	};

	return (
		<div className="agent-client-message-tool-call">
			{/* Header */}
			<div className="agent-client-message-tool-call-header">
				<div className="agent-client-message-tool-call-title">
					<span className="agent-client-message-tool-call-icon">
						{getKindIcon(kind)}
					</span>
					{title}
				</div>
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
				<div className="agent-client-message-tool-call-status">
					Status: {status}
				</div>
			</div>

			{/* Kind-specific details */}
			{/* kind && (
				<div className="agent-client-message-tool-call-details">
					<ToolCallDetails
						kind={kind}
						locations={locations}
						rawInput={rawInput}
						plugin={plugin}
					/>
				</div>
			)*/}

			{/* Tool call content (diffs, terminal output, etc.) */}
			{toolContent &&
				toolContent.map((item, index) => {
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
					/*
					if (item.type === "content") {
						// Handle content blocks (text, image, etc.)
						if ("text" in item.content) {
							return (
								<div key={index} className="agent-client-tool-call-content">
									<MarkdownTextRenderer
										text={item.content.text}
										app={plugin.app}
									/>
								</div>
							);
						}
						}*/
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

/*
// Details component that switches based on kind
interface ToolCallDetailsProps {
	kind: string;
	locations?: { path: string; line?: number | null }[];
	rawInput?: { [k: string]: unknown };
	plugin: AgentClientPlugin;
}

function ToolCallDetails({
	kind,
	locations,
	rawInput,
	plugin,
}: ToolCallDetailsProps) {
	switch (kind) {
		case "read":
			return <ReadDetails locations={locations} plugin={plugin} />;
		case "edit":
			return <EditDetails locations={locations} plugin={plugin} />;
		case "delete":
			return <DeleteDetails locations={locations} plugin={plugin} />;
		case "move":
			return <MoveDetails rawInput={rawInput} plugin={plugin} />;
		case "search":
			return <SearchDetails rawInput={rawInput} plugin={plugin} />;
		case "execute":
			return <ExecuteDetails rawInput={rawInput} plugin={plugin} />;
		case "fetch":
			return <FetchDetails rawInput={rawInput} plugin={plugin} />;
		default:
			return null;
	}
}

// Individual detail components for each kind
function ReadDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: AgentClientPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="agent-client-tool-call-read-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="agent-client-tool-call-location">
					📄 {loc.path}
					{loc.line !== null && loc.line !== undefined && (
						<span className="agent-client-tool-call-line">:{loc.line}</span>
					)}
				</div>
			))}
		</div>
	);
}

function EditDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: AgentClientPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="agent-client-tool-call-edit-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="agent-client-tool-call-location">
					📝 Editing: {loc.path}
				</div>
			))}
		</div>
	);
}

function DeleteDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: AgentClientPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="agent-client-tool-call-delete-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="agent-client-tool-call-location">
					🗑️ Deleting: {loc.path}
				</div>
			))}
		</div>
	);
}

function MoveDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: AgentClientPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.from) {
		elements.push(<div key="from">From: {String(rawInput.from)}</div>);
	}
	if (rawInput.to) {
		elements.push(<div key="to">To: {String(rawInput.to)}</div>);
	}

	return <div className="agent-client-tool-call-move-details">{elements}</div>;
}

function SearchDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: AgentClientPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.query) {
		elements.push(
			<div key="query" className="agent-client-tool-call-search-query">
				🔍 Query: "{String(rawInput.query)}"
			</div>,
		);
	}
	if (rawInput.pattern) {
		elements.push(
			<div key="pattern" className="agent-client-tool-call-search-pattern">
				Pattern: {String(rawInput.pattern)}
			</div>,
		);
	}

	return <div className="agent-client-tool-call-search-details">{elements}</div>;
}

function ExecuteDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: AgentClientPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.command) {
		elements.push(
			<div key="command" className="agent-client-tool-call-execute-command">
				💻 Command: <code>{String(rawInput.command)}</code>
			</div>,
		);
	}
	if (rawInput.cwd) {
		elements.push(
			<div key="cwd" className="agent-client-tool-call-execute-cwd">
				Directory: {String(rawInput.cwd)}
			</div>,
		);
	}

	return <div className="agent-client-tool-call-execute-details">{elements}</div>;
}

function FetchDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: AgentClientPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.url) {
		elements.push(
			<div key="url" className="agent-client-tool-call-fetch-url">
				🌐 URL: {String(rawInput.url)}
			</div>,
		);
	}
	if (rawInput.query) {
		elements.push(
			<div key="query" className="agent-client-tool-call-fetch-query">
				🔍 Search: "{String(rawInput.query)}"
			</div>,
		);
	}

	return <div className="agent-client-tool-call-fetch-details">{elements}</div>;
}
*/

// Diff renderer component
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
		let marker = " ";

		if (line.type === "added") {
			lineClass += " agent-client-diff-line-added";
			marker = "+";
		} else if (line.type === "removed") {
			lineClass += " agent-client-diff-line-removed";
			marker = "-";
		} else {
			lineClass += " agent-client-diff-line-context";
		}

		return (
			<div key={idx} className={lineClass}>
				<span className="agent-client-diff-line-number agent-client-diff-line-number-old">
					{line.oldLineNumber ?? ""}
				</span>
				<span className="agent-client-diff-line-number agent-client-diff-line-number-new">
					{line.newLineNumber ?? ""}
				</span>
				<span className="agent-client-diff-line-marker">{marker}</span>
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
