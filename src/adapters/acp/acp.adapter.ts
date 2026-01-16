import { spawn, ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type {
	IAgentClient,
	AgentConfig,
	InitializeResult,
	NewSessionResult,
} from "../../domain/ports/agent-client.port";
import type {
	MessageContent,
	PermissionOption,
} from "../../domain/models/chat-message";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { PromptContent } from "../../domain/models/prompt-content";
import type { AgentError } from "../../domain/models/agent-error";
import type {
	ListSessionsResult,
	LoadSessionResult,
	ResumeSessionResult,
	ForkSessionResult,
} from "../../domain/models/session-info";
import { AcpTypeConverter } from "./acp-type-converter";
import { TerminalManager } from "../../shared/terminal-manager";
import { Logger } from "../../shared/logger";
import type AgentClientPlugin from "../../plugin";
import type {
	SlashCommand,
	SessionModeState,
	SessionModelState,
} from "src/domain/models/chat-session";
import {
	wrapCommandForWsl,
	convertWindowsPathToWsl,
} from "../../shared/wsl-utils";
import { resolveCommandDirectory } from "../../shared/path-utils";
import { getEnhancedWindowsEnv } from "../../shared/windows-env";
import { escapeShellArgWindows } from "../../shared/shell-utils";

/**
 * Extended ACP Client interface for UI layer.
 *
 * Provides ACP-specific operations needed by UI components
 * (terminal rendering, permission handling, etc.) that are not
 * part of the domain-level IAgentClient interface.
 *
 * This interface extends the base ACP Client from the protocol library
 * with plugin-specific methods for:
 * - Permission response handling
 * - Operation cancellation
 * - Message state management
 * - Terminal I/O operations
 */
export interface IAcpClient extends acp.Client {
	handlePermissionResponse(requestId: string, optionId: string): void;
	cancelAllOperations(): void;
	resetCurrentMessage(): void;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
}

/**
 * Adapter that wraps the Agent Client Protocol (ACP) library.
 *
 * This adapter:
 * - Manages agent process lifecycle (spawn, monitor, kill)
 * - Implements ACP protocol directly (no intermediate AcpClient layer)
 * - Handles message updates and terminal operations
 * - Provides callbacks for UI updates
 */
export class AcpAdapter implements IAgentClient, IAcpClient {
	private connection: acp.ClientSideConnection | null = null;
	private agentProcess: ChildProcess | null = null;
	private logger: Logger;

	// Session update callback (unified callback for all session updates)
	private sessionUpdateCallback: ((update: SessionUpdate) => void) | null =
		null;

	// Error callback for process-level errors
	private errorCallback: ((error: AgentError) => void) | null = null;

	// Message update callback for permission UI updates
	private updateMessage: (
		toolCallId: string,
		content: MessageContent,
	) => void;

	// Configuration state
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;
	private autoAllowPermissions = false;

	// IAcpClient implementation properties
	private terminalManager: TerminalManager;
	private currentMessageId: string | null = null;
	private pendingPermissionRequests = new Map<
		string,
		{
			resolve: (response: acp.RequestPermissionResponse) => void;
			toolCallId: string;
			options: PermissionOption[];
		}
	>();
	private pendingPermissionQueue: Array<{
		requestId: string;
		toolCallId: string;
		options: PermissionOption[];
	}> = [];

	constructor(private plugin: AgentClientPlugin) {
		this.logger = new Logger(plugin);
		// Initialize with no-op callback
		this.updateMessage = () => {};

		// Initialize TerminalManager
		this.terminalManager = new TerminalManager(plugin);
	}

	/**
	 * Set the update message callback for permission UI updates.
	 *
	 * This callback is used to update tool call messages when permission
	 * requests are responded to or cancelled.
	 *
	 * @param updateMessage - Callback to update a specific message by toolCallId
	 */
	setUpdateMessageCallback(
		updateMessage: (toolCallId: string, content: MessageContent) => void,
	): void {
		this.updateMessage = updateMessage;
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
		this.logger.log(
			`[AcpAdapter] Current state - process: ${!!this.agentProcess}, PID: ${this.agentProcess?.pid}`,
		);

		// Clean up existing process if any (e.g., when switching agents)
		if (this.agentProcess) {
			this.logger.log(
				`[AcpAdapter] Killing existing process (PID: ${this.agentProcess.pid})`,
			);
			this.agentProcess.kill();
			this.agentProcess = null;
		}

		// Clean up existing connection
		if (this.connection) {
			this.logger.log("[AcpAdapter] Cleaning up existing connection");
			this.connection = null;
		}

		this.currentConfig = config;

		// Update auto-allow permissions from plugin settings
		this.autoAllowPermissions = this.plugin.settings.autoAllowPermissions;

		// Validate command
		if (!config.command || config.command.trim().length === 0) {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id}). Please configure the agent command in settings.`,
			);
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
		let baseEnv: NodeJS.ProcessEnv = {
			...process.env,
			...(config.env || {}),
		};

		// On Windows, enhance PATH with full system/user PATH from registry.
		// Electron apps launched from shortcuts don't inherit the full PATH,
		// which causes executables like python, node, etc. to not be found.
		if (Platform.isWin && !this.plugin.settings.windowsWslMode) {
			baseEnv = getEnhancedWindowsEnv(baseEnv);
		}

		// Add Node.js path to PATH if specified in settings
		if (
			this.plugin.settings.nodePath &&
			this.plugin.settings.nodePath.trim().length > 0
		) {
			const nodeDir = resolveCommandDirectory(
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

		// WSL mode for Windows (wrap command to run inside WSL)
		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			// Extract node directory from settings for PATH
			const nodeDir = this.plugin.settings.nodePath
				? resolveCommandDirectory(
						this.plugin.settings.nodePath.trim(),
					) || undefined
				: undefined;

			const wslWrapped = wrapCommandForWsl(
				command,
				args,
				config.workingDirectory,
				this.plugin.settings.windowsWslDistribution,
				nodeDir,
			);
			spawnCommand = wslWrapped.command;
			spawnArgs = wslWrapped.args;
			this.logger.log(
				"[AcpAdapter] Using WSL mode:",
				this.plugin.settings.windowsWslDistribution || "default",
				"with command:",
				spawnCommand,
				spawnArgs,
			);
		}
		// On macOS and Linux, wrap the command in a login shell to inherit the user's environment
		// This ensures that PATH modifications in .zshrc/.bash_profile are available
		else if (Platform.isMacOS || Platform.isLinux) {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const commandString = [command, ...args]
				.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
				.join(" ");

			// If nodePath is configured, prepend PATH export to ensure node is available.
			// This is necessary because:
			// 1. Login shells (-l) re-initialize PATH from shell config files, overwriting env.PATH
			// 2. Even when the agent command uses an absolute path, scripts with shebang
			//    "#!/usr/bin/env node" require node to be in PATH for the env command to find it
			// Therefore, we must explicitly set PATH inside the shell command
			let fullCommand = commandString;
			if (
				this.plugin.settings.nodePath &&
				this.plugin.settings.nodePath.trim().length > 0
			) {
				const nodeDir = resolveCommandDirectory(
					this.plugin.settings.nodePath.trim(),
				);
				if (nodeDir) {
					// Escape single quotes in nodeDir for shell safety
					const escapedNodeDir = nodeDir.replace(/'/g, "'\\''");
					fullCommand = `export PATH='${escapedNodeDir}':"$PATH"; ${commandString}`;
				}
			}

			spawnCommand = shell;
			spawnArgs = ["-l", "-c", fullCommand];
			this.logger.log(
				"[AcpAdapter] Using login shell:",
				shell,
				"with command:",
				fullCommand,
			);
		}
		// On Windows (non-WSL), escape command and arguments for cmd.exe
		// spawn() will be called with shell: true below
		else if (Platform.isWin) {
			spawnCommand = escapeShellArgWindows(command);
			spawnArgs = args.map(escapeShellArgWindows);
			this.logger.log(
				"[AcpAdapter] Using Windows shell with command:",
				spawnCommand,
				spawnArgs,
			);
		}

		// Use shell on Windows for proper argument handling, but NOT in WSL mode
		// When using WSL, wsl.exe is the command and doesn't need shell wrapper
		const needsShell =
			Platform.isWin && !this.plugin.settings.windowsWslMode;

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

				const agentError: AgentError = {
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

				this.errorCallback?.(agentError);
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
		// stdio is configured as ["pipe", "pipe", "pipe"] so stdin/stdout are guaranteed to exist
		if (!agentProcess.stdin || !agentProcess.stdout) {
			throw new Error("Agent process stdin/stdout not available");
		}

		const stdin = agentProcess.stdin;
		const stdout = agentProcess.stdout;

		const input = new WritableStream<Uint8Array>({
			write(chunk: Uint8Array) {
				stdin.write(chunk);
			},
			close() {
				stdin.end();
			},
		});
		const output = new ReadableStream<Uint8Array>({
			start(controller) {
				stdout.on("data", (chunk: Uint8Array) => {
					controller.enqueue(chunk);
				});
				stdout.on("end", () => {
					controller.close();
				});
			},
		});

		this.logger.log(
			"[AcpAdapter] Using working directory:",
			config.workingDirectory,
		);

		const stream = acp.ndJsonStream(input, output);
		this.connection = new acp.ClientSideConnection(() => this, stream);

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
				clientInfo: {
					name: "obsidian-agent-client",
					title: "Agent Client for Obsidian",
					version: this.plugin.manifest.version,
				},
			});

			this.logger.log(
				`[AcpAdapter] ✅ Connected to agent (protocol v${initResult.protocolVersion})`,
			);
			this.logger.log(
				"[AcpAdapter] Auth methods:",
				initResult.authMethods,
			);
			this.logger.log(
				"[AcpAdapter] Agent capabilities:",
				initResult.agentCapabilities,
			);

			// Mark as initialized and store agent ID
			this.isInitializedFlag = true;
			this.currentAgentId = config.id;

			// Extract capabilities from agent capabilities
			const promptCaps = initResult.agentCapabilities?.promptCapabilities;
			const mcpCaps = initResult.agentCapabilities?.mcpCapabilities;
			const sessionCaps =
				initResult.agentCapabilities?.sessionCapabilities;

			return {
				protocolVersion: initResult.protocolVersion,
				authMethods: initResult.authMethods || [],
				// Convenience accessor for prompt capabilities
				promptCapabilities: {
					image: promptCaps?.image ?? false,
					audio: promptCaps?.audio ?? false,
					embeddedContext: promptCaps?.embeddedContext ?? false,
				},
				// Full agent capabilities
				agentCapabilities: {
					loadSession:
						initResult.agentCapabilities?.loadSession ?? false,
					// Session capabilities (unstable features)
					sessionCapabilities: sessionCaps
						? {
								resume: sessionCaps.resume ?? undefined,
								fork: sessionCaps.fork ?? undefined,
								list: sessionCaps.list ?? undefined,
							}
						: undefined,
					mcpCapabilities: mcpCaps
						? {
								http: mcpCaps.http ?? false,
								sse: mcpCaps.sse ?? false,
							}
						: undefined,
					promptCapabilities: {
						image: promptCaps?.image ?? false,
						audio: promptCaps?.audio ?? false,
						embeddedContext: promptCaps?.embeddedContext ?? false,
					},
				},
				// Agent implementation info
				agentInfo: initResult.agentInfo
					? {
							name: initResult.agentInfo.name,
							title: initResult.agentInfo.title ?? undefined,
							version: initResult.agentInfo.version ?? undefined,
						}
					: undefined,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] Initialization Error:", error);

			// Reset flags on failure
			this.isInitializedFlag = false;
			this.currentAgentId = null;

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

			// Convert Windows path to WSL path if in WSL mode
			let sessionCwd = workingDirectory;
			if (Platform.isWin && this.plugin.settings.windowsWslMode) {
				sessionCwd = convertWindowsPathToWsl(workingDirectory);
			}

			this.logger.log(
				"[AcpAdapter] Using working directory:",
				sessionCwd,
			);

			const sessionResult = await this.connection.newSession({
				cwd: sessionCwd,
				mcpServers: [],
			});

			this.logger.log(
				`[AcpAdapter] 📝 Created session: ${sessionResult.sessionId}`,
			);
			this.logger.log(
				"[AcpAdapter] NewSessionResponse:",
				JSON.stringify(sessionResult, null, 2),
			);

			// Convert modes from ACP format to domain format
			let modes: SessionModeState | undefined;
			if (sessionResult.modes) {
				modes = {
					availableModes: sessionResult.modes.availableModes.map(
						(m) => ({
							id: m.id,
							name: m.name,
							// Convert null to undefined for type compatibility
							description: m.description ?? undefined,
						}),
					),
					currentModeId: sessionResult.modes.currentModeId,
				};
				this.logger.log(
					`[AcpAdapter] Session modes: ${modes.availableModes.map((m) => m.id).join(", ")} (current: ${modes.currentModeId})`,
				);
			}

			// Convert models from ACP format to domain format (experimental)
			let models: SessionModelState | undefined;
			if (sessionResult.models) {
				models = {
					availableModels: sessionResult.models.availableModels.map(
						(m) => ({
							modelId: m.modelId,
							name: m.name,
							// Convert null to undefined for type compatibility
							description: m.description ?? undefined,
						}),
					),
					currentModelId: sessionResult.models.currentModelId,
				};
				this.logger.log(
					`[AcpAdapter] Session models: ${models.availableModels.map((m) => m.modelId).join(", ")} (current: ${models.currentModelId})`,
				);
			}

			return {
				sessionId: sessionResult.sessionId,
				modes,
				models,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] New Session Error:", error);

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
		} catch (error: unknown) {
			this.logger.error("[AcpAdapter] Authentication Error:", error);
			return false;
		}
	}

	/**
	 * Send a message to the agent in a specific session.
	 */
	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		// Reset current message for new assistant response
		this.resetCurrentMessage();

		try {
			// Convert domain PromptContent to ACP ContentBlock
			const acpContent = content.map((c) =>
				AcpTypeConverter.toAcpContentBlock(c),
			);

			this.logger.log(
				`[AcpAdapter] Sending prompt with ${content.length} content blocks`,
			);

			const promptResult = await this.connection.prompt({
				sessionId: sessionId,
				prompt: acpContent,
			});

			this.logger.log(
				`[AcpAdapter] Agent completed with: ${promptResult.stopReason}`,
			);
		} catch (error: unknown) {
			this.logger.error("[AcpAdapter] Prompt Error:", error);

			// Check if this is an ignorable error (empty response or user abort)
			const errorObj = error as Record<string, unknown> | null;
			if (
				errorObj &&
				typeof errorObj === "object" &&
				"code" in errorObj &&
				errorObj.code === -32603 &&
				"data" in errorObj
			) {
				const errorData = errorObj.data as Record<
					string,
					unknown
				> | null;
				if (
					errorData &&
					typeof errorData === "object" &&
					"details" in errorData &&
					typeof errorData.details === "string"
				) {
					// Ignore "empty response text" errors
					if (errorData.details.includes("empty response text")) {
						this.logger.log(
							"[AcpAdapter] Empty response text error - ignoring",
						);
						return;
					}
					// Ignore "user aborted" errors (from cancel operation)
					if (errorData.details.includes("user aborted")) {
						this.logger.log(
							"[AcpAdapter] User aborted request - ignoring",
						);
						return;
					}
				}
			}

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
			this.cancelAllOperations();
		} catch (error) {
			this.logger.error(
				"[AcpAdapter] Failed to send cancellation:",
				error,
			);

			// Still cancel all operations even if network cancellation failed
			this.cancelAllOperations();
		}
	}

	/**
	 * Disconnect from the agent and clean up resources.
	 */
	disconnect(): Promise<void> {
		this.logger.log("[AcpAdapter] Disconnecting...");

		// Cancel all pending operations
		this.cancelAllOperations();

		// Kill the agent process
		if (this.agentProcess) {
			this.logger.log(
				`[AcpAdapter] Killing agent process (PID: ${this.agentProcess.pid})`,
			);
			this.agentProcess.kill();
			this.agentProcess = null;
		}

		// Clear connection and config references
		this.connection = null;
		this.currentConfig = null;

		// Reset initialization state
		this.isInitializedFlag = false;
		this.currentAgentId = null;

		this.logger.log("[AcpAdapter] Disconnected");
		return Promise.resolve();
	}

	/**
	 * Check if the agent connection is initialized and ready.
	 *
	 * Implementation of IAgentClient.isInitialized()
	 */
	isInitialized(): boolean {
		return (
			this.isInitializedFlag &&
			this.connection !== null &&
			this.agentProcess !== null
		);
	}

	/**
	 * Get the ID of the currently connected agent.
	 *
	 * Implementation of IAgentClient.getCurrentAgentId()
	 */
	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	/**
	 * Set the session mode.
	 *
	 * Changes the agent's operating mode for the current session.
	 * The agent will confirm the mode change via a current_mode_update notification.
	 *
	 * Implementation of IAgentClient.setSessionMode()
	 */
	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		this.logger.log(
			`[AcpAdapter] Setting session mode to: ${modeId} for session: ${sessionId}`,
		);

		try {
			await this.connection.setSessionMode({
				sessionId,
				modeId,
			});
			this.logger.log(`[AcpAdapter] Session mode set to: ${modeId}`);
		} catch (error) {
			this.logger.error(
				"[AcpAdapter] Failed to set session mode:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Implementation of IAgentClient.setSessionModel()
	 */
	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}

		this.logger.log(
			`[AcpAdapter] Setting session model to: ${modelId} for session: ${sessionId}`,
		);

		try {
			await this.connection.unstable_setSessionModel({
				sessionId,
				modelId,
			});
			this.logger.log(`[AcpAdapter] Session model set to: ${modelId}`);
		} catch (error) {
			this.logger.error(
				"[AcpAdapter] Failed to set session model:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Register a callback to receive session updates from the agent.
	 *
	 * This unified callback receives all session update events:
	 * - agent_message_chunk: Text chunk from agent's response
	 * - agent_thought_chunk: Text chunk from agent's reasoning
	 * - tool_call: New tool call event
	 * - tool_call_update: Update to existing tool call
	 * - plan: Agent's task plan
	 * - available_commands_update: Slash commands changed
	 * - current_mode_update: Mode changed
	 */
	onSessionUpdate(callback: (update: SessionUpdate) => void): void {
		this.sessionUpdateCallback = callback;
	}

	/**
	 * Register callback for error notifications.
	 *
	 * Called when errors occur during agent operations that cannot be
	 * propagated via exceptions (e.g., process spawn errors, exit code 127).
	 */
	onError(callback: (error: AgentError) => void): void {
		this.errorCallback = callback;
	}

	/**
	 * Respond to a permission request from the agent.
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void> {
		if (!this.connection) {
			throw new Error(
				"ACP connection not initialized. Call initialize() first.",
			);
		}

		this.logger.log(
			"[AcpAdapter] Responding to permission request:",
			requestId,
			"with option:",
			optionId,
		);
		this.handlePermissionResponse(requestId, optionId);
		return Promise.resolve();
	}

	// Helper methods

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

	// ========================================================================
	// IAcpClient Implementation
	// ========================================================================

	/**
	 * Handle session updates from the ACP protocol.
	 * This is called by ClientSideConnection when the agent sends updates.
	 */
	sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		const sessionId = params.sessionId;
		this.logger.log("[AcpAdapter] sessionUpdate:", { sessionId, update });

		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				if (update.content.type === "text") {
					this.sessionUpdateCallback?.({
						type: "agent_message_chunk",
						sessionId,
						text: update.content.text,
					});
				}
				break;

			case "agent_thought_chunk":
				if (update.content.type === "text") {
					this.sessionUpdateCallback?.({
						type: "agent_thought_chunk",
						sessionId,
						text: update.content.text,
					});
				}
				break;

			case "user_message_chunk":
				// Used for session/load to reconstruct user messages
				if (update.content.type === "text") {
					this.sessionUpdateCallback?.({
						type: "user_message_chunk",
						sessionId,
						text: update.content.text,
					});
				}
				// Note: image, resource etc. ContentBlock types are not yet supported
				break;

			case "tool_call":
			case "tool_call_update": {
				this.sessionUpdateCallback?.({
					type: update.sessionUpdate,
					sessionId,
					toolCallId: update.toolCallId,
					title: update.title ?? undefined,
					status: update.status || "pending",
					kind: update.kind ?? undefined,
					content: AcpTypeConverter.toToolCallContent(update.content),
					locations: update.locations ?? undefined,
				});
				break;
			}

			case "plan":
				this.sessionUpdateCallback?.({
					type: "plan",
					sessionId,
					entries: update.entries,
				});
				break;

			case "available_commands_update": {
				this.logger.log(
					`[AcpAdapter] available_commands_update, commands:`,
					update.availableCommands,
				);

				const commands: SlashCommand[] = (
					update.availableCommands || []
				).map((cmd) => ({
					name: cmd.name,
					description: cmd.description,
					hint: cmd.input?.hint ?? null,
				}));

				this.sessionUpdateCallback?.({
					type: "available_commands_update",
					sessionId,
					commands,
				});
				break;
			}

			case "current_mode_update": {
				this.logger.log(
					`[AcpAdapter] current_mode_update: ${update.currentModeId}`,
				);

				this.sessionUpdateCallback?.({
					type: "current_mode_update",
					sessionId,
					currentModeId: update.currentModeId,
				});
				break;
			}
		}
		return Promise.resolve();
	}

	/**
	 * Reset the current message ID.
	 */
	resetCurrentMessage(): void {
		this.currentMessageId = null;
	}

	/**
	 * Handle permission response from user.
	 */
	handlePermissionResponse(requestId: string, optionId: string): void {
		const request = this.pendingPermissionRequests.get(requestId);
		if (!request) {
			return;
		}

		const { resolve, toolCallId, options } = request;

		// Reflect the selection in the UI immediately
		this.updateMessage(toolCallId, {
			type: "tool_call",
			toolCallId,
			permissionRequest: {
				requestId,
				options,
				selectedOptionId: optionId,
				isActive: false,
			},
		} as MessageContent);

		resolve({
			outcome: {
				outcome: "selected",
				optionId,
			},
		});
		this.pendingPermissionRequests.delete(requestId);
		this.pendingPermissionQueue = this.pendingPermissionQueue.filter(
			(entry) => entry.requestId !== requestId,
		);
		this.activateNextPermission();
	}

	/**
	 * Cancel all ongoing operations.
	 */
	cancelAllOperations(): void {
		// Cancel pending permission requests
		this.cancelPendingPermissionRequests();

		// Kill all running terminals
		this.terminalManager.killAllTerminals();
	}

	private activateNextPermission(): void {
		if (this.pendingPermissionQueue.length === 0) {
			return;
		}

		const next = this.pendingPermissionQueue[0];
		const pending = this.pendingPermissionRequests.get(next.requestId);
		if (!pending) {
			return;
		}

		this.updateMessage(next.toolCallId, {
			type: "tool_call",
			toolCallId: next.toolCallId,
			permissionRequest: {
				requestId: next.requestId,
				options: pending.options,
				isActive: true,
			},
		} as MessageContent);
	}

	/**
	 * Request permission from user for an operation.
	 */
	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		this.logger.log("[AcpAdapter] Permission request received:", params);

		// If auto-allow is enabled, automatically approve the first allow option
		if (this.autoAllowPermissions) {
			const allowOption =
				params.options.find(
					(option) =>
						option.kind === "allow_once" ||
						option.kind === "allow_always" ||
						(!option.kind &&
							option.name.toLowerCase().includes("allow")),
				) || params.options[0]; // fallback to first option

			this.logger.log(
				"[AcpAdapter] Auto-allowing permission request:",
				allowOption,
			);

			return Promise.resolve({
				outcome: {
					outcome: "selected",
					optionId: allowOption.optionId,
				},
			});
		}

		// Generate unique ID for this permission request
		const requestId = crypto.randomUUID();
		const toolCallId = params.toolCall?.toolCallId || crypto.randomUUID();
		const sessionId = params.sessionId;

		const normalizedOptions: PermissionOption[] = params.options.map(
			(option) => {
				const normalizedKind =
					option.kind === "reject_always"
						? "reject_once"
						: option.kind;
				const kind: PermissionOption["kind"] = normalizedKind
					? normalizedKind
					: option.name.toLowerCase().includes("allow")
						? "allow_once"
						: "reject_once";

				return {
					optionId: option.optionId,
					name: option.name,
					kind,
				};
			},
		);

		const isFirstRequest = this.pendingPermissionQueue.length === 0;

		// Prepare permission request data
		const permissionRequestData = {
			requestId: requestId,
			options: normalizedOptions,
			isActive: isFirstRequest,
		};

		this.pendingPermissionQueue.push({
			requestId,
			toolCallId,
			options: normalizedOptions,
		});

		// Emit tool_call with permission request via session update callback
		// If tool_call exists, it will be updated; otherwise, a new one will be created
		const toolCallInfo = params.toolCall;
		this.sessionUpdateCallback?.({
			type: "tool_call",
			sessionId,
			toolCallId: toolCallId,
			title: toolCallInfo?.title ?? undefined,
			status: toolCallInfo?.status || "pending",
			kind: (toolCallInfo?.kind as acp.ToolKind | undefined) ?? undefined,
			content: AcpTypeConverter.toToolCallContent(
				toolCallInfo?.content as acp.ToolCallContent[] | undefined,
			),
			permissionRequest: permissionRequestData,
		});

		// Return a Promise that will be resolved when user clicks a button
		return new Promise((resolve) => {
			this.pendingPermissionRequests.set(requestId, {
				resolve,
				toolCallId,
				options: normalizedOptions,
			});
		});
	}

	/**
	 * Cancel all pending permission requests.
	 */
	private cancelPendingPermissionRequests(): void {
		this.logger.log(
			`[AcpAdapter] Cancelling ${this.pendingPermissionRequests.size} pending permission requests`,
		);
		this.pendingPermissionRequests.forEach(
			({ resolve, toolCallId, options }, requestId) => {
				// Update UI to show cancelled state
				this.updateMessage(toolCallId, {
					type: "tool_call",
					toolCallId,
					status: "completed",
					permissionRequest: {
						requestId,
						options,
						isCancelled: true,
						isActive: false,
					},
				} as MessageContent);

				// Resolve the promise with cancelled outcome
				resolve({
					outcome: {
						outcome: "cancelled",
					},
				});
			},
		);
		this.pendingPermissionRequests.clear();
		this.pendingPermissionQueue = [];
	}

	// ========================================================================
	// Terminal Operations (IAcpClient)
	// ========================================================================

	readTextFile(params: acp.ReadTextFileRequest) {
		return Promise.resolve({ content: "" });
	}

	writeTextFile(params: acp.WriteTextFileRequest) {
		return Promise.resolve({});
	}

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		this.logger.log(
			"[AcpAdapter] createTerminal called with params:",
			params,
		);

		// Use current config's working directory if cwd is not provided
		const modifiedParams = {
			...params,
			cwd: params.cwd || this.currentConfig?.workingDirectory || "",
		};
		this.logger.log("[AcpAdapter] Using modified params:", modifiedParams);

		const terminalId = this.terminalManager.createTerminal(modifiedParams);
		return Promise.resolve({
			terminalId,
		});
	}

	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		const result = this.terminalManager.getOutput(params.terminalId);
		if (!result) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return Promise.resolve(result);
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		return await this.terminalManager.waitForExit(params.terminalId);
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		const success = this.terminalManager.killTerminal(params.terminalId);
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return Promise.resolve({});
	}

	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		const success = this.terminalManager.releaseTerminal(params.terminalId);
		// Don't throw error if terminal not found - it may have been already cleaned up
		if (!success) {
			this.logger.log(
				`[AcpAdapter] releaseTerminal: Terminal ${params.terminalId} not found (may have been already cleaned up)`,
			);
		}
		return Promise.resolve({});
	}

	// ========================================================================
	// Session Management Methods
	// ========================================================================

	/**
	 * List available sessions (unstable).
	 *
	 * Only available if session.agentCapabilities.sessionCapabilities?.list is defined.
	 *
	 * @param cwd - Optional filter by working directory
	 * @param cursor - Pagination cursor from previous call
	 * @returns Promise resolving to sessions array and optional next cursor
	 */
	async listSessions(
		cwd?: string,
		cursor?: string,
	): Promise<ListSessionsResult> {
		if (!this.connection) {
			throw new Error(
				"ACP connection not initialized. Call initialize() first.",
			);
		}

		try {
			this.logger.log("[AcpAdapter] Listing sessions...");

			const response = await this.connection.unstable_listSessions({
				cwd: cwd ?? null,
				cursor: cursor ?? null,
			});

			this.logger.log(
				`[AcpAdapter] Found ${response.sessions.length} sessions`,
			);

			return {
				sessions: response.sessions.map((s) => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title ?? undefined,
					updatedAt: s.updatedAt ?? undefined,
				})),
				nextCursor: response.nextCursor ?? undefined,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] List Sessions Error:", error);
			throw error;
		}
	}

	/**
	 * Load a previous session with history replay (stable).
	 *
	 * Conversation history is received via onSessionUpdate callback
	 * as user_message_chunk, agent_message_chunk, tool_call, etc.
	 *
	 * @param sessionId - Session to load
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	async loadSession(
		sessionId: string,
		cwd: string,
	): Promise<LoadSessionResult> {
		if (!this.connection) {
			throw new Error(
				"ACP connection not initialized. Call initialize() first.",
			);
		}

		try {
			this.logger.log(`[AcpAdapter] Loading session: ${sessionId}...`);

			const response = await this.connection.loadSession({
				sessionId,
				cwd,
				mcpServers: [],
			});

			// Conversation history is received via session/update notifications
			// (user_message_chunk, agent_message_chunk, tool_call, etc.)
			// and handled by the onSessionUpdate callback

			this.logger.log(`[AcpAdapter] Session loaded: ${sessionId}`);

			// Convert modes/models to domain types
			let modes: SessionModeState | undefined;
			if (response.modes) {
				modes = {
					availableModes: response.modes.availableModes.map((m) => ({
						id: m.id,
						name: m.name,
						description: m.description ?? undefined,
					})),
					currentModeId: response.modes.currentModeId,
				};
			}

			let models: SessionModelState | undefined;
			if (response.models) {
				models = {
					availableModels: response.models.availableModels.map(
						(m) => ({
							modelId: m.modelId,
							name: m.name,
							description: m.description ?? undefined,
						}),
					),
					currentModelId: response.models.currentModelId,
				};
			}

			return {
				sessionId,
				modes,
				models,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] Load Session Error:", error);
			throw error;
		}
	}

	/**
	 * Resume a session without history replay (unstable).
	 *
	 * Use when client manages its own history storage.
	 *
	 * @param sessionId - Session to resume
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	async resumeSession(
		sessionId: string,
		cwd: string,
	): Promise<ResumeSessionResult> {
		if (!this.connection) {
			throw new Error(
				"ACP connection not initialized. Call initialize() first.",
			);
		}

		try {
			this.logger.log(`[AcpAdapter] Resuming session: ${sessionId}...`);

			const response = await this.connection.unstable_resumeSession({
				sessionId,
				cwd,
				mcpServers: [],
			});

			this.logger.log(`[AcpAdapter] Session resumed: ${sessionId}`);

			// Convert modes/models to domain types
			let modes: SessionModeState | undefined;
			if (response.modes) {
				modes = {
					availableModes: response.modes.availableModes.map((m) => ({
						id: m.id,
						name: m.name,
						description: m.description ?? undefined,
					})),
					currentModeId: response.modes.currentModeId,
				};
			}

			let models: SessionModelState | undefined;
			if (response.models) {
				models = {
					availableModels: response.models.availableModels.map(
						(m) => ({
							modelId: m.modelId,
							name: m.name,
							description: m.description ?? undefined,
						}),
					),
					currentModelId: response.models.currentModelId,
				};
			}

			return {
				sessionId,
				modes,
				models,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] Resume Session Error:", error);
			throw error;
		}
	}

	/**
	 * Fork a session to create a new branch (unstable).
	 *
	 * Creates a new session with inherited context from the original.
	 *
	 * @param sessionId - Session to fork from
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with new sessionId
	 */
	async forkSession(
		sessionId: string,
		cwd: string,
	): Promise<ForkSessionResult> {
		if (!this.connection) {
			throw new Error(
				"ACP connection not initialized. Call initialize() first.",
			);
		}

		try {
			this.logger.log(`[AcpAdapter] Forking session: ${sessionId}...`);

			const response = await this.connection.unstable_forkSession({
				sessionId,
				cwd,
				mcpServers: [],
			});

			const newSessionId = response.sessionId;
			this.logger.log(
				`[AcpAdapter] Session forked: ${sessionId} -> ${newSessionId}`,
			);

			// Convert modes/models to domain types
			let modes: SessionModeState | undefined;
			if (response.modes) {
				modes = {
					availableModes: response.modes.availableModes.map((m) => ({
						id: m.id,
						name: m.name,
						description: m.description ?? undefined,
					})),
					currentModeId: response.modes.currentModeId,
				};
			}

			let models: SessionModelState | undefined;
			if (response.models) {
				models = {
					availableModels: response.models.availableModels.map(
						(m) => ({
							modelId: m.modelId,
							name: m.name,
							description: m.description ?? undefined,
						}),
					),
					currentModelId: response.models.currentModelId,
				};
			}

			return {
				sessionId: newSessionId,
				modes,
				models,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] Fork Session Error:", error);
			throw error;
		}
	}
}
