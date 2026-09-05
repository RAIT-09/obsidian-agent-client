import * as React from "react";
const { useState, useMemo } = React;
import type AgentClientPlugin from "../plugin";
import { LucideIcon } from "./shared/IconButton";
import {
	computeDiffLines,
	isNewFileDiff,
	type DiffLine,
	type DiffWordPart,
} from "../utils/diff-lines";

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

// Helper function to render word-level diffs
function renderWordDiff(wordDiff: DiffWordPart[], lineType: "added" | "removed") {
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

export function DiffRenderer({
	diff,
	autoCollapse = false,
	collapseThreshold = 10,
}: DiffRendererProps) {
	const diffLines = useMemo(
		() => computeDiffLines(diff.oldText, diff.newText),
		[diff.oldText, diff.newText],
	);

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
			{isNewFileDiff(diff.oldText) ? (
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
					<LucideIcon
						name={isCollapsed ? "chevron-right" : "chevron-up"}
						className="agent-client-diff-expand-icon"
					/>
				</div>
			)}
		</div>
	);
}
