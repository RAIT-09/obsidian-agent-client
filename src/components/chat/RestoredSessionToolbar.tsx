import * as React from "react";
import * as Diff from "diff";
import { FileSystemAdapter } from "obsidian";
import type { FileChange } from "../../shared/session-file-restoration";
import type AgentClientPlugin from "../../plugin";
import { toRelativePath } from "../../shared/path-utils";
import { DiffRenderer } from "./DiffRenderer";
import { ObsidianIcon } from "./ObsidianIcon";

const { useMemo, useState, useCallback } = React;

interface RestoredSessionToolbarProps {
	changes: FileChange[];
	plugin: AgentClientPlugin;
	onUndoAll: () => Promise<void> | void;
	onKeepAll: () => void;
	onRevertFile: (changePath: string) => Promise<void> | void;
	onKeepFile: (changePath: string) => void;
}

export function RestoredSessionToolbar({
	changes,
	plugin,
	onUndoAll,
	onKeepAll,
	onRevertFile,
	onKeepFile,
}: RestoredSessionToolbarProps) {
	const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set());
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}, [plugin]);

	const perFileStats = useMemo(() => {
		return changes.map((change) => {
			const relativeFromFullPath = vaultPath
				? toRelativePath(change.path, vaultPath)
				: change.path;
			const isAbsolutePath =
				relativeFromFullPath.startsWith("/") ||
				/^[A-Za-z]:\//.test(relativeFromFullPath);
			const fallbackRelative = relativeFromFullPath
				.replace(/\\/g, "/")
				.replace(/^\/+/, "");
			const openPath = change.vaultPath ?? (!isAbsolutePath ? fallbackRelative : null);
			const displayPath = openPath ?? change.path;
			const hasInlineDiff =
				(change.originalText !== null &&
					change.originalText !== undefined &&
					change.originalText !== "") ||
				(change.finalText !== undefined && change.finalText !== "");

			if (change.isDeleted) {
				const lines = change.originalText
					? change.originalText.split("\n").length
					: 0;
				return {
					key: change.path,
					change,
					openPath: null,
					displayPath,
					hasInlineDiff: change.originalText != null,
					path: change.vaultPath ?? change.path,
					added: 0,
					removed: lines,
					isNewFile: false,
					isDeleted: true,
					canRevert: change.canRevert,
				};
			}

			if (change.isNewFile) {
				return {
					key: change.path,
					change,
					openPath,
					displayPath,
					hasInlineDiff,
					path: change.vaultPath ?? change.path,
					added: change.finalText ? change.finalText.split("\n").length : 0,
					removed: 0,
					isNewFile: true,
					isDeleted: false,
					canRevert: change.canRevert,
				};
			}

			const oldText = change.originalText ?? "";
			const newText = change.finalText ?? "";
			let added = 0;
			let removed = 0;
			for (const part of Diff.diffLines(oldText, newText)) {
				if (part.added) added += part.count ?? 0;
				if (part.removed) removed += part.count ?? 0;
			}

			return {
				key: change.path,
				change,
				openPath,
				displayPath,
				hasInlineDiff,
				path: change.vaultPath ?? change.path,
				added,
				removed,
				isNewFile: false,
				isDeleted: false,
				canRevert: change.canRevert,
			};
		});
	}, [changes, vaultPath]);

	const totals = useMemo(() => {
		let added = 0;
		let removed = 0;
		for (const row of perFileStats) {
			added += row.added;
			removed += row.removed;
		}
		return { added, removed };
	}, [perFileStats]);

	const handleRevertFile = useCallback(
		async (changePath: string) => {
			setBusyPaths((prev) => new Set(prev).add(changePath));
			try {
				await onRevertFile(changePath);
			} finally {
				setBusyPaths((prev) => {
					const next = new Set(prev);
					next.delete(changePath);
					return next;
				});
			}
		},
		[onRevertFile],
	);

	const handleOpenFile = useCallback(
		(openPath: string | null, e?: React.MouseEvent) => {
			if (e) e.stopPropagation();
			if (!openPath) return;
			const existing = plugin.app.workspace
				.getLeavesOfType("markdown")
				.find((leaf) => {
					if ("file" in leaf.view) {
						return (leaf.view as { file: { path: string } | null }).file
							?.path === openPath;
					}
					return false;
				});
			if (existing) {
				plugin.app.workspace.setActiveLeaf(existing, { focus: true });
				return;
			}
			void plugin.app.workspace.openLinkText(openPath, "", "tab");
		},
		[plugin],
	);

	const toggleInlineDiff = useCallback((path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	return (
		<div className="obsius-changes-panel">
			<div className="obsius-changes-header">
				<span className="obsius-changes-title">
					{changes.length} file{changes.length !== 1 ? "s" : ""} changed
				</span>
				<span className="obsius-changes-stat obsius-changes-stat--add">
					+{totals.added}
				</span>
				<span className="obsius-changes-stat obsius-changes-stat--remove">
					-{totals.removed}
				</span>

				<div className="obsius-changes-actions">
					<button
						className="obsius-changes-btn"
						onClick={() => void onUndoAll()}
						title="Revert all file changes"
					>
						Undo All
					</button>
					<button
						className="obsius-changes-btn"
						onClick={onKeepAll}
						title="Accept all changes and dismiss"
					>
						Keep All
					</button>
				</div>
			</div>

			<div className="obsius-changes-files">
				{perFileStats.map((row) => {
					const isExpanded = expandedPaths.has(row.key);
					const isBusy = busyPaths.has(row.key);
					return (
						<div key={row.key} className="obsius-changes-file">
							<div
								className={`obsius-changes-file-row ${isExpanded ? "obsius-changes-file-row--expanded" : ""}`}
								onClick={() => row.hasInlineDiff && toggleInlineDiff(row.key)}
							>
								<span
									className={`obsius-changes-file-name ${row.openPath ? "obsius-changes-file-name--link" : ""}`}
									onClick={(e) => handleOpenFile(row.openPath, e)}
									title={row.openPath ? "Open file in new tab" : "File is outside vault"}
								>
									{row.displayPath}
								</span>

								{row.isNewFile && (
									<span className="obsius-changes-badge">NEW</span>
								)}
								{row.isDeleted && (
									<span className="obsius-changes-badge obsius-changes-badge--deleted">DELETED</span>
								)}

								<span className="obsius-changes-file-stats">
									<span className="obsius-changes-file-stat--add">+{row.added}</span>
									<span className="obsius-changes-file-stat--remove">-{row.removed}</span>
								</span>

								<span className="obsius-changes-file-actions">
									<button
										className="obsius-changes-file-action obsius-changes-file-action--reject"
										onClick={(e) => {
											e.stopPropagation();
											void handleRevertFile(row.change.path);
										}}
										disabled={!row.canRevert || isBusy}
										title={row.canRevert ? "Undo this file's changes" : "Cannot revert: no original content"}
									>
										<ObsidianIcon name="x" size={14} />
									</button>
									<button
										className="obsius-changes-file-action obsius-changes-file-action--accept"
										onClick={(e) => {
											e.stopPropagation();
											onKeepFile(row.change.path);
										}}
										title="Keep this change"
									>
										<ObsidianIcon name="check" size={14} />
									</button>
								</span>

								{row.hasInlineDiff && (
									<ObsidianIcon
										name={isExpanded ? "chevron-up" : "chevron-down"}
										size={14}
										className="obsius-changes-file-chevron"
									/>
								)}
							</div>

							{isExpanded && row.hasInlineDiff && (
								<div className="obsius-changes-file-diff">
								<DiffRenderer
									diff={{
										type: "diff",
										path: row.change.path,
										oldText: row.change.isNewFile
											? null
											: row.change.originalText ?? undefined,
										newText: row.isDeleted ? "" : row.change.finalText,
									}}
										plugin={plugin}
										showHeader={false}
										autoCollapse={plugin.settings.displaySettings.autoCollapseDiffs}
										collapseThreshold={
											plugin.settings.displaySettings.diffCollapseThreshold
										}
									/>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
