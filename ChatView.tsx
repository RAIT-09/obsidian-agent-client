import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useSyncExternalStore } = React;
import { createRoot, Root } from "react-dom/client";
import { setIcon } from "obsidian";

import { spawn, ChildProcess } from "child_process";
import { Writable, Readable } from "stream";
import * as acp from "@zed-industries/agent-client-protocol";
import type AgentClientPlugin from "./main";

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
				<div style={{ marginTop: "8px", paddingLeft: "16px" }}>
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
		if (containerRef.current && text) {
			// Clear previous content
			containerRef.current.innerHTML = "";

			// Render markdown
			MarkdownRenderer.renderMarkdown(
				text,
				containerRef.current,
				"", // sourcePath - empty for dynamic content
				plugin, // Component for context
			);
		}
	}, [text, plugin]);

	return <div ref={containerRef} />;
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
					}}
				>
					<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
						🔧 {content.title}
					</div>
					<div style={{ color: "var(--text-muted)" }}>
						Status: {content.status}
						{content.kind && ` | Kind: ${content.kind}`}
					</div>
				</div>
			);

		case "plan":
			return (
				<div
					style={{
						padding: "8px",
						marginTop: "4px",
						backgroundColor: "var(--background-modifier-border)",
						borderRadius: "4px",
						fontSize: "12px",
					}}
				>
					<div style={{ fontWeight: "bold", marginBottom: "4px" }}>
						📋 Plan
					</div>
					{content.entries.map((entry, idx) => (
						<div
							key={idx}
							style={{
								margin: "2px 0",
								padding: "2px 4px",
								borderLeft: "2px solid var(--text-muted)",
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
					}}
				>
					<div
						style={{
							fontWeight: "bold",
							marginBottom: "8px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}
					>
						🔐 Permission Request
					</div>
					<div
						style={{
							marginBottom: "12px",
							color: "var(--text-normal)",
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
									disabled={isSelected}
									onClick={() => {
										if (
											acpClient &&
											messageId &&
											updateMessageContent
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
											: isSelected
												? "var(--background-modifier-border)"
												: "var(--background-primary)",
										color: isThisSelected
											? "white"
											: isSelected
												? "var(--text-muted)"
												: "var(--text-normal)",
										cursor: isSelected
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
											isSelected && !isThisSelected
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
							}}
						>
							✓ Selected: {selectedOption.name}
						</div>
					)}
				</div>
			);

		default:
			return <span>Unsupported content type</span>;
	}
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

	constructor(
		addMessage: (message: ChatMessage) => void,
		updateLastMessage: (content: MessageContent) => void,
		updateMessage: (toolCallId: string, content: MessageContent) => void,
	) {
		this.addMessage = addMessage;
		this.updateLastMessage = updateLastMessage;
		this.updateMessage = updateMessage;
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
	async readTextFile(params: acp.ReadTextFileRequest) {
		return { content: "" };
	}
	async writeTextFile(params: acp.WriteTextFileRequest) {
		return {};
	}
	async createTerminal(params: acp.CreateTerminalRequest) {
		return {
			terminalId: "",
		};
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

	const addMessage = (message: ChatMessage) => {
		setMessages((prev) => [...prev, message]);
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
							"\n" +
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

			const agentProcess = spawn(activeAgent.command, agentArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: baseEnv,
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

			const client = new AcpClient(
				addMessage,
				updateLastMessage,
				updateMessage,
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
							readTextFile: true,
							writeTextFile: true,
						},
						terminal: true,
					},
				});
				console.log(
					`✅ Connected to agent (protocol v${initResult.protocolVersion})`,
				);
				console.log(initResult.authMethods);

				console.log("[Debug] Starting session creation...");
				const sessionResult = await connection.newSession({
					cwd: process.cwd(),
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

	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue]);

	useEffect(() => {
		if (sendButtonRef.current) {
			setIcon(sendButtonRef.current, "send-horizontal");
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, []);

	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [inputValue]);

	const updateIconColor = (svg: SVGElement) => {
		const hasInput = inputValue.trim() !== "";
		svg.style.color = hasInput
			? "var(--interactive-accent)"
			: "var(--text-muted)";
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
			const sessionResult = await connectionRef.current.newSession({
				cwd: process.cwd(),
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

	const handleSendMessage = async () => {
		if (!connectionRef.current || !inputValue.trim() || isSending) return;

		setIsSending(true);

		// Add user message to chat
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: inputValue }],
			timestamp: new Date(),
		};
		addMessage(userMessage);

		const messageText = inputValue;
		setInputValue("");

		// Reset current message for new assistant response
		acpClientRef.current?.resetCurrentMessage();

		try {
			console.log(`\n✅ Sending Message...: ${messageText}`);
			const promptResult = await connectionRef.current.prompt({
				sessionId: sessionId!,
				prompt: [
					{
						type: "text",
						text: messageText,
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
										text: messageText,
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
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputValue(e.target.value);
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
						iconName="list"
						tooltip="Chat history"
						onClick={() => {
							// TODO: show chat history
							console.log("Chat history clicked");
						}}
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
							acpClient={acpClientRef.current}
							updateMessageContent={updateMessageContent}
						/>
					))
				)}
			</div>

			<div style={{ flexShrink: 0 }}>
				<div style={{ position: "relative" }}>
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
						onClick={handleSendMessage}
						disabled={
							inputValue.trim() === "" || !isReady || isSending
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
								inputValue.trim() === "" ||
								!isReady ||
								isSending
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
									? "Sending..."
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
