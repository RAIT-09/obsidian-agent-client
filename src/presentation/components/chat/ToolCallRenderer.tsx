import * as React from "react";
const { useState, useMemo, useCallback } = React;
import type { MessageContent } from "../../../core/domain/models/chat-message";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
// import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface ToolCallRendererProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	handlePermissionUseCase?: HandlePermissionUseCase;
}

export const ToolCallRenderer = React.memo(function ToolCallRenderer({
	content,
	plugin,
	acpClient,
	handlePermissionUseCase,
}: ToolCallRendererProps) {
	const {
		kind,
		title,
		status,
		toolCallId,
		permissionRequest,
		// locations,
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
	}, [permissionRequest?.selectedOptionId, selectedOptionId]);

	// Memoize permission request with selected option to avoid inline object creation
	const mergedPermissionRequest = useMemo(
		() =>
			permissionRequest
				? { ...permissionRequest, selectedOptionId }
				: null,
		[permissionRequest, selectedOptionId],
	);

	// Get icon based on kind
	const getKindIcon = useCallback((kind?: string) => {
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
	}, []);

	// Get status class name
	const getStatusClass = (status?: string) => {
		switch (status) {
			case "running":
			case "pending":
				return "running";
			case "completed":
			case "success":
				return "completed";
			case "error":
			case "failed":
				return "error";
			default:
				return "";
		}
	};

	// Get display status text
	const getStatusText = (status?: string) => {
		switch (status) {
			case "running":
			case "pending":
				return "Running";
			case "completed":
			case "success":
				return "Done";
			case "error":
			case "failed":
				return "Error";
			default:
				return status || "";
		}
	};

	return (
		<div className="message-tool-call">
			{/* Header */}
			<div className="message-tool-call-header">
				<span className="message-tool-call-icon" aria-hidden="true">
					{getKindIcon(kind)}
				</span>
				<span className="message-tool-call-title">{title}</span>
				<span className={`message-tool-call-status ${getStatusClass(status)}`}>
					{getStatusText(status)}
				</span>
			</div>

			{/* Kind-specific details */}
			{/* kind && (
				<div className="message-tool-call-details">
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
								<div key={index} className="tool-call-content">
									<MarkdownTextRenderer
										text={item.content.text}
										plugin={plugin}
									/>
								</div>
							);
						}
						}*/
					return null;
				})}

			{/* Permission request section */}
			{mergedPermissionRequest && (
				<PermissionRequestSection
					permissionRequest={mergedPermissionRequest}
					toolCallId={toolCallId}
					acpClient={acpClient}
					handlePermissionUseCase={handlePermissionUseCase}
					plugin={plugin}
					onOptionSelected={setSelectedOptionId}
				/>
			)}
		</div>
	);
});

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
		<div className="tool-call-read-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="tool-call-location">
					📄 {loc.path}
					{loc.line !== null && loc.line !== undefined && (
						<span className="tool-call-line">:{loc.line}</span>
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
		<div className="tool-call-edit-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="tool-call-location">
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
		<div className="tool-call-delete-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="tool-call-location">
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

	return <div className="tool-call-move-details">{elements}</div>;
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
			<div key="query" className="tool-call-search-query">
				🔍 Query: "{String(rawInput.query)}"
			</div>,
		);
	}
	if (rawInput.pattern) {
		elements.push(
			<div key="pattern" className="tool-call-search-pattern">
				Pattern: {String(rawInput.pattern)}
			</div>,
		);
	}

	return <div className="tool-call-search-details">{elements}</div>;
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
			<div key="command" className="tool-call-execute-command">
				💻 Command: <code>{String(rawInput.command)}</code>
			</div>,
		);
	}
	if (rawInput.cwd) {
		elements.push(
			<div key="cwd" className="tool-call-execute-cwd">
				Directory: {String(rawInput.cwd)}
			</div>,
		);
	}

	return <div className="tool-call-execute-details">{elements}</div>;
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
			<div key="url" className="tool-call-fetch-url">
				🌐 URL: {String(rawInput.url)}
			</div>,
		);
	}
	if (rawInput.query) {
		elements.push(
			<div key="query" className="tool-call-fetch-query">
				🔍 Search: "{String(rawInput.query)}"
			</div>,
		);
	}

	return <div className="tool-call-fetch-details">{elements}</div>;
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
				<div className="tool-call-diff-new-file">
					<div className="diff-line-info">New file</div>
					{diff.newText.split("\n").map((line, idx) => (
						<div key={idx} className="diff-line diff-line-added">
							<span className="diff-line-marker">+</span>
							<span className="diff-line-content">{line}</span>
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
				<div key={`old-${idx}`} className="diff-line diff-line-removed">
					<span className="diff-line-marker">-</span>
					<span className="diff-line-content">{line}</span>
				</div>,
			);
		});

		// Show added lines
		newLines.forEach((line, idx) => {
			elements.push(
				<div key={`new-${idx}`} className="diff-line diff-line-added">
					<span className="diff-line-marker">+</span>
					<span className="diff-line-content">{line}</span>
				</div>,
			);
		});

		return elements;
	};

	return (
		<div className="tool-call-diff">
			<div className="tool-call-diff-content">{renderDiff()}</div>
		</div>
	);
}
