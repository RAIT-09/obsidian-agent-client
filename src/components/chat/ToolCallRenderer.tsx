import * as React from "react";
const { useState, useMemo, useCallback } = React;
import { FileSystemAdapter } from "obsidian";
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type AgentClientPlugin from "../../plugin";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
import { DiffRenderer } from "./DiffRenderer";
import { toRelativePath } from "../../shared/path-utils";
import { CollapsibleSection } from "./CollapsibleSection";
import { ObsidianIcon } from "./ObsidianIcon";
import { RawPatchView } from "./RawPatchView";
import {
	countDiffStats,
	countRawPatchStats,
	extractRawPatchText,
} from "./tool-call-content-utils";
import {
	getToolIconName,
	getToolDisplayName,
	getToolSummary,
	getStatusDisplayClass,
	getStatusIconName,
} from "../../shared/tool-icons";

const FILE_EDIT_TITLES = new Set([
	"write", "edit", "notebookedit", "editnotebook", "multiedit",
	"strreplace", "writefile", "createfile", "editfile", "writetofile",
	"applydiff", "applypatch", "replaceinfile",
]);

const FILE_READ_TITLES = new Set([
	"read", "readfile", "viewfile",
]);

const SHELL_TITLES = new Set([
	"bash", "shell", "runcommand", "executecommand",
]);

interface ToolCallRendererProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	hasPlanContent?: boolean;
	showLiveIndicator?: boolean;
	agentClient?: IAgentClient;
	onApprovePermission?: (requestId: string, optionId: string) => Promise<void>;
}

export function ToolCallRenderer({
	content,
	plugin,
	hasPlanContent = false,
	showLiveIndicator = false,
	agentClient,
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

	const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>(
		permissionRequest?.selectedOptionId,
	);

	React.useEffect(() => {
		if (permissionRequest?.selectedOptionId !== selectedOptionId) {
			setSelectedOptionId(permissionRequest?.selectedOptionId);
		}
	}, [permissionRequest?.selectedOptionId]);

	const vaultPath = useMemo(() => {
		const adapter = plugin.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}, [plugin]);

	const iconName = useMemo(() => getToolIconName(title, kind), [title, kind]);

	const displayName = useMemo(
		() => getToolDisplayName(title, kind),
		[title, kind],
	);

	const genericToolName = useMemo(() => {
		if (!rawInput) return "";
		const name = rawInput.name;
		if (typeof name === "string" && name.trim().length > 0) {
			return name.trim();
		}
		return "";
	}, [rawInput]);

	const summary = useMemo(
		() => getToolSummary(title, kind, rawInput, locations, vaultPath),
		[title, kind, rawInput, locations, vaultPath],
	);

	const displaySummary = summary;

	const unknownToolName = useMemo(() => {
		if (displayName === "Tool" && genericToolName) {
			return genericToolName;
		}
		return "";
	}, [displayName, genericToolName]);

	const statusClass = getStatusDisplayClass(status);
	const isRunning = statusClass === "running";
	const showSpinnerIcon = showLiveIndicator || isRunning;
	const statusIcon = isRunning ? "" : getStatusIconName(status);

	const hasDiffContent = toolContent?.some((item) => item.type === "diff") ?? false;
	const rawPatchText = useMemo(
		() => (hasDiffContent ? null : extractRawPatchText(rawInput)),
		[hasDiffContent, rawInput],
	);

	const diffStats = useMemo(
		() => countDiffStats(toolContent) ?? (rawPatchText ? countRawPatchStats(rawPatchText) : null),
		[toolContent, rawPatchText],
	);

	const normalizedTitle = (title ?? "").replace(/[\s_-]+/g, "").toLowerCase();
	const isFileEditTool = kind === "edit" || FILE_EDIT_TITLES.has(normalizedTitle);
	const isFileReadTool = kind === "read" || FILE_READ_TITLES.has(normalizedTitle);
	const isFileTool = isFileEditTool || isFileReadTool;
	const isTodoTool = normalizedTitle === "todowrite" || normalizedTitle === "todoread";

	const hasCommandDetails =
		(kind === "execute" || SHELL_TITLES.has(normalizedTitle)) &&
		!!rawInput &&
		typeof rawInput.command === "string";
	const hasLocationDetails = !isFileTool && !!locations && locations.length > 0;
	const hasToolContentDetails =
		toolContent?.some((item) => item.type === "terminal" || item.type === "diff") ??
		false;
	const hasTodoPlanRendered = isTodoTool && hasPlanContent;
	const hasRenderableDetails =
		!hasTodoPlanRendered &&
		(hasCommandDetails ||
			hasLocationDetails ||
			hasToolContentDetails ||
			!!rawPatchText ||
			!!permissionRequest);

	const fileTitle = useMemo(() => {
		if (!isFileTool) return "";
		if (summary) return summary;
		if (locations && locations.length > 0) {
			return toRelativePath(locations[0].path, vaultPath);
		}
		return displayName;
	}, [isFileTool, summary, locations, vaultPath, displayName]);

	const handlePathClick = useCallback(
		(path: string, e?: React.MouseEvent) => {
			if (e) e.stopPropagation();
			const relativePath = toRelativePath(path, vaultPath);
			const existing = plugin.app.workspace
				.getLeavesOfType("markdown")
				.find((leaf) => {
					if ("file" in leaf.view) {
						return (leaf.view as { file: { path: string } | null }).file
							?.path === relativePath;
					}
					return false;
				});
			if (existing) {
				plugin.app.workspace.setActiveLeaf(existing, { focus: true });
			} else {
				void plugin.app.workspace.openLinkText(relativePath, "", "tab");
			}
		},
		[plugin, vaultPath],
	);

	const summaryIsFile = useMemo(() => {
		if (!summary) return false;
		if (kind === "execute" || kind === "think" || kind === "fetch")
			return false;
		if (rawInput) {
			const filePath =
				(rawInput.file_path as string) ||
				(rawInput.path as string) ||
				(rawInput.filePath as string) ||
				"";
			if (filePath) return true;
		}
		if (locations && locations.length > 0) return true;
		return false;
	}, [summary, kind, rawInput, locations]);

	const summaryClickPath = useMemo(() => {
		if (!summaryIsFile) return "";
		if (rawInput) {
			const filePath =
				(rawInput.file_path as string) ||
				(rawInput.path as string) ||
				(rawInput.filePath as string) ||
				"";
			if (filePath) return filePath;
		}
		if (locations && locations.length > 0) return locations[0].path;
		return "";
	}, [summaryIsFile, rawInput, locations]);

	const header = (
		<>
			{showSpinnerIcon ? (
				<span className="ac-tool-icon ac-tool-icon--spinner" aria-hidden="true">
					<svg className="ac-loading__spinner ac-loading__spinner--inline" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
						<line className="ac-sq-line-0" x1="15" y1="15" x2="85" y2="15" />
						<line className="ac-sq-line-1" x1="85" y1="15" x2="85" y2="85" />
						<line className="ac-sq-line-2" x1="85" y1="85" x2="15" y2="85" />
						<line className="ac-sq-line-3" x1="15" y1="85" x2="15" y2="15" />
						<circle className="ac-sq-dot-0" r="6" cx="15" cy="15" />
						<circle className="ac-sq-dot-1" r="6" cx="85" cy="15" />
						<circle className="ac-sq-dot-2" r="6" cx="85" cy="85" />
						<circle className="ac-sq-dot-3" r="6" cx="15" cy="85" />
					</svg>
				</span>
			) : (
				<ObsidianIcon name={iconName} className="ac-tool-icon" />
			)}
			{isFileTool ? (
				<>
					{isFileReadTool && (
						<span className="ac-row__title ac-row__action-label">
							Read
						</span>
					)}
					<span
						className={`ac-row__title ac-row__title--file ${summaryIsFile ? "ac-row__title--file-link" : ""}`}
						onClick={
							summaryIsFile && summaryClickPath
								? (e) => handlePathClick(summaryClickPath, e)
								: undefined
						}
					>
						{fileTitle}
					</span>
				</>
			) : (
				<>
					<span className="ac-row__title">{displayName}</span>
					{unknownToolName && (
						<span className="ac-row__summary">{unknownToolName}</span>
					)}
					{displaySummary && (
						<span
							className={`ac-row__summary ${summaryIsFile ? "ac-row__summary--link" : ""}`}
							onClick={
								summaryIsFile && summaryClickPath
									? (e) => handlePathClick(summaryClickPath, e)
									: undefined
							}
						>
							{displaySummary}
						</span>
					)}
				</>
			)}
			{diffStats && (
				<span className="ac-tool-diff-stats">
					<span className="ac-tool-diff-added">+{diffStats.added}</span>
					<span className="ac-tool-diff-removed">-{diffStats.removed}</span>
				</span>
			)}
			<span
				className={`ac-tool-status ${statusClass ? `ac-tool-status--${statusClass}` : ""}`}
			>
				{statusIcon && (
					<ObsidianIcon name={statusIcon} size={14} />
				)}
			</span>
		</>
	);

	return (
		<CollapsibleSection
			className={`ac-toolcall ${isFileEditTool ? "ac-toolcall--file-edit" : ""}`}
			defaultExpanded={!!permissionRequest}
			collapsible={hasRenderableDetails}
			header={header}
		>
			{hasCommandDetails &&
				rawInput &&
				typeof rawInput.command === "string" && (
					<div className="ac-tree__item">
						<code className="ac-inline-code">
							{rawInput.command}
							{Array.isArray(rawInput.args) &&
								rawInput.args.length > 0 &&
								` ${(rawInput.args as string[]).join(" ")}`}
						</code>
					</div>
				)}

			{hasLocationDetails && locations && (
				<div className="ac-tree__item ac-tree__locations">
					{locations.map((loc, idx) => {
						const rel = toRelativePath(loc.path, vaultPath);
						const isVaultFile = loc.path !== rel || !loc.path.startsWith("/");
						return (
							<span
								key={idx}
								className={`ac-tree__location ${isVaultFile ? "ac-tree__location--link" : ""}`}
								onClick={
									isVaultFile ? () => handlePathClick(loc.path) : undefined
								}
								onKeyDown={
									isVaultFile
										? (e) => {
												if (e.key === "Enter") handlePathClick(loc.path);
											}
										: undefined
								}
								role={isVaultFile ? "link" : undefined}
								tabIndex={isVaultFile ? 0 : undefined}
							>
								{rel}
								{loc.line != null && `:${loc.line}`}
							</span>
						);
					})}
				</div>
			)}

			{toolContent &&
				toolContent.map((item, index) => {
					if (item.type === "terminal") {
						return (
							<div key={index} className="ac-tree__item">
								<TerminalRenderer
									terminalId={item.terminalId}
									agentClient={agentClient || null}
									plugin={plugin}
								/>
							</div>
						);
					}
					if (item.type === "diff") {
						return (
							<div key={index} className="ac-tree__item">
								<DiffRenderer
									diff={item}
									plugin={plugin}
									showHeader={!isFileEditTool}
									autoCollapse={
										plugin.settings.displaySettings.autoCollapseDiffs
									}
									collapseThreshold={
										plugin.settings.displaySettings.diffCollapseThreshold
									}
								/>
							</div>
						);
					}
					return null;
				})}

			{rawPatchText && (
				<div className="ac-tree__item">
					<RawPatchView
						text={rawPatchText}
						autoCollapse={
							plugin.settings.displaySettings.autoCollapseDiffs
						}
						collapseThreshold={
							plugin.settings.displaySettings.diffCollapseThreshold
						}
					/>
				</div>
			)}

			{permissionRequest && (
				<div className="ac-tree__item">
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
				</div>
			)}
		</CollapsibleSection>
	);
}
