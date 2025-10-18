import { spawn, ChildProcess } from "child_process";
import * as acp from "@zed-industries/agent-client-protocol";
import { Platform } from "obsidian";

import type {
	IAgentClient,
	AgentConfig,
	InitializeResult,
	NewSessionResult,
	PermissionRequest,
} from "../ports/agent-client.port";
import type {
	ChatMessage,
	MessageContent,
} from "../domain/models/chat-message";
import type { AgentError } from "../domain/models/agent-error";
import { AcpClient } from "../services/acp-client";
import { Logger } from "../utils/logger";
import type AgentClientPlugin from "../main";

/**
 * Adapter that wraps the Agent Client Protocol (ACP) library.
 *
 * This adapter:
 * - Manages agent process lifecycle (spawn, monitor, kill)
 * - Wraps ACP connection and session management
 * - Integrates with existing AcpClient for message handling
 * - Provides callbacks for UI updates
 */
export class AcpAdapter implements IAgentClient {
	private connection: acp.ClientSideConnection | null = null;
	private agentProcess: ChildProcess | null = null;
	private acpClient: AcpClient | null = null;
	private logger: Logger;

	// Callback handlers
	private messageCallback: ((message: ChatMessage) => void) | null = null;
	private errorCallback: ((error: AgentError) => void) | null = null;
	private permissionCallback: ((request: PermissionRequest) => void) | null =
		null;

	// Configuration state
	private currentConfig: AgentConfig | null = null;
	private autoAllowPermissions = false;

	constructor(
		private plugin: AgentClientPlugin,
		private addMessage: (message: ChatMessage) => void,
		private updateLastMessage: (content: MessageContent) => void,
		private updateMessage: (
			toolCallId: string,
			content: MessageContent,
		) => boolean,
	) {
		this.logger = new Logger(plugin);
	}

	/**
	 * Initialize connection to an AI agent.
	 * Spawns the agent process and establishes ACP connection.
	 */
	async initialize(config: AgentConfig): Promise<InitializeResult> {
		this.logger.log(
			"[AcpAdapter] Starting initialization with config:",
			config,
		);

		this.currentConfig = config;

		// Update auto-allow permissions from plugin settings
		this.autoAllowPermissions = this.plugin.settings.autoAllowPermissions;

		// Validate command
		if (!config.command || config.command.trim().length === 0) {
			const error: AgentError = {
				id: crypto.randomUUID(),
				category: "configuration",
				severity: "error",
				title: "Command Not Configured",
				message: `Command not configured for agent "${config.displayName}" (${config.id}).`,
				suggestion: "Please configure the agent command in settings.",
				occurredAt: new Date(),
				agentId: config.id,
			};
			this.errorCallback?.(error);
			throw new Error(error.message);
		}

		const command = config.command.trim();
		const args = config.args.length > 0 ? [...config.args] : [];

		this.logger.log(
			`[AcpAdapter] Active agent: ${config.displayName} (${config.id})`,
		);
		this.logger.log("[AcpAdapter] Command:", command);
		this.logger.log(
			"[AcpAdapter] Args:",
			args.length > 0 ? args.join(" ") : "(none)",
		);

		// Prepare environment variables
		const baseEnv: NodeJS.ProcessEnv = {
			...process.env,
			...(config.env || {}),
		};

		// Add Node.js path to PATH if specified in settings
		if (
			this.plugin.settings.nodePath &&
			this.plugin.settings.nodePath.trim().length > 0
		) {
			const nodeDir = this.resolveCommandDirectory(
				this.plugin.settings.nodePath.trim(),
			);
			if (nodeDir) {
				const separator = Platform.isWin ? ";" : ":";
				baseEnv.PATH = baseEnv.PATH
					? `${nodeDir}${separator}${baseEnv.PATH}`
					: nodeDir;
			}
		}

		this.logger.log(
			"[AcpAdapter] Starting agent process in directory:",
			config.workingDirectory,
		);

		// Prepare command and args for spawning
		let spawnCommand = command;
		let spawnArgs = args;

		// On macOS and Linux, wrap the command in a login shell to inherit the user's environment
		// This ensures that PATH modifications in .zshrc/.bash_profile are available
		if (Platform.isMacOS || Platform.isLinux) {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const commandString = [command, ...args]
				.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
				.join(" ");
			spawnCommand = shell;
			spawnArgs = ["-l", "-c", commandString];
			this.logger.log(
				"[AcpAdapter] Using login shell:",
				shell,
				"with command:",
				commandString,
			);
		}

		// Use shell on Windows for .cmd/.bat files
		const needsShell = Platform.isWin;

		// Spawn the agent process
		const agentProcess = spawn(spawnCommand, spawnArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			env: baseEnv,
			cwd: config.workingDirectory,
			shell: needsShell,
		});
		this.agentProcess = agentProcess;

		const agentLabel = `${config.displayName} (${config.id})`;

		// Set up process event handlers
		agentProcess.on("spawn", () => {
			this.logger.log(
				`[AcpAdapter] ${agentLabel} process spawned successfully, PID:`,
				agentProcess.pid,
			);
		});

		agentProcess.on("error", (error) => {
			this.logger.error(
				`[AcpAdapter] ${agentLabel} process error:`,
				error,
			);

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "connection",
				severity: "error",
				occurredAt: new Date(),
				agentId: config.id,
				originalError: error,
				...this.getErrorInfo(error, command, agentLabel),
			};

			this.errorCallback?.(agentError);
		});

		agentProcess.on("exit", (code, signal) => {
			this.logger.log(
				`[AcpAdapter] ${agentLabel} process exited with code:`,
				code,
				"signal:",
				signal,
			);

			if (code === 127) {
				this.logger.error(`[AcpAdapter] Command not found: ${command}`);

				const error: AgentError = {
					id: crypto.randomUUID(),
					category: "configuration",
					severity: "error",
					title: "Command Not Found",
					message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
					suggestion: this.getCommandNotFoundSuggestion(command),
					occurredAt: new Date(),
					agentId: config.id,
					code: code,
				};

				this.errorCallback?.(error);
			}
		});

		agentProcess.on("close", (code, signal) => {
			this.logger.log(
				`[AcpAdapter] ${agentLabel} process closed with code:`,
				code,
				"signal:",
				signal,
			);
		});

		agentProcess.stderr?.setEncoding("utf8");
		agentProcess.stderr?.on("data", (data) => {
			this.logger.log(`[AcpAdapter] ${agentLabel} stderr:`, data);
		});

		// Create stream for ACP communication
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

		this.logger.log(
			"[AcpAdapter] Using working directory for AcpClient:",
			config.workingDirectory,
		);

		// Create ACP client wrapper
		this.acpClient = new AcpClient(
			this.addMessage,
			this.updateLastMessage,
			this.updateMessage,
			config.workingDirectory,
			this.plugin,
			this.autoAllowPermissions,
		);

		const stream = acp.ndJsonStream(input, output);
		this.connection = new acp.ClientSideConnection(
			() => this.acpClient!,
			stream,
		);

		try {
			this.logger.log("[AcpAdapter] Starting ACP initialization...");

			const initResult = await this.connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {
					fs: {
						readTextFile: false,
						writeTextFile: false,
					},
					terminal: true,
				},
			});

			this.logger.log(
				`[AcpAdapter] ✅ Connected to agent (protocol v${initResult.protocolVersion})`,
			);
			this.logger.log(
				"[AcpAdapter] Auth methods:",
				initResult.authMethods,
			);

			return {
				protocolVersion: initResult.protocolVersion,
				authMethods: initResult.authMethods || [],
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] Initialization Error:", error);

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "connection",
				severity: "error",
				title: "Initialization Failed",
				message: `Failed to initialize connection to ${agentLabel}: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
				occurredAt: new Date(),
				agentId: config.id,
				originalError: error,
			};

			this.errorCallback?.(agentError);
			throw error;
		}
	}

	/**
	 * Create a new chat session with the agent.
	 */
	async newSession(workingDirectory: string): Promise<NewSessionResult> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		try {
			this.logger.log("[AcpAdapter] Creating new session...");
			this.logger.log(
				"[AcpAdapter] Using working directory:",
				workingDirectory,
			);

			const sessionResult = await this.connection.newSession({
				cwd: workingDirectory,
				mcpServers: [],
			});

			this.logger.log(
				`[AcpAdapter] 📝 Created session: ${sessionResult.sessionId}`,
			);

			return {
				sessionId: sessionResult.sessionId,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] New Session Error:", error);

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "connection",
				severity: "error",
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please try disconnecting and reconnecting to the agent.",
				occurredAt: new Date(),
				agentId: this.currentConfig?.id,
				originalError: error,
			};

			this.errorCallback?.(agentError);
			throw error;
		}
	}

	/**
	 * Authenticate with the agent using a specific method.
	 */
	async authenticate(methodId: string): Promise<boolean> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		try {
			await this.connection.authenticate({ methodId });
			this.logger.log("[AcpAdapter] ✅ authenticate ok:", methodId);
			return true;
		} catch (error) {
			this.logger.error("[AcpAdapter] Authentication Error:", error);

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "authentication",
				severity: "error",
				title: "Authentication Failed",
				message: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check your API key or authentication credentials in settings.",
				occurredAt: new Date(),
				agentId: this.currentConfig?.id,
				originalError: error,
			};

			this.errorCallback?.(agentError);
			return false;
		}
	}

	/**
	 * Send a message to the agent in a specific session.
	 */
	async sendMessage(sessionId: string, message: string): Promise<void> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		// Reset current message for new assistant response
		this.acpClient?.resetCurrentMessage();

		try {
			this.logger.log(`[AcpAdapter] ✅ Sending Message...: ${message}`);

			const promptResult = await this.connection.prompt({
				sessionId: sessionId,
				prompt: [
					{
						type: "text",
						text: message,
					},
				],
			});

			this.logger.log(
				`[AcpAdapter] ✅ Agent completed with: ${promptResult.stopReason}`,
			);
		} catch (error) {
			this.logger.error("[AcpAdapter] Prompt Error:", error);

			// Check if this is an "empty response text" error - if so, silently ignore it
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === -32603 &&
				"data" in error
			) {
				const errorData = error.data;
				if (
					errorData &&
					typeof errorData === "object" &&
					"details" in errorData &&
					typeof errorData.details === "string" &&
					errorData.details.includes("empty response text")
				) {
					this.logger.log(
						"[AcpAdapter] Empty response text error - ignoring",
					);
					return;
				}
			}

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "communication",
				severity: "error",
				title: "Message Send Failed",
				message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
				suggestion: "Please check your connection and try again.",
				occurredAt: new Date(),
				agentId: this.currentConfig?.id,
				sessionId: sessionId,
				originalError: error,
			};

			this.errorCallback?.(agentError);
			throw error;
		}
	}

	/**
	 * Cancel the current operation in a session.
	 */
	async cancel(sessionId: string): Promise<void> {
		if (!this.connection) {
			this.logger.warn("[AcpAdapter] Cannot cancel: no connection");
			return;
		}

		try {
			this.logger.log(
				"[AcpAdapter] Sending session/cancel notification...",
			);

			await this.connection.cancel({
				sessionId: sessionId,
			});

			this.logger.log(
				"[AcpAdapter] Cancellation request sent successfully",
			);

			// Cancel all running operations (permission requests + terminals)
			this.acpClient?.cancelAllOperations();
		} catch (error) {
			this.logger.error(
				"[AcpAdapter] Failed to send cancellation:",
				error,
			);

			// Still cancel all operations even if network cancellation failed
			this.acpClient?.cancelAllOperations();
		}
	}

	/**
	 * Disconnect from the agent and clean up resources.
	 */
	async disconnect(): Promise<void> {
		this.logger.log("[AcpAdapter] Disconnecting...");

		// Cancel all pending operations
		this.acpClient?.cancelAllOperations();

		// Kill the agent process
		if (this.agentProcess) {
			this.logger.log("[AcpAdapter] Killing agent process...");
			this.agentProcess.kill();
			this.agentProcess = null;
		}

		// Clear connection and client references
		this.connection = null;
		this.acpClient = null;
		this.currentConfig = null;

		this.logger.log("[AcpAdapter] Disconnected");
	}

	/**
	 * Register a callback to receive chat messages from the agent.
	 */
	onMessage(callback: (message: ChatMessage) => void): void {
		this.messageCallback = callback;
	}

	/**
	 * Register a callback to receive error notifications.
	 */
	onError(callback: (error: AgentError) => void): void {
		this.errorCallback = callback;
	}

	/**
	 * Register a callback to receive permission requests from the agent.
	 */
	onPermissionRequest(callback: (request: PermissionRequest) => void): void {
		this.permissionCallback = callback;
	}

	/**
	 * Respond to a permission request from the agent.
	 */
	async respondToPermission(
		requestId: string,
		optionId: string,
	): Promise<void> {
		if (!this.acpClient) {
			throw new Error(
				"ACP client not initialized. Call initialize() first.",
			);
		}

		this.logger.log(
			"[AcpAdapter] Responding to permission request:",
			requestId,
			"with option:",
			optionId,
		);
		this.acpClient.handlePermissionResponse(requestId, optionId);
	}

	// Helper methods

	/**
	 * Resolve the directory containing a command (for PATH adjustments).
	 */
	private resolveCommandDirectory(command: string): string | null {
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
	}

	/**
	 * Get error information for process spawn errors.
	 */
	private getErrorInfo(
		error: Error,
		command: string,
		agentLabel: string,
	): { title: string; message: string; suggestion: string } {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				title: "Command Not Found",
				message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
				suggestion: this.getCommandNotFoundSuggestion(command),
			};
		}

		return {
			title: "Agent Startup Error",
			message: `Failed to start ${agentLabel}: ${error.message}`,
			suggestion: "Please check the agent configuration in settings.",
		};
	}

	/**
	 * Get platform-specific suggestions for command not found errors.
	 */
	private getCommandNotFoundSuggestion(command: string): string {
		const commandName =
			command.split("/").pop()?.split("\\").pop() || "command";

		if (Platform.isWin) {
			return `1. Verify the agent path: Use "where ${commandName}" in Command Prompt to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "where node" to find it).`;
		} else {
			return `1. Verify the agent path: Use "which ${commandName}" in Terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
		}
	}
}
