import * as React from "react";
const { useState, useMemo, useCallback } = React;
import * as Diff from "diff";
import { FileSystemAdapter } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import { toRelativePath } from "../../shared/path-utils";

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
	showHeader?: boolean;
}

interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: { type: "added" | "removed" | "context"; value: string }[];
}

interface DiffStats {
	added: number;
	removed: number;
}

function isNewFile(diff: DiffRendererProps["diff"]): boolean {
	return diff.oldText === null || diff.oldText === undefined;
}

function fileNameOnly(filePath: string): string {
	if (!filePath) return "";
	const normalized = filePath.replace(/\\/g, "/");
	return normalized.split("/").pop() ?? normalized;
}

function mapDiffParts(
	parts: Diff.Change[],
): { type: "added" | "removed" | "context"; value: string }[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

function renderWordDiff(
	wordDiff: { type: "added" | "removed" | "context"; value: string }[],
	lineType: "added" | "removed",
) {
	const filteredParts = wordDiff.filter((part) => {
		if (lineType === "removed" && part.type === "added") {
			return false;
		}
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
						<span key={partIdx} className="obsius-diff-word-added">
							{part.value}
						</span>
					);
				} else if (part.type === "removed") {
					return (
						<span key={partIdx} className="obsius-diff-word-removed">
							{part.value}
						</span>
					);
				}
				return <span key={partIdx}>{part.value}</span>;
			})}
		</>
	);
}

const CONTEXT_LINES = 3;

export function DiffRenderer({
	diff,
	plugin,
	autoCollapse = false,
	collapseThreshold = 10,
	showHeader = true,
}: DiffRendererProps) {
	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}, [plugin]);

	const relativePath = useMemo(
		() => toRelativePath(diff.path, vaultPath),
		[diff.path, vaultPath],
	);

	const fileName = useMemo(() => fileNameOnly(diff.path), [diff.path]);

	const isVaultFile = diff.path !== relativePath || !diff.path.startsWith("/");

	const findExistingLeaf = useCallback(
		(filePath: string) =>
			plugin.app.workspace.getLeavesOfType("markdown").find((leaf) => {
				if ("file" in leaf.view) {
					return (leaf.view as { file: { path: string } | null }).file
						?.path === filePath;
				}
				return false;
			}),
		[plugin],
	);

	const handleFileClick = useCallback(() => {
		if (!isVaultFile) return;
		const existing = findExistingLeaf(relativePath);
		if (existing) {
			plugin.app.workspace.setActiveLeaf(existing, { focus: true });
		} else {
			void plugin.app.workspace.openLinkText(relativePath, "", "tab");
		}
	}, [plugin, relativePath, isVaultFile, findExistingLeaf]);

	const scrollEditorToLine = useCallback(
		(view: unknown, lineNumber: number) => {
			if (view && typeof view === "object" && "editor" in view) {
				const editor = (
					view as {
						editor: {
							setCursor: (pos: { line: number; ch: number }) => void;
							scrollIntoView: (
								range: {
									from: { line: number; ch: number };
									to: { line: number; ch: number };
								},
								center: boolean,
							) => void;
						};
					}
				).editor;
				const pos = { line: lineNumber - 1, ch: 0 };
				editor.setCursor(pos);
				editor.scrollIntoView({ from: pos, to: pos }, true);
			}
		},
		[],
	);

	const handleLineClick = useCallback(
		(lineNumber: number) => {
			if (!isVaultFile) return;
			const existing = findExistingLeaf(relativePath);
			if (existing) {
				plugin.app.workspace.setActiveLeaf(existing, { focus: true });
				scrollEditorToLine(existing.view, lineNumber);
			} else {
				const leaf = plugin.app.workspace.getLeaf("tab");
				void leaf
					.openFile(
						plugin.app.vault.getAbstractFileByPath(
							relativePath,
						) as never,
					)
					.then(() => scrollEditorToLine(leaf.view, lineNumber));
			}
		},
		[plugin, relativePath, isVaultFile, findExistingLeaf, scrollEditorToLine],
	);

	const diffLines = useMemo(() => {
		if (isNewFile(diff)) {
			const lines = diff.newText.split("\n");
			return lines.map(
				(line, idx): DiffLine => ({
					type: "added",
					newLineNumber: idx + 1,
					content: line,
				}),
			);
		}

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

		for (const hunk of patch.hunks) {
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
					result.push({
						type: "context",
						oldLineNumber: oldLineNum++,
						newLineNumber: newLineNum++,
						content,
					});
				}
			}
		}

		for (let i = 0; i < result.length - 1; i++) {
			const current = result[i];
			const next = result[i + 1];

			if (current.type === "removed" && next.type === "added") {
				const wordDiff = Diff.diffWords(current.content, next.content);
				const mappedDiff = mapDiffParts(wordDiff);
				current.wordDiff = mappedDiff;
				next.wordDiff = mappedDiff;
			}
		}

		return result;
	}, [diff.oldText, diff.newText]);

	const diffStats = useMemo<DiffStats>(() => {
		let added = 0;
		let removed = 0;
		for (const line of diffLines) {
			if (line.type === "added") added += 1;
			if (line.type === "removed") removed += 1;
		}
		return { added, removed };
	}, [diffLines]);

	const renderLine = (line: DiffLine, idx: number) => {
		const isHunkHeader =
			line.type === "context" && line.content.startsWith("@@");

		if (isHunkHeader) {
			return (
				<div key={idx} className="obsius-diff-hunk-header">
					{line.content}
				</div>
			);
		}

		let lineClass = "obsius-diff-line";
		let marker = " ";

		if (line.type === "added") {
			lineClass += " obsius-diff-line-added";
			marker = "+";
		} else if (line.type === "removed") {
			lineClass += " obsius-diff-line-removed";
			marker = "-";
		} else {
			lineClass += " obsius-diff-line-context";
		}

		const targetLine = line.newLineNumber ?? line.oldLineNumber;
		const isClickable = isVaultFile && targetLine != null;

		return (
			<div key={idx} className={lineClass}>
				<span
					className={`obsius-diff-line-number obsius-diff-line-number-old ${isClickable ? "obsius-diff-line-number--clickable" : ""}`}
					onClick={
						isClickable && line.oldLineNumber
							? () => handleLineClick(line.oldLineNumber!)
							: undefined
					}
				>
					{line.oldLineNumber ?? ""}
				</span>
				<span
					className={`obsius-diff-line-number obsius-diff-line-number-new ${isClickable ? "obsius-diff-line-number--clickable" : ""}`}
					onClick={
						isClickable && line.newLineNumber
							? () => handleLineClick(line.newLineNumber!)
							: undefined
					}
				>
					{line.newLineNumber ?? ""}
				</span>
				<span className="obsius-diff-line-marker">{marker}</span>
				<span className="obsius-diff-line-content">
					{line.wordDiff && (line.type === "added" || line.type === "removed")
						? renderWordDiff(line.wordDiff, line.type)
						: line.content}
				</span>
			</div>
		);
	};

	const shouldCollapse = autoCollapse && diffLines.length > collapseThreshold;
	const [isCollapsed, setIsCollapsed] = useState(shouldCollapse);
	const visibleLines = isCollapsed
		? diffLines.slice(0, collapseThreshold)
		: diffLines;
	const remainingLines = diffLines.length - collapseThreshold;

	return (
		<div className="obsius-tool-call-diff">
			{showHeader && (
				<div className="obsius-diff-line-info">
					<span
						className={`obsius-diff-file-name ${isVaultFile ? "obsius-diff-file-name--link" : ""}`}
						onClick={isVaultFile ? handleFileClick : undefined}
					>
						{fileName || relativePath}
					</span>
					{isNewFile(diff) && <span className="obsius-diff-new-badge">new</span>}
					{(diffStats.added > 0 || diffStats.removed > 0) && (
						<span className="obsius-diff-line-stats">
							{diffStats.added > 0 && (
								<span className="obsius-diff-line-stats-added">
									+{diffStats.added}
								</span>
							)}
							{diffStats.removed > 0 && (
								<span className="obsius-diff-line-stats-removed">
									-{diffStats.removed}
								</span>
							)}
						</span>
					)}
				</div>
			)}
			<div className="obsius-tool-call-diff-content">
				{visibleLines.map((line, idx) => renderLine(line, idx))}
			</div>
			{shouldCollapse && (
				<div
					className="obsius-diff-expand-bar"
					onClick={() => setIsCollapsed(!isCollapsed)}
				>
					<span className="obsius-diff-expand-text">
						{isCollapsed ? `${remainingLines} more lines` : "Collapse"}
					</span>
					<span className="obsius-diff-expand-icon">
						{isCollapsed ? "▶" : "▲"}
					</span>
				</div>
			)}
		</div>
	);
}
