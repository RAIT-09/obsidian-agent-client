import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import React, { useState, useRef, useEffect } from "react";
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
			title: string;
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
	  };

interface ChatMessage {
	id: string;
	role: MessageRole;
	content: MessageContent[];
	timestamp: Date;
}

export const VIEW_TYPE_CHAT = "chat-view";

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
}: {
	content: MessageContent;
	plugin: AgentClientPlugin;
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
					{content.content && content.content.length > 0 && (
						<div style={{ marginTop: "2px" }}>
							{content.content.map((item, idx) => {
								if (
									item.type === "content" &&
									item.content?.type === "text"
								) {
									return (
										<div
											key={idx}
											style={{ marginBottom: "1px" }}
										>
											<MarkdownTextRenderer
												text={item.content.text}
												plugin={plugin}
											/>
										</div>
									);
								}
								return null;
							})}
						</div>
					)}
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

		default:
			return <span>Unsupported content type</span>;
	}
}

function MessageRenderer({
	message,
	plugin,
}: {
	message: ChatMessage;
	plugin: AgentClientPlugin;
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
					<MessageContentRenderer content={content} plugin={plugin} />
				</div>
			))}
		</div>
	);
}

class AcpClient implements acp.Client {
	private addMessage: (message: ChatMessage) => void;
	private updateLastMessage: (content: MessageContent) => void;
	private currentMessageId: string | null = null;

	constructor(
		addMessage: (message: ChatMessage) => void,
		updateLastMessage: (content: MessageContent) => void,
	) {
		this.addMessage = addMessage;
		this.updateLastMessage = updateLastMessage;
	}

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		console.log(update);
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				if (update.content.type === "text") {
					if (!this.currentMessageId) {
						// Start new assistant message
						this.currentMessageId = crypto.randomUUID();
						this.addMessage({
							id: this.currentMessageId,
							role: "assistant",
							content: [
								{ type: "text", text: update.content.text },
							],
							timestamp: new Date(),
						});
					} else {
						// Update existing message
						this.updateLastMessage({
							type: "text",
							text: update.content.text,
						});
					}
				}
				break;
			case "agent_thought_chunk":
				if (update.content.type === "text") {
					// Always create new thought message
					this.addMessage({
						id: crypto.randomUUID(),
						role: "assistant",
						content: [
							{
								type: "agent_thought",
								text: update.content.text,
							},
						],
						timestamp: new Date(),
					});
					// Don't set currentMessageId for thoughts as they are standalone
				}
				break;
			case "tool_call":
				this.updateLastMessage({
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title,
					status: update.status || "pending",
					kind: update.kind,
					content: update.content,
				});
				break;
			case "tool_call_update":
				this.updateLastMessage({
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title, // Don't provide empty string fallback
					status: update.status || "pending",
					kind: update.kind,
					content: update.content,
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

	async requestPermission(params: acp.RequestPermissionRequest) {
		return { outcome: { outcome: "cancelled" } };
	}
	async readTextFile(params: acp.ReadTextFileRequest) {
		return { content: "" };
	}
	async writeTextFile(params: acp.WriteTextFileRequest) {
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
	const [inputValue, setInputValue] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [authMethods, setAuthMethods] = useState<acp.AuthMethod[] | null>(
		null,
	);
	const [showAuthSelection, setShowAuthSelection] = useState(false);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const connectionRef = useRef<acp.ClientSideConnection | null>(null);
	const agentProcessRef = useRef<ChildProcess | null>(null);
	const acpClientRef = useRef<AcpClient | null>(null);

	const addMessage = (message: ChatMessage) => {
		setMessages((prev) => [...prev, message]);
	};

	const updateLastMessage = (content: MessageContent) => {
		setMessages((prev) => {
			if (prev.length === 0) return prev;

			const lastMessage = prev[prev.length - 1];
			if (lastMessage.role !== "assistant") return prev;

			const updatedMessage = { ...lastMessage };

			if (content.type === "text") {
				// Append text to existing text content or create new text content
				const textContentIndex = updatedMessage.content.findIndex(
					(c) => c.type === "text",
				);
				if (textContentIndex >= 0) {
					updatedMessage.content[textContentIndex] = {
						type: "text",
						text:
							(updatedMessage.content[textContentIndex] as any)
								.text + content.text,
					};
				} else {
					updatedMessage.content.push(content);
				}
			} else {
				// Replace or add non-text content
				const existingIndex = updatedMessage.content.findIndex(
					(c) =>
						c.type === content.type &&
						(content.type === "tool_call"
							? (c as any).toolCallId ===
								(content as any).toolCallId
							: true),
				);

				if (existingIndex >= 0) {
					if (content.type === "tool_call") {
						// For tool_call updates, preserve existing values if new ones are empty
						const existing = updatedMessage.content[
							existingIndex
						] as any;
						const updated = content as any;
						updatedMessage.content[existingIndex] = {
							...existing,
							...updated,
							// Preserve existing title if update doesn't have one
							title:
								updated.title !== undefined
									? updated.title
									: existing.title,
							// Merge content arrays if update has content
							content:
								updated.content !== undefined
									? [
											...(existing.content || []),
											...(updated.content || []),
										]
									: existing.content,
						};
					} else {
						updatedMessage.content[existingIndex] = content;
					}
				} else {
					updatedMessage.content.push(content);
				}
			}

			return [...prev.slice(0, -1), updatedMessage];
		});
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
			console.log(
				"[Debug] Gemini API Key:",
				plugin.settings.geminiApiKey ? "Set" : "Not set",
			);

			console.log(
				"[Debug] Gemini Command Path:",
				plugin.settings.geminiCommandPath,
			);

			const agentProcess = spawn(
				plugin.settings.geminiCommandPath,
				["--experimental-acp"],
				{
					stdio: ["pipe", "pipe", "pipe"], // Changed from inherit to pipe for stderr
					env: {
						...process.env,
						PATH: plugin.settings.geminiCommandPath.includes("/")
							? `${plugin.settings.geminiCommandPath.substring(0, plugin.settings.geminiCommandPath.lastIndexOf("/"))}:${process.env.PATH || ""}`
							: process.env.PATH || "",
						GEMINI_API_KEY: plugin.settings.geminiApiKey || "",
					},
				},
			);
			agentProcessRef.current = agentProcess;

			// Add process event listeners for debugging
			agentProcess.on("spawn", () => {
				console.log(
					"[Debug] Gemini process spawned successfully, PID:",
					agentProcess.pid,
				);
			});

			agentProcess.on("error", (error) => {
				console.error("[Debug] Gemini process error:", error);
				if (error.message.includes("ENOENT")) {
					console.error(
						`[Error] Gemini command not found at: ${plugin.settings.geminiCommandPath}`,
					);
					console.error(
						"[Info] Please check your Gemini Command Path setting and ensure gemini is installed.",
					);
				}
			});

			agentProcess.on("exit", (code, signal) => {
				console.log(
					"[Debug] Gemini process exited with code:",
					code,
					"signal:",
					signal,
				);
				if (code === 127) {
					console.error(
						`[Error] Command not found: ${plugin.settings.geminiCommandPath}`,
					);
					console.error(
						"[Info] Please install gemini CLI: npm install -g @google/gemini-cli",
					);
					console.error(
						"[Info] Or update the Gemini Command Path in plugin settings",
					);
				}
			});

			agentProcess.on("close", (code, signal) => {
				console.log(
					"[Debug] Gemini process closed with code:",
					code,
					"signal:",
					signal,
				);
			});

			// Capture and log stderr
			agentProcess.stderr?.setEncoding("utf8");
			agentProcess.stderr?.on("data", (data) => {
				console.log("[Debug] Gemini stderr:", data);
			});

			// Test if process is working
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

			const input = Writable.toWeb(agentProcess.stdin!) as WritableStream;
			const output = Readable.toWeb(
				agentProcess.stdout!,
			) as ReadableStream;

			const client = new AcpClient(addMessage, updateLastMessage);
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
						terminal: false,
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
	}, []);

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
				<h3 style={{ margin: "0" }}>Agent Chat</h3>
				<div style={{ display: "flex", gap: "8px" }}>
					<HeaderButton
						iconName="plus"
						tooltip="新しいチャット"
						onClick={createNewSession}
					/>
					<HeaderButton
						iconName="list"
						tooltip="チャット履歴"
						onClick={() => {
							// TODO: チャット履歴を表示
							console.log("Chat history clicked");
						}}
					/>
					<HeaderButton
						iconName="settings"
						tooltip="設定"
						onClick={() => {
							// プラグイン設定を開く
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
