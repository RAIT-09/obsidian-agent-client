import {
	ItemView,
	WorkspaceLeaf,
	MarkdownRenderer,
	TFile,
	prepareFuzzySearch,
	FuzzyMatch,
} from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useSyncExternalStore, useMemo } = React;
import { createRoot, Root } from "react-dom/client";
import { setIcon } from "obsidian";

import { spawn, ChildProcess } from "child_process";
import { Writable, Readable } from "stream";
import * as acp from "@zed-industries/agent-client-protocol";
import type AgentClientPlugin from "./main";
import { TerminalManager } from "./terminal-manager";

// Note mention service for @-mention functionality
class NoteMentionService {
	private files: TFile[] = [];
	private lastBuild = 0;
	private plugin: AgentClientPlugin;

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
		this.rebuildIndex();

		// Listen for vault changes to keep index up to date
		this.plugin.app.vault.on("create", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.rebuildIndex();
			}
		});
		this.plugin.app.vault.on("delete", () => this.rebuildIndex());
		this.plugin.app.vault.on("rename", (file) => {
			if (file instanceof TFile && file.extension === "md") {
				this.rebuildIndex();
			}
		});
	}

	private rebuildIndex() {
		this.files = this.plugin.app.vault.getMarkdownFiles();
		this.lastBuild = Date.now();
		console.log(
			`[NoteMentionService] Rebuilt index with ${this.files.length} files`,
		);
	}

	searchNotes(query: string): TFile[] {
		console.log(
			"[DEBUG] NoteMentionService.searchNotes called with:",
			query,
		);
		console.log("[DEBUG] Total files indexed:", this.files.length);

		if (!query.trim()) {
			console.log("[DEBUG] Empty query, returning recent files");
			// If no query, return recently modified files
			const recentFiles = this.files
				.slice()
				.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0))
				.slice(0, 5);
			console.log(
				"[DEBUG] Recent files:",
				recentFiles.map((f) => f.name),
			);
			return recentFiles;
		}

		console.log("[DEBUG] Preparing fuzzy search for:", query.trim());
		const fuzzySearch = prepareFuzzySearch(query.trim());

		// Score each file based on multiple fields
		const scored: Array<{ file: TFile; score: number }> = this.files.map(
			(file) => {
				const basename = file.basename;
				const path = file.path;

				// Get aliases from frontmatter
				const fileCache =
					this.plugin.app.metadataCache.getFileCache(file);
				const aliases = fileCache?.frontmatter?.aliases;
				const aliasArray: string[] = Array.isArray(aliases)
					? aliases
					: aliases
						? [aliases]
						: [];

				// Search in basename, path, and aliases
				const searchFields = [basename, path, ...aliasArray];
				let bestScore = -Infinity;

				for (const field of searchFields) {
					const match = fuzzySearch(field);
					if (match && match.score > bestScore) {
						bestScore = match.score;
					}
				}

				return { file, score: bestScore };
			},
		);

		return scored
			.filter((item) => item.score > -Infinity)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map((item) => item.file);
	}

	getAllFiles(): TFile[] {
		return this.files;
	}

	getFileByPath(path: string): TFile | null {
		return this.files.find((file) => file.path === path) || null;
	}
}

// Mention detection utilities
interface MentionContext {
	start: number; // Start index of the @ symbol
	end: number; // Current cursor position
	query: string; // Text after @ symbol
}

// Detect @-mention at current cursor position
function detectMention(
	text: string,
	cursorPosition: number,
): MentionContext | null {
	console.log("[DEBUG] detectMention called with:", { text, cursorPosition });

	if (cursorPosition < 0 || cursorPosition > text.length) {
		console.log("[DEBUG] Invalid cursor position");
		return null;
	}

	// Get text up to cursor position
	const textUpToCursor = text.slice(0, cursorPosition);
	console.log("[DEBUG] Text up to cursor:", textUpToCursor);

	// Find the last @ symbol
	const atIndex = textUpToCursor.lastIndexOf("@");
	console.log("[DEBUG] @ index found:", atIndex);
	if (atIndex === -1) {
		console.log("[DEBUG] No @ symbol found");
		return null;
	}

	// Get the token after @
	const afterAt = textUpToCursor.slice(atIndex + 1);
	console.log("[DEBUG] Text after @:", afterAt);

	// Support both @filename and @[filename with spaces] formats
	let query = "";
	let endPos = cursorPosition;

	if (afterAt.startsWith("[")) {
		// @[filename] format - find closing bracket
		const closingBracket = afterAt.indexOf("]");
		if (closingBracket === -1) {
			// Still typing inside brackets
			query = afterAt.slice(1); // Remove opening [
			endPos = cursorPosition;
		} else {
			// Found closing bracket - check if cursor is after it
			const closingBracketPos = atIndex + 1 + closingBracket;
			if (cursorPosition > closingBracketPos) {
				// Cursor is after ], no longer a mention
				console.log(
					"[DEBUG] Cursor is after closing ], stopping mention detection",
				);
				return null;
			}
			// Complete bracket format
			query = afterAt.slice(1, closingBracket); // Between [ and ]
			endPos = closingBracketPos + 1; // Include closing ]
		}
	} else {
		// @filename format (no spaces allowed)
		if (
			afterAt.includes(" ") ||
			afterAt.includes("\t") ||
			afterAt.includes("\n") ||
			afterAt.includes("]")
		) {
			console.log("[DEBUG] Mention contains invalid characters");
			return null;
		}
		query = afterAt;
		endPos = cursorPosition;
	}

	const mentionContext = {
		start: atIndex,
		end: endPos,
		query: query,
	};
	console.log("[DEBUG] Mention context created:", mentionContext);
	return mentionContext;
}

// Replace mention in text with the selected note
function replaceMention(
	text: string,
	mentionContext: MentionContext,
	noteTitle: string,
): { newText: string; newCursorPos: number } {
	const before = text.slice(0, mentionContext.start);
	const after = text.slice(mentionContext.end);

	// Use @[filename] format if title contains spaces, otherwise @filename
	const replacement = noteTitle.includes(" ")
		? `@[${noteTitle}]`
		: `@${noteTitle}`;

	const newText = before + replacement + after;
	const newCursorPos = mentionContext.start + replacement.length;

	return { newText, newCursorPos };
}

// Convert @mentions to relative paths for agent
function convertMentionsToPath(
	text: string,
	noteMentionService: NoteMentionService,
	vaultPath: string,
): string {
	// Find all @mentions in the text (both @filename and @[filename] formats)
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	let convertedText = text;

	convertedText = convertedText.replace(
		mentionRegex,
		(match, bracketName, plainName) => {
			// Extract filename - either from [brackets] or plain text
			const noteTitle = bracketName || plainName;

			// Find the file by basename
			const file = noteMentionService
				.getAllFiles()
				.find((f) => f.basename === noteTitle);
			if (file) {
				// Calculate absolute path by combining vault path with file path
				const absolutePath = vaultPath
					? `${vaultPath}/${file.path}`
					: file.path;
				console.log(
					`[DEBUG] Converting @${noteTitle} to absolute path: ${absolutePath}`,
				);
				return absolutePath;
			}
			// If file not found, keep original @mention
			return match;
		},
	);

	return convertedText;
}

// Extract @mentions from text for display purposes
function extractMentions(
	text: string,
): Array<{ text: string; start: number; end: number }> {
	const mentions: Array<{ text: string; start: number; end: number }> = [];
	// Match both @filename and @[filename with spaces] formats
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Extract filename - either from [brackets] or plain text
		const noteTitle = match[1] || match[2];
		mentions.push({
			text: noteTitle, // Note title without @ and brackets
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	return mentions;
}

// MentionDropdown component
interface MentionDropdownProps {
	files: TFile[];
	selectedIndex: number;
	onSelect: (file: TFile) => void;
	onClose: () => void;
}

function MentionDropdown({
	files,
	selectedIndex,
	onSelect,
	onClose,
}: MentionDropdownProps) {
	const dropdownRef = useRef<HTMLDivElement>(null);

	console.log("[DEBUG] MentionDropdown component rendering with:", {
		files: files.map((f) => f.name),
		selectedIndex,
		filesCount: files.length,
	});

	// Handle mouse clicks outside dropdown to close
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [onClose]);

	if (files.length === 0) {
		return null;
	}

	return (
		<div
			ref={dropdownRef}
			style={{
				// Overlay positioning - positioned above textarea
				position: "absolute",
				bottom: "100%", // Position above the textarea
				left: "0",
				right: "0",
				backgroundColor: "var(--background-secondary)",
				border: "2px solid var(--background-modifier-border)",
				borderRadius: "8px",
				boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
				overflowY: "auto",
				fontSize: "14px",
				marginBottom: "8px", // Space between dropdown and textarea
				zIndex: 1000,
				// Temporary debug styling
			}}
		>
			{files.map((file, index) => (
				<div
					key={file.path}
					style={{
						padding: "4px 16px",
						cursor: "pointer",
						backgroundColor:
							index === selectedIndex
								? "var(--background-primary)" // More visible selection
								: "transparent",
						borderBottom:
							index < files.length - 1
								? "1px solid var(--background-modifier-border)"
								: "none",
						userSelect: "none",
						transition: "background-color 0.1s ease",
					}}
					onClick={() => onSelect(file)}
					onMouseEnter={() => {
						// Could update selected index on hover, but keeping it keyboard-focused for now
					}}
				>
					<div
						style={{
							fontWeight: "500",
							color: "var(--text-normal)",
							marginBottom: "2px",
						}}
					>
						{file.basename}
					</div>
					<div
						style={{
							fontSize: "12px",
							color: "var(--text-muted)",
							opacity: 0.8,
						}}
					>
						{file.path}
					</div>
				</div>
			))}
		</div>
	);
}

// Message types based on ACP schema
type MessageRole = "user" | "assistant";

type MessageContent =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "agent_thought";
			text: string;
	  }
	| {
			type: "image";
			data: string;
			mimeType: string;
			uri?: string;
	  }
	| {
			type: "tool_call";
			toolCallId: string;
			title?: string | null;
			status: "pending" | "in_progress" | "completed" | "failed";
			kind?:
				| "read"
				| "edit"
				| "delete"
				| "move"
				| "search"
				| "execute"
				| "think"
				| "fetch"
				| "switch_mode"
				| "other";
			content?: acp.ToolCallContent[];
	  }
	| {
			type: "plan";
			entries: {
				content: string;
				status: "pending" | "in_progress" | "completed";
				priority: "high" | "medium" | "low";
			}[];
	  }
	| {
			type: "permission_request";
			toolCall: {
				toolCallId: string;
			};
			options: {
				optionId: string;
				name: string;
				kind?: "allow_always" | "allow_once" | "reject_once";
			}[];
			selectedOptionId?: string;
			isCancelled?: boolean;
	  }
	| {
			type: "terminal";
			terminalId: string;
	  };

interface ChatMessage {
	id: string;
	role: MessageRole;
	content: MessageContent[];
	timestamp: Date;
}

export const VIEW_TYPE_CHAT = "chat-view";

// Convert environment variable definitions from settings into a simple record
const envVarsToRecord = (vars?: { key: string; value: string }[]) => {
	const record: Record<string, string> = {};
	if (!Array.isArray(vars)) {
		return record;
	}
	for (const entry of vars) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		record[entry.key] = typeof entry.value === "string" ? entry.value : "";
	}
	return record;
};

// Derive the directory for PATH adjustments when the command uses an absolute path
const resolveCommandDirectory = (command: string): string | null => {
	if (!command) {
		return null;
	}
	const lastSlash = Math.max(
		command.lastIndexOf("/"),
		command.lastIndexOf("\\"),
	);
	if (lastSlash <= 0) {
		return null;
	}
	return command.slice(0, lastSlash);
};

// Collapsible thought component
function CollapsibleThought({
	text,
	plugin,
}: {
	text: string;
	plugin: AgentClientPlugin;
}) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			style={{
				fontStyle: "italic",
				color: "var(--text-muted)",
				backgroundColor: "transparent",
				fontSize: "0.9em",
				cursor: "pointer",
			}}
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
				💡Thinking
				<span
					style={{
						fontSize: "0.8em",
						opacity: 0.7,
						marginLeft: "auto",
					}}
				>
					{isExpanded ? "▼" : "▶"}
				</span>
			</div>
			{isExpanded && (
				<div
					style={{
						marginTop: "8px",
						paddingLeft: "16px",
						userSelect: "text",
					}}
				>
					<MarkdownTextRenderer text={text} plugin={plugin} />
				</div>
			)}
		</div>
	);
}

// Markdown text component
function MarkdownTextRenderer({
	text,
	plugin,
}: {
	text: string;
	plugin: AgentClientPlugin;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty?.();
		el.innerHTML = "";
		el.classList.add("markdown-rendered");

		// Render markdown
		MarkdownRenderer.render(
			plugin.app,
			text,
			el,
			"", // sourcePath - empty for dynamic content
			plugin,
		);
	}, [text, plugin]);

	return <div ref={containerRef} style={{ userSelect: "text" }} />;
}

// Function to render text with @mentions
function renderTextWithMentions(
	text: string,
	plugin: AgentClientPlugin,
): React.ReactElement {
	// Match both @filename and @[filename with spaces] formats
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Add text before the mention
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		// Extract filename - either from [brackets] or plain text
		const noteName = match[1] || match[2];

		// Check if file actually exists
		const file = plugin.app.vault
			.getMarkdownFiles()
			.find((f) => f.basename === noteName);

		if (file) {
			// File exists - render as clickable mention
			parts.push(
				<span
					key={match.index}
					style={{
						backgroundColor: "transparent",
						color: "var(--interactive-accent-hover)",
						borderRadius: "3px",
						fontSize: "0.9em",
						fontWeight: "500",
						cursor: "pointer",
					}}
					onClick={() => {
						plugin.app.workspace.openLinkText(file.path, "");
					}}
				>
					@{noteName}
				</span>,
			);
		} else {
			// File doesn't exist - render as plain text
			parts.push(`@${noteName}`);
		}

		lastIndex = match.index + match[0].length;
	}

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return (
		<div className="markdown-rendered" style={{ userSelect: "text" }}>
			<p className="auto">{parts}</p>
		</div>
	);
}

// Message content rendering components
function MessageContentRenderer({
	content,
	plugin,
	messageId,
	acpClient,
	updateMessageContent,
}: {
	content: MessageContent;
	plugin: AgentClientPlugin;
	messageId?: string;
	acpClient?: AcpClient;
	updateMessageContent?: (
		messageId: string,
		updatedContent: MessageContent,
	) => void;
}) {
	switch (content.type) {
		case "text":
			// Check if this is a user message by looking at the parent message role
			// For now, we'll detect @mentions and render them appropriately
			if (content.text.includes("@")) {
				return renderTextWithMentions(content.text, plugin);
			}
			return <MarkdownTextRenderer text={content.text} plugin={plugin} />;

		case "agent_thought":
			return <CollapsibleThought text={content.text} plugin={plugin} />;

		case "tool_call":
			return (
				<div
					style={{
						padding: "8px",
						marginTop: "4px",
						backgroundColor: "transparent",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "4px",
						fontSize: "12px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "4px",
							userSelect: "text",
						}}
					>
						🔧 {content.title}
					</div>
					<div
						style={{
							color: "var(--text-muted)",
							marginBottom: content.content ? "8px" : "0",
							userSelect: "text",
						}}
					>
						Status: {content.status}
						{content.kind && ` | Kind: ${content.kind}`}
					</div>
					{content.content &&
						content.content.map((item, index) => {
							if (item.type === "terminal") {
								return (
									<TerminalRenderer
										key={index}
										terminalId={item.terminalId}
										acpClient={acpClient || null}
									/>
								);
							}
							// Handle other content types here if needed
							return null;
						})}
				</div>
			);

		case "plan":
			return (
				<div
					style={{
						padding: "8px",
						marginTop: "4px",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "4px",
						fontSize: "12px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "4px",
							userSelect: "text",
						}}
					>
						📋 Plan
					</div>
					{content.entries.map((entry, idx) => (
						<div
							key={idx}
							style={{
								margin: "2px 0",
								padding: "2px 4px",
								borderLeft: "2px solid var(--text-muted)",
								userSelect: "text",
							}}
						>
							<span
								style={{
									color:
										entry.status === "completed"
											? "green"
											: entry.status === "in_progress"
												? "orange"
												: "var(--text-muted)",
									userSelect: "text",
								}}
							>
								{entry.status === "completed"
									? "✓"
									: entry.status === "in_progress"
										? "⏳"
										: "⭕"}
							</span>{" "}
							{entry.content}
						</div>
					))}
				</div>
			);
		case "permission_request":
			const isSelected = content.selectedOptionId !== undefined;
			const isCancelled = content.isCancelled === true;
			const selectedOption = content.options.find(
				(opt) => opt.optionId === content.selectedOptionId,
			);

			return (
				<div
					style={{
						padding: "12px",
						marginTop: "4px",
						backgroundColor: "var(--background-secondary)",
						border: "1px solid var(--background-modifier-border)",
						borderRadius: "8px",
						fontSize: "14px",
						userSelect: "text",
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "8px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							userSelect: "text",
						}}
					>
						🔐 Permission Request
					</div>
					<div
						style={{
							marginBottom: "12px",
							color: "var(--text-normal)",
							userSelect: "text",
						}}
					>
						The agent is requesting permission to perform an action.
						Please choose how to proceed:
					</div>
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "8px",
						}}
					>
						{content.options.map((option) => {
							const isThisSelected =
								content.selectedOptionId === option.optionId;
							return (
								<button
									key={option.optionId}
									disabled={isSelected || isCancelled}
									onClick={() => {
										if (
											acpClient &&
											messageId &&
											updateMessageContent &&
											!isCancelled
										) {
											// Update UI immediately
											const updatedContent = {
												...content,
												selectedOptionId:
													option.optionId,
											};
											updateMessageContent(
												messageId,
												updatedContent,
											);

											// Send response to agent
											acpClient.handlePermissionResponse(
												messageId,
												option.optionId,
											);
										} else {
											console.warn(
												"Cannot handle permission response: missing acpClient, messageId, or updateMessageContent",
											);
										}
									}}
									style={{
										padding: "8px 16px",
										border: "1px solid var(--background-modifier-border)",
										borderRadius: "6px",
										backgroundColor: isThisSelected
											? "var(--interactive-accent)"
											: isSelected || isCancelled
												? "var(--background-modifier-border)"
												: "var(--background-primary)",
										color: isThisSelected
											? "white"
											: isSelected || isCancelled
												? "var(--text-muted)"
												: "var(--text-normal)",
										cursor:
											isSelected || isCancelled
												? "not-allowed"
												: "pointer",
										fontSize: "13px",
										fontWeight: isThisSelected
											? "600"
											: "500",
										transition: "all 0.2s ease",
										minWidth: "80px",
										textAlign: "center",
										opacity:
											(isSelected && !isThisSelected) ||
											isCancelled
												? 0.5
												: 1,
										...(option.kind === "allow_always" &&
											!isSelected && {
												backgroundColor:
													"var(--color-green)",
												color: "white",
												borderColor:
													"var(--color-green)",
											}),
										...(option.kind === "reject_once" &&
											!isSelected && {
												backgroundColor:
													"var(--color-red)",
												color: "white",
												borderColor: "var(--color-red)",
											}),
										...(option.kind === "allow_once" &&
											!isSelected && {
												backgroundColor:
													"var(--color-orange)",
												color: "white",
												borderColor:
													"var(--color-orange)",
											}),
									}}
									onMouseEnter={(e) => {
										if (!option.kind && !isSelected) {
											e.currentTarget.style.backgroundColor =
												"var(--background-modifier-hover)";
										}
									}}
									onMouseLeave={(e) => {
										if (!option.kind && !isSelected) {
											e.currentTarget.style.backgroundColor =
												"var(--background-primary)";
										}
									}}
								>
									{option.name}
								</button>
							);
						})}
					</div>
					{isSelected && selectedOption && (
						<div
							style={{
								marginTop: "12px",
								padding: "8px",
								backgroundColor: "var(--background-primary)",
								borderRadius: "4px",
								fontSize: "13px",
								color: "var(--text-accent)",
								userSelect: "text",
							}}
						>
							✓ Selected: {selectedOption.name}
						</div>
					)}
					{isCancelled && (
						<div
							style={{
								marginTop: "12px",
								padding: "8px",
								backgroundColor: "var(--background-primary)",
								borderRadius: "4px",
								fontSize: "13px",
								color: "var(--color-orange)",
								userSelect: "text",
							}}
						>
							⚠ Cancelled: Permission request was cancelled
						</div>
					)}
				</div>
			);

		case "terminal":
			return (
				<TerminalRenderer
					terminalId={content.terminalId}
					acpClient={acpClient || null}
				/>
			);

		default:
			return <span>Unsupported content type</span>;
	}
}

// Terminal component that displays real-time output
function TerminalRenderer({
	terminalId,
	acpClient,
}: {
	terminalId: string;
	acpClient: AcpClient | null;
}) {
	const [output, setOutput] = useState("");
	const [exitStatus, setExitStatus] = useState<{
		exitCode: number | null;
		signal: string | null;
	} | null>(null);
	const [isRunning, setIsRunning] = useState(true);
	const [isCancelled, setIsCancelled] = useState(false);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (!acpClient || !terminalId) return;

		const pollOutput = async () => {
			try {
				const result = await acpClient.terminalOutput({
					terminalId,
					sessionId: "",
				});
				setOutput(result.output);
				if (result.exitStatus) {
					setExitStatus(result.exitStatus);
					setIsRunning(false);
					if (intervalRef.current) {
						clearInterval(intervalRef.current);
						intervalRef.current = null;
					}
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				// Check if the error is because terminal was not found (cancelled/killed)
				if (errorMessage.includes("not found")) {
					console.log(
						`[TerminalRenderer] Terminal ${terminalId} was cancelled/killed, stopping polling`,
					);
					setIsCancelled(true);
				} else {
					// Log other errors but don't spam the console
					console.log(
						`[TerminalRenderer] Polling stopped for terminal ${terminalId}: ${errorMessage}`,
					);
					setIsCancelled(true); // Treat any polling error as cancelled
				}

				setIsRunning(false);
				if (intervalRef.current) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			}
		};

		// Initial poll
		pollOutput();

		// Set up polling interval - will be cleared when isRunning becomes false
		intervalRef.current = setInterval(pollOutput, 500);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [terminalId, acpClient]); // Remove isRunning from dependencies

	// Separate effect to stop polling when no longer running
	useEffect(() => {
		if (!isRunning && intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, [isRunning]);

	return (
		<div
			style={{
				padding: "12px",
				marginTop: "4px",
				backgroundColor: "var(--background-secondary)",
				border: "1px solid var(--background-modifier-border)",
				borderRadius: "8px",
				fontSize: "12px",
				fontFamily: "var(--font-monospace)",
				userSelect: "text",
			}}
		>
			<div
				style={{
					fontWeight: "bold",
					marginBottom: "8px",
					display: "flex",
					alignItems: "center",
					gap: "8px",
					fontFamily: "var(--font-interface)",
					userSelect: "text",
				}}
			>
				🖥️ Terminal {terminalId.slice(0, 8)}
				{isRunning ? (
					<span
						style={{
							color: "var(--color-green)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● RUNNING
					</span>
				) : isCancelled ? (
					<span
						style={{
							color: "var(--color-orange)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● CANCELLED
					</span>
				) : (
					<span
						style={{
							color: "var(--text-muted)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● FINISHED
					</span>
				)}
			</div>

			<div
				style={{
					backgroundColor: "var(--background-primary)",
					padding: "8px",
					borderRadius: "4px",
					border: "1px solid var(--background-modifier-border)",
					minHeight: "100px",
					maxHeight: "400px",
					overflow: "auto",
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					userSelect: "text",
				}}
			>
				{output || (isRunning ? "Waiting for output..." : "No output")}
			</div>

			{exitStatus && (
				<div
					style={{
						marginTop: "8px",
						padding: "4px 8px",
						backgroundColor:
							exitStatus.exitCode === 0
								? "var(--color-green)"
								: "var(--color-red)",
						color: "white",
						borderRadius: "4px",
						fontSize: "11px",
						fontFamily: "var(--font-interface)",
						userSelect: "text",
					}}
				>
					Exit Code: {exitStatus.exitCode}
					{exitStatus.signal && ` | Signal: ${exitStatus.signal}`}
				</div>
			)}
		</div>
	);
}

function MessageRenderer({
	message,
	plugin,
	acpClient,
	updateMessageContent,
}: {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: AcpClient;
	updateMessageContent?: (
		messageId: string,
		updatedContent: MessageContent,
	) => void;
}) {
	return (
		<div
			style={{
				backgroundColor:
					message.role === "user"
						? "var(--background-primary)"
						: "transparent",
				padding: "0px 16px",
				borderRadius: message.role === "user" ? "8px" : "0px",
				width: "100%",
				border:
					message.role === "user"
						? "1px solid var(--background-modifier-border)"
						: "none",
				margin: "4px 0",
			}}
		>
			{message.content.map((content, idx) => (
				<div key={idx}>
					<MessageContentRenderer
						content={content}
						plugin={plugin}
						messageId={message.id}
						acpClient={acpClient}
						updateMessageContent={updateMessageContent}
					/>
				</div>
			))}
		</div>
	);
}

class AcpClient implements acp.Client {
	private addMessage: (message: ChatMessage) => void;
	private updateLastMessage: (content: MessageContent) => void;
	private updateMessage: (
		toolCallId: string,
		content: MessageContent,
	) => void;
	private currentMessageId: string | null = null;
	private pendingPermissionRequests = new Map<
		string,
		(response: acp.RequestPermissionResponse) => void
	>();
	private terminalManager = new TerminalManager();
	private vaultPath: string;

	constructor(
		addMessage: (message: ChatMessage) => void,
		updateLastMessage: (content: MessageContent) => void,
		updateMessage: (toolCallId: string, content: MessageContent) => void,
		vaultPath: string,
	) {
		this.addMessage = addMessage;
		this.updateLastMessage = updateLastMessage;
		this.updateMessage = updateMessage;
		this.vaultPath = vaultPath;
	}

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		console.log(update);
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				if (update.content.type === "text") {
					this.updateLastMessage({
						type: "text",
						text: update.content.text,
					});
				}
				break;
			case "agent_thought_chunk":
				if (update.content.type === "text") {
					this.updateLastMessage({
						type: "agent_thought",
						text: update.content.text,
					});
				}
				break;
			case "tool_call":
				this.addMessage({
					id: crypto.randomUUID(),
					role: "assistant",
					content: [
						{
							type: "tool_call",
							toolCallId: update.toolCallId,
							title: update.title,
							status: update.status || "pending",
							kind: update.kind,
							content: update.content,
						},
					],
					timestamp: new Date(),
				});
				break;
			case "tool_call_update":
				this.updateMessage(update.toolCallId, {
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title, // Don't provide fallback - let updateLastMessage preserve existing title
					status: update.status || "pending",
					kind: update.kind || undefined,
					content: update.content || undefined,
				});
				break;
			case "plan":
				this.updateLastMessage({
					type: "plan",
					entries: update.entries,
				});
				break;
		}
	}

	resetCurrentMessage() {
		this.currentMessageId = null;
	}

	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		console.log("Permission request received:", params);

		// If tool call details are provided, add the tool call message first
		if ((params as any).toolCall && (params as any).toolCall.title) {
			const toolCallInfo = (params as any).toolCall;
			this.addMessage({
				id: crypto.randomUUID(),
				role: "assistant",
				content: [
					{
						type: "tool_call",
						toolCallId: toolCallInfo.toolCallId,
						title: toolCallInfo.title,
						status: toolCallInfo.status || "pending",
						kind: toolCallInfo.kind,
						content: toolCallInfo.content,
					},
				],
				timestamp: new Date(),
			});
		}

		// Generate unique ID for this permission request
		const requestId = crypto.randomUUID();

		// Add permission request message to chat
		this.addMessage({
			id: requestId,
			role: "assistant",
			content: [
				{
					type: "permission_request",
					toolCall: {
						toolCallId: params.toolCallId,
					},
					options: params.options,
				},
			],
			timestamp: new Date(),
		});

		// Return a Promise that will be resolved when user clicks a button
		return new Promise((resolve) => {
			this.pendingPermissionRequests.set(requestId, resolve);
		});
	}

	// Method to handle user's permission response
	handlePermissionResponse(requestId: string, optionId: string) {
		const resolve = this.pendingPermissionRequests.get(requestId);
		if (resolve) {
			resolve({
				outcome: {
					outcome: "selected",
					optionId: optionId,
				},
			});
			this.pendingPermissionRequests.delete(requestId);
		}
	}

	// Method to cancel all pending permission requests
	cancelPendingPermissionRequests() {
		console.log(
			`Cancelling ${this.pendingPermissionRequests.size} pending permission requests`,
		);
		this.pendingPermissionRequests.forEach((resolve, requestId) => {
			resolve({
				outcome: {
					outcome: "cancelled",
				},
			});
		});
		this.pendingPermissionRequests.clear();
	}

	// Method to cancel all running operations
	cancelAllOperations() {
		console.log("Cancelling all running operations...");

		// Cancel pending permission requests
		this.cancelPendingPermissionRequests();

		// Kill all running terminals
		this.terminalManager.killAllTerminals();
	}
	async readTextFile(params: acp.ReadTextFileRequest) {
		return { content: "" };
	}
	async writeTextFile(params: acp.WriteTextFileRequest) {
		return {};
	}
	async createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		console.log("[AcpClient] createTerminal called with params:", params);

		// Use vault path if cwd is not provided
		const modifiedParams = {
			...params,
			cwd: params.cwd || this.vaultPath,
		};
		console.log("[AcpClient] Using modified params:", modifiedParams);

		const terminalId = this.terminalManager.createTerminal(modifiedParams);
		return {
			terminalId,
		};
	}

	async terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		const result = this.terminalManager.getOutput(params.terminalId);
		if (!result) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return result;
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		return await this.terminalManager.waitForExit(params.terminalId);
	}

	async killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalResponse> {
		const success = this.terminalManager.killTerminal(params.terminalId);
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return {};
	}

	async releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		const success = this.terminalManager.releaseTerminal(params.terminalId);
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return {};
	}
}

// Header button component with Lucide icons
function HeaderButton({
	iconName,
	tooltip,
	onClick,
}: {
	iconName: string;
	tooltip: string;
	onClick: () => void;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (buttonRef.current) {
			setIcon(buttonRef.current, iconName);
			const svg = buttonRef.current.querySelector("svg");
			if (svg) {
				svg.style.color = "var(--text-muted)";
			}
		}
	}, [iconName]);

	return (
		<button
			ref={buttonRef}
			title={tooltip}
			onClick={onClick}
			style={{
				width: "20px",
				height: "20px",
				border: "none",
				borderRadius: "0",
				backgroundColor: "transparent",
				color: "var(--text-muted)",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: "16px",
				transition: "all 0.2s ease",
				padding: "0",
				margin: "0",
				outline: "none",
				appearance: "none",
				boxShadow: "none",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.backgroundColor =
					"var(--background-modifier-hover)";
				const svg = e.currentTarget.querySelector("svg");
				if (svg) {
					svg.style.color = "var(--interactive-accent)";
				}
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.backgroundColor = "transparent";
				const svg = e.currentTarget.querySelector("svg");
				if (svg) {
					svg.style.color = "var(--text-muted)";
				}
			}}
		/>
	);
}

function ChatComponent({ plugin }: { plugin: AgentClientPlugin }) {
	// Use the settings store to get reactive settings
	const settings = useSyncExternalStore(
		plugin.settingsStore.subscribe,
		plugin.settingsStore.getSnapshot,
		plugin.settingsStore.getSnapshot,
	);

	const [inputValue, setInputValue] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [authMethods, setAuthMethods] = useState<acp.AuthMethod[] | null>(
		null,
	);
	const [showAuthSelection, setShowAuthSelection] = useState(false);
	const [currentAgentId, setCurrentAgentId] = useState<string>(
		settings.activeAgentId || settings.claude.id,
	);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const connectionRef = useRef<acp.ClientSideConnection | null>(null);
	const agentProcessRef = useRef<ChildProcess | null>(null);
	const acpClientRef = useRef<AcpClient | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	// Note mention service for @-mention functionality
	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	// Mention dropdown state
	const [showMentionDropdown, setShowMentionDropdown] = useState(false);
	const [mentionSuggestions, setMentionSuggestions] = useState<TFile[]>([]);
	const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
	const [mentionContext, setMentionContext] = useState<MentionContext | null>(
		null,
	);

	const getActiveAgentLabel = () => {
		const activeId = currentAgentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
			);
		}
		if (activeId === plugin.settings.gemini.id) {
			return (
				plugin.settings.gemini.displayName || plugin.settings.gemini.id
			);
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	};

	const activeAgentLabel = getActiveAgentLabel();
	const activeAgentId = currentAgentId;

	// Auto-scroll functions
	const checkIfAtBottom = () => {
		const container = messagesContainerRef.current;
		if (!container) return true;

		const threshold = 50; // pixels from bottom
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	};

	const scrollToBottom = () => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	};

	// Mention handling functions
	const updateMentionSuggestions = (context: MentionContext | null) => {
		console.log("[DEBUG] updateMentionSuggestions called with:", context);

		if (!context) {
			console.log("[DEBUG] No context, hiding dropdown");
			setShowMentionDropdown(false);
			setMentionSuggestions([]);
			setMentionContext(null);
			return;
		}

		console.log("[DEBUG] Searching notes with query:", context.query);
		const suggestions = noteMentionService.searchNotes(context.query);
		console.log(
			"[DEBUG] Found suggestions:",
			suggestions.length,
			suggestions.map((f) => f.name),
		);

		setMentionSuggestions(suggestions);
		setMentionContext(context);
		setSelectedMentionIndex(0);

		if (suggestions.length > 0) {
			console.log("[DEBUG] Showing dropdown");
			setShowMentionDropdown(true);
		} else {
			console.log("[DEBUG] No suggestions, hiding dropdown");
			setShowMentionDropdown(false);
		}
	};

	const closeMentionDropdown = () => {
		setShowMentionDropdown(false);
		setMentionSuggestions([]);
		setMentionContext(null);
		setSelectedMentionIndex(0);
	};

	const selectMention = (file: TFile) => {
		if (!mentionContext) return;

		const { newText, newCursorPos } = replaceMention(
			inputValue,
			mentionContext,
			file.basename,
		);
		setInputValue(newText);
		closeMentionDropdown();

		// Set cursor position after replacement
		setTimeout(() => {
			const textarea = textareaRef.current;
			if (textarea) {
				textarea.selectionStart = newCursorPos;
				textarea.selectionEnd = newCursorPos;
				textarea.focus();
			}
		}, 0);
	};

	const addMessage = (message: ChatMessage) => {
		setMessages((prev) => [...prev, message]);
	};

	const markPermissionRequestsAsCancelled = () => {
		setMessages((prev) =>
			prev.map((message) => ({
				...message,
				content: message.content.map((content) =>
					content.type === "permission_request" &&
					!content.selectedOptionId
						? { ...content, isCancelled: true }
						: content,
				),
			})),
		);
	};

	const updateMessageContent = (
		messageId: string,
		updatedContent: MessageContent,
	) => {
		setMessages((prev) =>
			prev.map((message) => {
				if (message.id === messageId) {
					return {
						...message,
						content: message.content.map((content, index) =>
							content.type === updatedContent.type &&
							(updatedContent.type !== "tool_call" ||
								(content as any).toolCall?.toolCallId ===
									(updatedContent as any).toolCall
										?.toolCallId)
								? updatedContent
								: content,
						),
					};
				}
				return message;
			}),
		);
	};

	const updateLastMessage = (content: MessageContent) => {
		setMessages((prev) => {
			if (
				prev.length === 0 ||
				prev[prev.length - 1].role !== "assistant"
			) {
				return [
					...prev,
					{
						id: crypto.randomUUID(),
						role: "assistant",
						content: [content],
						timestamp: new Date(),
					},
				];
			}

			const lastMessage = prev[prev.length - 1];
			const updatedMessage = { ...lastMessage };

			if (content.type === "text" || content.type === "agent_thought") {
				// Append to existing content of same type or create new content
				const existingContentIndex = updatedMessage.content.findIndex(
					(c) => c.type === content.type,
				);
				if (existingContentIndex >= 0) {
					updatedMessage.content[existingContentIndex] = {
						type: content.type,
						text:
							(
								updatedMessage.content[
									existingContentIndex
								] as any
							).text +
							(content.type === "agent_thought" ? "\n" : "") +
							content.text,
					};
				} else {
					updatedMessage.content.push(content);
				}
			} else {
				// Replace or add non-text content
				const existingIndex = updatedMessage.content.findIndex(
					(c) => c.type === content.type,
				);

				if (existingIndex >= 0) {
					updatedMessage.content[existingIndex] = content;
				} else {
					updatedMessage.content.push(content);
				}
			}

			return [...prev.slice(0, -1), updatedMessage];
		});
	};

	// ChatComponent内に追加
	const updateMessage = (
		toolCallId: string,
		updatedContent: MessageContent,
	) => {
		setMessages((prev) =>
			prev.map((message) => {
				// tool_callを含むメッセージを検索
				const hasTargetToolCall = message.content.some(
					(content) =>
						content.type === "tool_call" &&
						(content as any).toolCallId === toolCallId,
				);

				if (hasTargetToolCall) {
					return {
						...message,
						content: message.content.map((content) => {
							if (
								content.type === "tool_call" &&
								(content as any).toolCallId === toolCallId
							) {
								// 既存のtool_callを更新（マージ）
								const existing = content as any;
								const updated = updatedContent as any;
								return {
									...existing,
									...updated,
									// statusとcontentは上書き、titleは新しい値があれば更新
									title:
										updated.title !== undefined
											? updated.title
											: existing.title,
									content:
										updated.content !== undefined
											? [
													...(existing.content || []),
													...(updated.content || []),
												]
											: existing.content,
								};
							}
							return content;
						}),
					};
				}
				return message;
			}),
		);
	};

	const adjustTextareaHeight = () => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			const scrollHeight = textarea.scrollHeight;
			const maxHeight = 120;
			textarea.style.height = Math.min(scrollHeight, maxHeight) + "px";
		}
	};

	useEffect(() => {
		async function setupConnection() {
			console.log("[Debug] Starting connection setup...");

			// Get the Vault root path
			const vaultPath =
				(plugin.app.vault.adapter as any).basePath || process.cwd();

			type LaunchableAgent = {
				id: string;
				label: string;
				command: string;
				args: string[];
				env: { key: string; value: string }[];
				extraEnv: Record<string, string>;
			};

			const launchCandidates: LaunchableAgent[] = [
				{
					id: plugin.settings.claude.id,
					label:
						plugin.settings.claude.displayName ||
						plugin.settings.claude.id,
					command: plugin.settings.claude.command,
					args: plugin.settings.claude.args,
					env: plugin.settings.claude.env,
					extraEnv: {
						ANTHROPIC_API_KEY: plugin.settings.claude.apiKey,
					},
				},
				{
					id: plugin.settings.gemini.id,
					label:
						plugin.settings.gemini.displayName ||
						plugin.settings.gemini.id,
					command: plugin.settings.gemini.command,
					args: plugin.settings.gemini.args,
					env: plugin.settings.gemini.env,
					extraEnv: { GEMINI_API_KEY: plugin.settings.gemini.apiKey },
				},
				...plugin.settings.customAgents.map((agent) => ({
					id: agent.id,
					label:
						agent.displayName && agent.displayName.length > 0
							? agent.displayName
							: agent.id,
					command: agent.command,
					args: agent.args,
					env: agent.env,
					extraEnv: {},
				})),
			];

			if (launchCandidates.length === 0) {
				console.error("[Error] No agents available to launch.");
				return;
			}

			const activeAgentCandidate =
				launchCandidates.find(
					(candidate) => candidate.id === currentAgentId,
				) ?? launchCandidates[0];

			if (
				!activeAgentCandidate.command ||
				activeAgentCandidate.command.trim().length === 0
			) {
				console.error(
					`[Error] Command not configured for agent "${activeAgentCandidate.label}" (${activeAgentCandidate.id}).`,
				);
				return;
			}

			const activeAgent: LaunchableAgent = {
				...activeAgentCandidate,
				command: activeAgentCandidate.command.trim(),
			};

			const agentArgs =
				activeAgent.args.length > 0 ? [...activeAgent.args] : [];

			console.log(
				`[Debug] Active agent: ${activeAgent.label} (${activeAgent.id})`,
			);
			console.log("[Debug] Command:", activeAgent.command);
			console.log(
				"[Debug] Args:",
				agentArgs.length > 0 ? agentArgs.join(" ") : "(none)",
			);

			const baseEnv: NodeJS.ProcessEnv = {
				...process.env,
				...envVarsToRecord(activeAgent.env),
			};

			for (const [key, value] of Object.entries(activeAgent.extraEnv)) {
				if (typeof value === "string" && value.length > 0) {
					baseEnv[key] = value;
				}
			}

			const commandDir = resolveCommandDirectory(activeAgent.command);
			if (commandDir) {
				baseEnv.PATH = baseEnv.PATH
					? `${commandDir}:${baseEnv.PATH}`
					: commandDir;
			}

			// Get the Vault root path for agent process
			console.log(
				"[Debug] Starting agent process in directory:",
				vaultPath,
			);

			const agentProcess = spawn(activeAgent.command, agentArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: baseEnv,
				cwd: vaultPath,
			});
			agentProcessRef.current = agentProcess;

			const agentLabel = `${activeAgent.label} (${activeAgent.id})`;

			agentProcess.on("spawn", () => {
				console.log(
					`[Debug] ${agentLabel} process spawned successfully, PID:`,
					agentProcess.pid,
				);
			});

			agentProcess.on("error", (error) => {
				console.error(`[Debug] ${agentLabel} process error:`, error);
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					console.error(
						`[Error] Command not found: ${activeAgent.command || "(empty)"}`,
					);
					console.error(
						`[Info] Check the command or update the correct path in settings for "${agentLabel}".`,
					);
				}
			});

			agentProcess.on("exit", (code, signal) => {
				console.log(
					`[Debug] ${agentLabel} process exited with code:`,
					code,
					"signal:",
					signal,
				);
				if (code === 127) {
					console.error(
						`[Error] Command not found: ${activeAgent.command || "(empty)"}`,
					);
					console.error(
						"[Info] Make sure the CLI is installed and the command path is correct.",
					);
				}
			});

			agentProcess.on("close", (code, signal) => {
				console.log(
					`[Debug] ${agentLabel} process closed with code:`,
					code,
					"signal:",
					signal,
				);
			});

			agentProcess.stderr?.setEncoding("utf8");
			agentProcess.stderr?.on("data", (data) => {
				console.log(`[Debug] ${agentLabel} stderr:`, data);
			});

			setTimeout(() => {
				if (
					agentProcess.exitCode === null &&
					agentProcess.killed === false
				) {
					console.log(
						"[Debug] Process still running after 2 seconds",
					);
				} else {
					console.log(
						"[Debug] Process not running. Exit code:",
						agentProcess.exitCode,
						"Killed:",
						agentProcess.killed,
					);
				}
			}, 2000);

			const input = new WritableStream({
				write(chunk) {
					agentProcess.stdin!.write(chunk);
				},
				close() {
					agentProcess.stdin!.end();
				},
			});
			const output = new ReadableStream({
				start(controller) {
					agentProcess.stdout!.on("data", (chunk) => {
						controller.enqueue(chunk);
					});
					agentProcess.stdout!.on("end", () => {
						controller.close();
					});
				},
			});

			console.log("[Debug] Using vault path for AcpClient:", vaultPath);

			const client = new AcpClient(
				addMessage,
				updateLastMessage,
				updateMessage,
				vaultPath,
			);
			acpClientRef.current = client;
			const stream = acp.ndJsonStream(input, output);
			const connection = new acp.ClientSideConnection(
				() => client,
				stream,
			);
			connectionRef.current = connection;

			try {
				console.log("[Debug] Starting ACP initialization...");
				const initResult = await connection.initialize({
					protocolVersion: acp.PROTOCOL_VERSION,
					clientCapabilities: {
						fs: {
							readTextFile: false,
							writeTextFile: false,
						},
						terminal: true,
					},
				});
				console.log(
					`✅ Connected to agent (protocol v${initResult.protocolVersion})`,
				);
				console.log(initResult.authMethods);

				console.log("process.cwd():", process.cwd());
				console.log("vaultPath:", vaultPath);
				console.log("[Debug] Starting session creation...");
				const sessionResult = await connection.newSession({
					cwd: vaultPath,
					mcpServers: [],
				});
				console.log(`📝 Created session: ${sessionResult.sessionId}`);

				setSessionId(sessionResult.sessionId);
				setAuthMethods(initResult.authMethods || []);
				setIsReady(true);
			} catch (error) {
				console.error("[Client] Initialization Error:", error);
				console.error("[Client] Error details:", error);
			}
		}

		setupConnection();

		return () => {
			agentProcessRef.current?.kill();
		};
	}, [currentAgentId]);

	// Monitor agent changes from settings when messages are empty
	useEffect(() => {
		const newActiveAgentId = settings.activeAgentId || settings.claude.id;
		if (messages.length === 0 && newActiveAgentId !== currentAgentId) {
			setCurrentAgentId(newActiveAgentId);
		}
	}, [settings.activeAgentId, messages.length]);

	// Auto-scroll when messages change
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			setTimeout(() => {
				scrollToBottom();
			}, 0);
		}
	}, [messages, isAtBottom]);

	// Set up scroll event listener
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		const handleScroll = () => {
			checkIfAtBottom();
		};

		container.addEventListener("scroll", handleScroll, { passive: true });

		// Initial check
		checkIfAtBottom();

		return () => {
			container.removeEventListener("scroll", handleScroll);
		};
	}, []);

	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue]);

	useEffect(() => {
		if (sendButtonRef.current) {
			// Set icon based on sending state
			const iconName = isSending ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [isSending]);

	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [inputValue, isSending]);

	const updateIconColor = (svg: SVGElement) => {
		if (isSending) {
			// Stop button - always active when sending
			svg.style.color = "var(--color-red)";
		} else {
			// Send button - active when has input
			const hasInput = inputValue.trim() !== "";
			svg.style.color = hasInput
				? "var(--interactive-accent)"
				: "var(--text-muted)";
		}
	};

	const authenticate = async (methodId: string) => {
		if (!connectionRef.current) return false;

		try {
			await connectionRef.current.authenticate({ methodId });
			console.log("✅ authenticate ok:", methodId);
			setShowAuthSelection(false);
			return true;
		} catch (error) {
			console.error("[Client] Authentication Error:", error);
			return false;
		}
	};

	const createNewSession = async () => {
		if (!connectionRef.current) return;

		try {
			console.log("[Debug] Creating new session...");
			// Get the Vault root path
			const vaultPath =
				(plugin.app.vault.adapter as any).basePath || process.cwd();
			console.log("[Debug] Using vault path as cwd:", vaultPath);

			const sessionResult = await connectionRef.current.newSession({
				cwd: vaultPath,
				mcpServers: [],
			});
			console.log(`📝 Created new session: ${sessionResult.sessionId}`);

			setSessionId(sessionResult.sessionId);
			setMessages([]);
			setInputValue("");
			acpClientRef.current?.resetCurrentMessage();

			// Switch to the active agent from settings if different from current
			const newActiveAgentId =
				plugin.settings.activeAgentId || plugin.settings.claude.id;
			if (newActiveAgentId !== currentAgentId) {
				setCurrentAgentId(newActiveAgentId);
			}
		} catch (error) {
			console.error("[Client] New Session Error:", error);
		}
	};

	const handleStopGeneration = async () => {
		if (!connectionRef.current || !sessionId) {
			console.warn("Cannot cancel: no connection or session");
			setIsSending(false);
			return;
		}

		try {
			console.log("Sending session/cancel notification...");

			// Send cancellation notification using the proper ACP method
			await connectionRef.current.cancel({
				sessionId: sessionId,
			});

			console.log("Cancellation request sent successfully");

			// Cancel all running operations (permission requests + terminals)
			acpClientRef.current?.cancelAllOperations();

			// Mark permission requests as cancelled in UI
			markPermissionRequestsAsCancelled();

			// Update UI state immediately
			setIsSending(false);
		} catch (error) {
			console.error("Failed to send cancellation:", error);

			// Still cancel all operations even if network cancellation failed
			acpClientRef.current?.cancelAllOperations();

			// Mark permission requests as cancelled in UI
			markPermissionRequestsAsCancelled();

			setIsSending(false);
		}
	};

	const handleSendMessage = async () => {
		if (!connectionRef.current || !inputValue.trim() || isSending) return;

		setIsSending(true);

		// Add user message to chat (keep original text with @mentions for display)
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: inputValue }],
			timestamp: new Date(),
		};
		addMessage(userMessage);

		// Convert @mentions to relative paths for agent consumption
		const messageTextForAgent = convertMentionsToPath(
			inputValue,
			noteMentionService,
			(plugin.app.vault.adapter as any).basePath || "",
		);
		setInputValue("");

		// Force scroll to bottom when user sends a message
		setIsAtBottom(true);
		setTimeout(() => {
			scrollToBottom();
		}, 0);

		// Reset current message for new assistant response
		acpClientRef.current?.resetCurrentMessage();

		try {
			console.log(`\n✅ Sending Message...: ${messageTextForAgent}`);
			const promptResult = await connectionRef.current.prompt({
				sessionId: sessionId!,
				prompt: [
					{
						type: "text",
						text: messageTextForAgent,
					},
				],
			});
			console.log(
				`\n✅ Agent completed with: ${promptResult.stopReason}`,
			);

			setIsSending(false);
		} catch (error) {
			console.error("[Client] Prompt Error:", error);
			setIsSending(false);

			if (!authMethods || authMethods.length === 0) {
				console.error("No auth methods available");
				return;
			}

			if (authMethods.length === 1) {
				const success = await authenticate(authMethods[0].id);
				if (success) {
					// Retry with the same message text
					setIsSending(true);
					try {
						const promptResult = await connectionRef.current.prompt(
							{
								sessionId: sessionId!,
								prompt: [
									{
										type: "text",
										text: messageTextForAgent,
									},
								],
							},
						);
						console.log(
							`\n✅ Agent completed with: ${promptResult.stopReason}`,
						);
						setIsSending(false);
					} catch (retryError) {
						console.error("[Client] Retry Error:", retryError);
						setIsSending(false);
					}
				}
			} else {
				setShowAuthSelection(true);
			}
		}
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		// Handle mention dropdown navigation first
		if (showMentionDropdown) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedMentionIndex((prev) =>
					prev < mentionSuggestions.length - 1 ? prev + 1 : 0,
				);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedMentionIndex((prev) =>
					prev > 0 ? prev - 1 : mentionSuggestions.length - 1,
				);
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				const selectedFile = mentionSuggestions[selectedMentionIndex];
				if (selectedFile) {
					selectMention(selectedFile);
				}
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				closeMentionDropdown();
				return;
			}
		}

		// Normal input handling
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		const cursorPosition = e.target.selectionStart || 0;

		console.log(
			"[DEBUG] Input changed:",
			newValue,
			"cursor:",
			cursorPosition,
		);

		setInputValue(newValue);

		// Check for mention detection
		const mentionDetected = detectMention(newValue, cursorPosition);
		console.log("[DEBUG] Mention detected:", mentionDetected);
		updateMentionSuggestions(mentionDetected);
	};

	return (
		<div
			style={{
				height: "100%",
				display: "flex",
				flexDirection: "column",
				padding: "0",
			}}
		>
			<div
				style={{
					padding: "16px",
					borderBottom: "1px solid var(--background-modifier-border)",
					flexShrink: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<h3 style={{ margin: "0" }}>{activeAgentLabel}</h3>
				<div style={{ display: "flex", gap: "8px" }}>
					<HeaderButton
						iconName="plus"
						tooltip="New chat"
						onClick={createNewSession}
					/>
					<HeaderButton
						iconName="settings"
						tooltip="Settings"
						onClick={() => {
							// Open plugin settings
							(plugin.app as any).setting.open();
							(plugin.app as any).setting.openTabById(
								plugin.manifest.id,
							);
						}}
					/>
				</div>
			</div>

			<div
				ref={messagesContainerRef}
				style={{
					flex: 1,
					padding: "16px",
					overflowY: "auto",
					display: "flex",
					flexDirection: "column",
					gap: "2px",
				}}
			>
				{showAuthSelection ? (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "12px",
							padding: "20px",
							backgroundColor: "var(--background-secondary)",
							borderRadius: "8px",
							border: "1px solid var(--background-modifier-border)",
						}}
					>
						<h4 style={{ margin: "0 0 8px 0" }}>
							Choose Authentication Method
						</h4>
						<p
							style={{
								margin: "0",
								color: "var(--text-muted)",
								fontSize: "14px",
							}}
						>
							Select how you want to authenticate with the AI
							agent:
						</p>
						{authMethods?.map((method) => (
							<button
								key={method.id}
								onClick={() => authenticate(method.id)}
								style={{
									padding: "12px 16px",
									border: "1px solid var(--background-modifier-border)",
									borderRadius: "6px",
									backgroundColor:
										"var(--background-primary)",
									color: "var(--text-normal)",
									cursor: "pointer",
									textAlign: "left",
									transition: "all 0.2s ease",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.backgroundColor =
										"var(--background-modifier-hover)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.backgroundColor =
										"var(--background-primary)";
								}}
							>
								<div style={{ fontWeight: "500" }}>
									{method.name || method.id}
								</div>
							</button>
						))}
						<button
							onClick={() => setShowAuthSelection(false)}
							style={{
								padding: "8px 16px",
								border: "1px solid var(--background-modifier-border)",
								borderRadius: "6px",
								backgroundColor: "transparent",
								color: "var(--text-muted)",
								cursor: "pointer",
								fontSize: "14px",
							}}
						>
							Cancel
						</button>
					</div>
				) : messages.length === 0 ? (
					<div
						style={{
							color: "var(--text-muted)",
							textAlign: "center",
							marginTop: "20px",
						}}
					>
						{!isReady
							? "Connecting to AI agent..."
							: "Start a conversation with AI..."}
					</div>
				) : (
					messages.map((message) => (
						<MessageRenderer
							key={message.id}
							message={message}
							plugin={plugin}
							acpClient={acpClientRef.current || undefined}
							updateMessageContent={updateMessageContent}
						/>
					))
				)}
			</div>

			<div style={{ flexShrink: 0 }}>
				<div style={{ position: "relative" }}>
					{/* Mention Dropdown - overlay positioned */}
					{(() => {
						console.log("[DEBUG] Dropdown render check:", {
							showMentionDropdown,
							suggestionsCount: mentionSuggestions.length,
							selectedIndex: selectedMentionIndex,
						});
						return null;
					})()}
					{showMentionDropdown && (
						<MentionDropdown
							files={mentionSuggestions}
							selectedIndex={selectedMentionIndex}
							onSelect={selectMention}
							onClose={closeMentionDropdown}
						/>
					)}
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyPress}
						placeholder={
							isSending
								? "Sending..."
								: "Message Agent (Enter to send, Shift+Enter for new line)"
						}
						style={{
							width: "100%",
							padding: "12px 40px 12px 12px",
							border: "1px solid var(--background-modifier-border)",
							borderRadius: "8px",
							backgroundColor: "var(--background-primary)",
							color: "var(--text-normal)",
							resize: "none",
							minHeight: "80px",
							height: "80px",
							fontFamily: "inherit",
							boxSizing: "border-box",
							outline: "none",
							overflow: "hidden",
							scrollbarWidth: "none",
							msOverflowStyle: "none",
						}}
						rows={1}
					/>
					<button
						ref={sendButtonRef}
						onClick={
							isSending ? handleStopGeneration : handleSendMessage
						}
						disabled={
							!isSending && (inputValue.trim() === "" || !isReady)
						}
						style={{
							position: "absolute",
							right: "8px",
							bottom: "8px",
							width: "20px",
							height: "20px",
							border: "none",
							borderRadius: "0",
							backgroundColor: "transparent",
							cursor:
								!isSending &&
								(inputValue.trim() === "" || !isReady)
									? "not-allowed"
									: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "16px",
							transition: "all 0.2s ease",
							padding: "0",
							margin: "0",
							outline: "none",
							appearance: "none",
							boxShadow: "none",
						}}
						title={
							!isReady
								? "Connecting..."
								: isSending
									? "Stop generation"
									: "Send message"
						}
					></button>
				</div>
			</div>
		</div>
	);
}

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Chat";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatComponent plugin={this.plugin} />);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
