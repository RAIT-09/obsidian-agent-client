import * as React from "react";
const { useState, useMemo } = React;
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
import { toRelativePath } from "../../shared/path-utils";
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
}

function DiffRenderer({ diff, plugin }: DiffRendererProps) {
	// Simple line-based diff
	const renderDiff = () => {
		if (
			diff.oldText === null ||
			diff.oldText === undefined ||
			diff.oldText === ""
		) {
			// New file
			return (
				<div className="agent-client-tool-call-diff-new-file">
					<div className="agent-client-diff-line-info">New file</div>
					{diff.newText.split("\n").map((line, idx) => (
						<div
							key={idx}
							className="agent-client-diff-line agent-client-diff-line-added"
						>
							<span className="agent-client-diff-line-marker">
								+
							</span>
							<span className="agent-client-diff-line-content">
								{line}
							</span>
						</div>
					))}
				</div>
			);
		}

		const oldLines = diff.oldText.split("\n");
		const newLines = diff.newText.split("\n");

		// Simple comparison: show removed lines then added lines
		const elements: React.ReactElement[] = [];

		// Show removed lines
		oldLines.forEach((line, idx) => {
			elements.push(
				<div
					key={`old-${idx}`}
					className="agent-client-diff-line agent-client-diff-line-removed"
				>
					<span className="agent-client-diff-line-marker">-</span>
					<span className="agent-client-diff-line-content">
						{line}
					</span>
				</div>,
			);
		});

		// Show added lines
		newLines.forEach((line, idx) => {
			elements.push(
				<div
					key={`new-${idx}`}
					className="agent-client-diff-line agent-client-diff-line-added"
				>
					<span className="agent-client-diff-line-marker">+</span>
					<span className="agent-client-diff-line-content">
						{line}
					</span>
				</div>,
			);
		});

		return elements;
	};

	return (
		<div className="agent-client-tool-call-diff">
			<div className="agent-client-tool-call-diff-content">
				{renderDiff()}
			</div>
		</div>
	);
}
