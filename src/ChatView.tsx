import { ItemView, WorkspaceLeaf, TFile, setIcon, Platform } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useSyncExternalStore, useMemo } = React;
import { createRoot, Root } from "react-dom/client";

import { spawn, ChildProcess } from "child_process";
import * as acp from "@zed-industries/agent-client-protocol";
import type AgentClientPlugin from "./main";

// Component imports
import { MentionDropdown } from "./components/chat/MentionDropdown";
import { MessageRenderer } from "./components/chat/MessageRenderer";
import { HeaderButton } from "./components/ui/HeaderButton";

// Service imports
import { NoteMentionService } from "./services/mention-service";
import { AcpClient } from "./services/acp-client";

// Utility imports
import { Logger } from "./utils/logger";

// Type imports
import type { ChatMessage, MessageContent } from "./types/acp-types";

// Utility imports
import {
	detectMention,
	replaceMention,
	convertMentionsToPath,
	type MentionContext,
} from "./utils/mention-utils";

// Type definitions for Obsidian internal APIs
interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
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

function ChatComponent({
	plugin,
	view,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
}) {
	// Create logger instance
	const logger = useMemo(() => new Logger(plugin), [plugin]);

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
	const [errorInfo, setErrorInfo] = useState<{
		title: string;
		message: string;
		suggestion?: string;
	} | null>(null);
	const [currentAgentId, setCurrentAgentId] = useState<string>(
		settings.activeAgentId || settings.claude.id,
	);
	const [lastActiveNote, setLastActiveNote] = useState<TFile | null>(null);

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

	// Auto-scroll functions
	const checkIfAtBottom = () => {
		const container = messagesContainerRef.current;
		if (!container) return true;

		const threshold = 50;
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
		logger.log("[DEBUG] updateMentionSuggestions called with:", context);

		if (!context) {
			logger.log("[DEBUG] No context, hiding dropdown");
			setShowMentionDropdown(false);
			setMentionSuggestions([]);
			setMentionContext(null);
			return;
		}

		logger.log("[DEBUG] Searching notes with query:", context.query);
		const suggestions = noteMentionService.searchNotes(context.query);
		logger.log(
			"[DEBUG] Found suggestions:",
			suggestions.length,
			suggestions.map((f) => f.name),
		);

		setMentionSuggestions(suggestions);
		setMentionContext(context);
		setSelectedMentionIndex(0);

		if (suggestions.length > 0) {
			logger.log("[DEBUG] Showing dropdown");
			setShowMentionDropdown(true);
		} else {
			logger.log("[DEBUG] No suggestions, hiding dropdown");
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
		window.setTimeout(() => {
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
						content: message.content.map((content, index) => {
							// Type guard: check if both are tool_call type
							if (
								content.type === updatedContent.type &&
								updatedContent.type === "tool_call"
							) {
								// Both are guaranteed to be tool_call type
								return content.type === "tool_call" &&
									content.toolCallId ===
										updatedContent.toolCallId
									? updatedContent
									: content;
							}
							// For other types, just check type match
							return content.type === updatedContent.type
								? updatedContent
								: content;
						}),
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
					const existingContent =
						updatedMessage.content[existingContentIndex];
					// Type guard: we know it's text or agent_thought from findIndex condition
					if (
						existingContent.type === "text" ||
						existingContent.type === "agent_thought"
					) {
						updatedMessage.content[existingContentIndex] = {
							type: content.type,
							text:
								existingContent.text +
								(content.type === "agent_thought" ? "\n" : "") +
								content.text,
						};
					}
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

	const updateMessage = (
		toolCallId: string,
		updatedContent: MessageContent,
	) => {
		setMessages((prev) =>
			prev.map((message) => {
				// Search message includes tool_call
				const hasTargetToolCall = message.content.some(
					(content) =>
						content.type === "tool_call" &&
						content.toolCallId === toolCallId,
				);

				if (hasTargetToolCall) {
					return {
						...message,
						content: message.content.map((content) => {
							if (
								content.type === "tool_call" &&
								content.toolCallId === toolCallId
							) {
								// Type guard: both are tool_call type
								if (updatedContent.type === "tool_call") {
									// Merge content arrays
									let mergedContent = content.content || [];
									if (updatedContent.content !== undefined) {
										const newContent =
											updatedContent.content || [];

										// If new content contains diff, replace all old diffs
										const hasDiff = newContent.some(
											(item) => item.type === "diff",
										);
										if (hasDiff) {
											mergedContent =
												mergedContent.filter(
													(item) =>
														item.type !== "diff",
												);
										}

										mergedContent = [
											...mergedContent,
											...newContent,
										];
									}

									return {
										...content,
										...updatedContent,
										title:
											updatedContent.title !== undefined
												? updatedContent.title
												: content.title,
										kind:
											updatedContent.kind !== undefined
												? updatedContent.kind
												: content.kind,
										content: mergedContent,
									};
								}
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
			logger.log("[Debug] Starting connection setup...");

			// Check current platform
			if (!Platform.isDesktopApp) {
				throw new Error("Agent Client is only available on desktop");
			}

			// Get the Vault root path
			const vaultPath =
				(plugin.app.vault.adapter as VaultAdapterWithBasePath)
					.basePath || process.cwd();

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
				logger.error("[Error] No agents available to launch.");
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
				logger.error(
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

			logger.log(
				`[Debug] Active agent: ${activeAgent.label} (${activeAgent.id})`,
			);
			logger.log("[Debug] Command:", activeAgent.command);
			logger.log(
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

			// Add Node.js path to PATH if specified in settings
			if (settings.nodePath && settings.nodePath.trim().length > 0) {
				const nodeDir = resolveCommandDirectory(
					settings.nodePath.trim(),
				);
				if (nodeDir) {
					const separator = process.platform === "win32" ? ";" : ":";
					baseEnv.PATH = baseEnv.PATH
						? `${nodeDir}${separator}${baseEnv.PATH}`
						: nodeDir;
				}
			}

			// Get the Vault root path for agent process
			logger.log(
				"[Debug] Starting agent process in directory:",
				vaultPath,
			);

			// Use shell on Windows for .cmd/.bat files, optional on Unix systems
			const needsShell =
				process.platform === "win32" ||
				activeAgent.command.endsWith(".cmd") ||
				activeAgent.command.endsWith(".bat");

			const agentProcess = spawn(activeAgent.command, agentArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: baseEnv,
				cwd: vaultPath,
				shell: needsShell,
			});
			agentProcessRef.current = agentProcess;

			const agentLabel = `${activeAgent.label} (${activeAgent.id})`;

			agentProcess.on("spawn", () => {
				logger.log(
					`[Debug] ${agentLabel} process spawned successfully, PID:`,
					agentProcess.pid,
				);
			});

			agentProcess.on("error", (error) => {
				logger.error(`[Debug] ${agentLabel} process error:`, error);
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					logger.error(
						`[Error] Command not found: ${activeAgent.command || "(empty)"}`,
					);
					logger.error(
						`[Info] Check the command or update the correct path in settings for "${agentLabel}".`,
					);

					// Show error in UI
					setErrorInfo({
						title: "Command Not Found",
						message: `The command "${activeAgent.command || "(empty)"}" could not be found. Please check the path configuration for ${agentLabel}.`,
						suggestion: `1. Verify the agent path: On macOS/Linux, use "which ${activeAgent.command?.split("/").pop() || "command"}" to find the correct path. On Windows, use "where ${activeAgent.command?.split("\\").pop()?.split("/").pop() || "command"}". 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" on macOS/Linux or "where node" on Windows).`,
					});
				} else {
					// Show generic error in UI for other spawn errors
					setErrorInfo({
						title: "Agent Startup Error",
						message: `Failed to start ${agentLabel}: ${error.message}`,
						suggestion:
							"Please check the agent configuration in settings.",
					});
				}
			});

			agentProcess.on("exit", (code, signal) => {
				logger.log(
					`[Debug] ${agentLabel} process exited with code:`,
					code,
					"signal:",
					signal,
				);
				if (code === 127) {
					logger.error(
						`[Error] Command not found: ${activeAgent.command || "(empty)"}`,
					);
					logger.error(
						"[Info] Make sure the CLI is installed and the command path is correct.",
					);

					// Show error in UI for exit code 127 (command not found)
					setErrorInfo({
						title: "Command Not Found",
						message: `The command "${activeAgent.command || "(empty)"}" could not be found. Please check the path configuration for ${agentLabel}.`,
						suggestion: `1. Verify the agent path: On macOS/Linux, use "which ${activeAgent.command?.split("/").pop() || "command"}" to find the correct path. On Windows, use "where ${activeAgent.command?.split("\\").pop()?.split("/").pop() || "command"}". 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" on macOS/Linux or "where node" on Windows).`,
					});
				}
			});

			agentProcess.on("close", (code, signal) => {
				logger.log(
					`[Debug] ${agentLabel} process closed with code:`,
					code,
					"signal:",
					signal,
				);
			});

			agentProcess.stderr?.setEncoding("utf8");
			agentProcess.stderr?.on("data", (data) => {
				logger.log(`[Debug] ${agentLabel} stderr:`, data);
			});

			window.setTimeout(() => {
				if (
					agentProcess.exitCode === null &&
					agentProcess.killed === false
				) {
					logger.log("[Debug] Process still running after 2 seconds");
				} else {
					logger.log(
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

			logger.log("[Debug] Using vault path for AcpClient:", vaultPath);

			const client = new AcpClient(
				addMessage,
				updateLastMessage,
				updateMessage,
				vaultPath,
				plugin,
				settings.autoAllowPermissions,
			);
			acpClientRef.current = client;
			const stream = acp.ndJsonStream(input, output);
			const connection = new acp.ClientSideConnection(
				() => client,
				stream,
			);
			connectionRef.current = connection;

			try {
				logger.log("[Debug] Starting ACP initialization...");
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
				logger.log(
					`✅ Connected to agent (protocol v${initResult.protocolVersion})`,
				);
				logger.log(initResult.authMethods);

				logger.log("process.cwd():", process.cwd());
				logger.log("vaultPath:", vaultPath);
				logger.log("[Debug] Starting session creation...");
				const sessionResult = await connection.newSession({
					cwd: vaultPath,
					mcpServers: [],
				});
				logger.log(`📝 Created session: ${sessionResult.sessionId}`);

				setSessionId(sessionResult.sessionId);
				setAuthMethods(initResult.authMethods || []);
				setIsReady(true);
			} catch (error) {
				logger.error("[Client] Initialization Error:", error);
				logger.error("[Client] Error details:", error);
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
			window.setTimeout(() => {
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

		view.registerDomEvent(container, "scroll", handleScroll);

		// Initial check
		checkIfAtBottom();
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

	// Show auto-mention notes
	useEffect(() => {
		const current = plugin.app.workspace.getActiveFile();
		if (current) {
			setLastActiveNote(current);
		}

		const handleActiveLeafChange = () => {
			const newActive = plugin.app.workspace.getActiveFile();
			if (newActive) {
				setLastActiveNote(newActive);
			}
		};

		view.registerEvent(
			plugin.app.workspace.on(
				"active-leaf-change",
				handleActiveLeafChange,
			),
		);
	}, []);

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
			logger.log("✅ authenticate ok:", methodId);
			return true;
		} catch (error) {
			logger.error("[Client] Authentication Error:", error);
			return false;
		}
	};

	const createNewSession = async () => {
		if (!connectionRef.current) return;

		try {
			logger.log("[Debug] Creating new session...");
			// Get the Vault root path
			const vaultPath =
				(plugin.app.vault.adapter as VaultAdapterWithBasePath)
					.basePath || process.cwd();
			logger.log("[Debug] Using vault path as cwd:", vaultPath);

			const sessionResult = await connectionRef.current.newSession({
				cwd: vaultPath,
				mcpServers: [],
			});
			logger.log(`📝 Created new session: ${sessionResult.sessionId}`);

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
			logger.error("[Client] New Session Error:", error);
		}
	};

	const handleStopGeneration = async () => {
		if (!connectionRef.current || !sessionId) {
			logger.warn("Cannot cancel: no connection or session");
			setIsSending(false);
			return;
		}

		try {
			logger.log("Sending session/cancel notification...");

			// Send cancellation notification using the proper ACP method
			await connectionRef.current.cancel({
				sessionId: sessionId,
			});

			logger.log("Cancellation request sent successfully");

			// Cancel all running operations (permission requests + terminals)
			acpClientRef.current?.cancelAllOperations();

			// Mark permission requests as cancelled in UI
			markPermissionRequestsAsCancelled();

			// Update UI state immediately
			setIsSending(false);
		} catch (error) {
			logger.error("Failed to send cancellation:", error);

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

		// Add auto-mention
		let messageText = inputValue;
		if (settings.autoMentionActiveNote && lastActiveNote) {
			const autoMention = `@[${lastActiveNote.basename}]`;
			if (!inputValue.includes(autoMention)) {
				messageText = `${autoMention}\n${inputValue}`;
			}
		}

		// Add user message to chat (keep original text with @mentions for display)
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [{ type: "text", text: messageText }],
			timestamp: new Date(),
		};
		addMessage(userMessage);

		// Convert @mentions to relative paths for agent consumption
		const messageTextForAgent = convertMentionsToPath(
			messageText,
			noteMentionService,
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
				"",
		);
		setInputValue("");

		// Force scroll to bottom when user sends a message
		setIsAtBottom(true);
		window.setTimeout(() => {
			scrollToBottom();
		}, 0);

		// Reset current message for new assistant response
		acpClientRef.current?.resetCurrentMessage();

		try {
			logger.log(`\n✅ Sending Message...: ${messageTextForAgent}`);
			const promptResult = await connectionRef.current.prompt({
				sessionId: sessionId!,
				prompt: [
					{
						type: "text",
						text: messageTextForAgent,
					},
				],
			});
			logger.log(`\n✅ Agent completed with: ${promptResult.stopReason}`);

			setIsSending(false);
		} catch (error) {
			logger.error("[Client] Prompt Error:", error);
			setIsSending(false);

			if (!authMethods || authMethods.length === 0) {
				logger.error("No auth methods available");
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
						logger.log(
							`\n✅ Agent completed with: ${promptResult.stopReason}`,
						);
						setIsSending(false);
					} catch (retryError) {
						logger.error("[Client] Retry Error:", retryError);
						setIsSending(false);
					}
				}
			} else {
				// Show authentication error using the new error UI
				setErrorInfo({
					title: "Authentication Required",
					message:
						"Authentication failed. Please check if you are logged into the agent or if your API key is correctly set.",
					suggestion:
						"Check your agent configuration in settings and ensure API keys are valid.",
				});
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
			// Only send if send button would not be disabled (same condition as button)
			const buttonDisabled =
				!isSending && (inputValue.trim() === "" || !isReady);
			if (!buttonDisabled && !isSending) {
				handleSendMessage();
			}
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		const cursorPosition = e.target.selectionStart || 0;

		logger.log(
			"[DEBUG] Input changed:",
			newValue,
			"cursor:",
			cursorPosition,
		);

		setInputValue(newValue);

		// Check for mention detection
		const mentionDetected = detectMention(newValue, cursorPosition, plugin);
		logger.log("[DEBUG] Mention detected:", mentionDetected);
		updateMentionSuggestions(mentionDetected);
	};

	return (
		<div className="chat-view-container">
			<div className="chat-view-header">
				<h3 className="chat-view-header-title">{activeAgentLabel}</h3>
				<div className="chat-view-header-actions">
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
							const appWithSettings =
								plugin.app as unknown as AppWithSettings;
							appWithSettings.setting.open();
							appWithSettings.setting.openTabById(
								plugin.manifest.id,
							);
						}}
					/>
				</div>
			</div>

			<div ref={messagesContainerRef} className="chat-view-messages">
				{errorInfo ? (
					<div className="chat-error-container">
						<h4 className="chat-error-title">{errorInfo.title}</h4>
						<p className="chat-error-message">
							{errorInfo.message}
						</p>
						{errorInfo.suggestion && (
							<p className="chat-error-suggestion">
								💡 {errorInfo.suggestion}
							</p>
						)}
						<button
							onClick={() => setErrorInfo(null)}
							className="chat-error-button"
						>
							OK
						</button>
					</div>
				) : messages.length === 0 ? (
					<div className="chat-empty-state">
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

			<div className="chat-input-container">
				<div className="chat-input-wrapper">
					{/* Mention Dropdown - overlay positioned */}
					{(() => {
						logger.log("[DEBUG] Dropdown render check:", {
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
							plugin={plugin}
							view={view}
						/>
					)}
					{settings.autoMentionActiveNote && lastActiveNote && (
						<div className="auto-mention-inline">
							<span className="mention-badge">
								@{lastActiveNote.basename}
							</span>
						</div>
					)}
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyPress}
						placeholder={`Message ${activeAgentLabel} - @ to mention notes`}
						className={`chat-input-textarea ${settings.autoMentionActiveNote && lastActiveNote ? "has-auto-mention" : ""}`}
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
						className={`chat-send-button ${isSending ? "sending" : ""} ${!isSending && (inputValue.trim() === "" || !isReady) ? "disabled" : ""}`}
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

	getIcon() {
		return "bot-message-square";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatComponent plugin={this.plugin} view={this} />);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
