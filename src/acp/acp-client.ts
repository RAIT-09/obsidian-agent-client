import { spawn, ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type {
	InitializeResult,
	SessionConfigOption,
	SessionUpdate,
	ListSessionsResult,
	SessionResult,
} from "../types/session";
import type { MessageContent, PromptContent } from "../types/chat";
import type { ProcessError } from "../types/errors";
import { AcpTypeConverter } from "./type-converter";
import { TerminalManager } from "./terminal-handler";
import { PermissionManager } from "./permission-handler";
import { getLogger, Logger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
import {
	convertWindowsPathToWsl,
	getEnhancedWindowsEnv,
	prepareShellCommand,
} from "../utils/platform";
import { resolveNodeDirectory } from "../utils/paths";
import { extractStderrErrorHint } from "../utils/error-utils";

// ============================================================================
// Port Types (from agent-client.port.ts and terminal-client.port.ts)
// ============================================================================

/**
 * Runtime configuration for launching an AI agent process.
 *
 * This is the execution-time configuration used when spawning an agent process,
 * as opposed to BaseAgentSettings which is the storage format in plugin settings.
 *
 * Key differences from BaseAgentSettings:
 * - env is converted to Record<string, string> format for process.spawn()
 * - workingDirectory is added for the session execution context
 *
 * Adapters are responsible for converting BaseAgentSettings → AgentConfig
 * before launching the agent process.
 */
export interface AgentConfig {
	/** Unique identifier for this agent (e.g., "claude", "gemini") */
	id: string;

	/** Display name for the agent */
	displayName: string;

	/** Command to execute (full path to executable) */
	command: string;

	/** Command-line arguments */
	args: string[];

	/**
	 * Environment variables for the agent process.
	 * Converted from AgentEnvVar[] to Record format for process.spawn().
	 */
	env?: Record<string, string>;

	/** Working directory for the agent session */
	workingDirectory: string;
}

/**
 * Interface for communicating with ACP-compatible agents.
 *
 * Provides methods for connecting to agents, sending messages,
 * handling permission requests, and managing agent lifecycle.
 *
 * This port will be implemented by adapters that handle the actual
 * ACP protocol communication and process management.
 */
export interface IAgentClient {
	/**
	 * Initialize connection to an agent.
	 *
	 * Spawns the agent process and performs protocol handshake.
	 *
	 * @param config - Agent configuration
	 * @returns Promise resolving to initialization result
	 * @throws AgentError if connection fails
	 */
	initialize(config: AgentConfig): Promise<InitializeResult>;

	/**
	 * Create a new chat session.
	 *
	 * @param workingDirectory - Working directory for the session
	 * @returns Promise resolving to new session result
	 * @throws AgentError if session creation fails
	 */
	newSession(workingDirectory: string): Promise<SessionResult>;

	/**
	 * Authenticate with the agent.
	 *
	 * @param methodId - ID of the authentication method to use
	 * @returns Promise resolving to true if authentication succeeded
	 */
	authenticate(methodId: string): Promise<boolean>;

	/**
	 * Send a prompt to the agent.
	 *
	 * The prompt can contain multiple content blocks (text, images).
	 * The agent will process the prompt and respond via the onSessionUpdate callback.
	 * May also trigger permission requests.
	 *
	 * @param sessionId - Session identifier
	 * @param content - Array of content blocks to send (text and/or images)
	 * @returns Promise resolving when agent completes processing
	 * @throws AgentError if sending fails
	 */
	sendPrompt(sessionId: string, content: PromptContent[]): Promise<void>;

	/**
	 * Cancel ongoing agent operations.
	 *
	 * Stops the current message processing and cancels any pending operations.
	 *
	 * @param sessionId - Session identifier
	 * @returns Promise resolving when cancellation is complete
	 */
	cancel(sessionId: string): Promise<void>;

	/**
	 * Disconnect from the agent.
	 *
	 * Terminates the agent process and cleans up resources.
	 */
	disconnect(): Promise<void>;

	/**
	 * Register callback for session updates.
	 *
	 * Called when the agent sends session update events such as:
	 * - agent_message_chunk: Text chunk from agent's response
	 * - agent_thought_chunk: Text chunk from agent's reasoning
	 * - user_message_chunk: Text chunk from user message (for session/load history replay)
	 * - tool_call: New tool call event
	 * - tool_call_update: Update to existing tool call
	 * - plan: Agent's task plan
	 * - available_commands_update: Slash commands changed
	 * - current_mode_update: Mode changed
	 *
	 * This is the unified callback for all session updates.
	 *
	 * @param callback - Function to call when agent sends a session update
	 */
	onSessionUpdate(callback: (update: SessionUpdate) => void): void;

	/**
	 * Register callback for error notifications.
	 *
	 * Called when errors occur during agent operations that cannot be
	 * propagated via exceptions (e.g., process spawn errors, exit code 127).
	 *
	 * @param callback - Function to call when an error occurs
	 */
	onError(callback: (error: ProcessError) => void): void;

	/**
	 * Respond to a permission request.
	 *
	 * Sends the user's decision back to the agent, allowing or denying
	 * the requested operation.
	 *
	 * @param requestId - Permission request identifier
	 * @param optionId - Selected option identifier
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void>;

	/**
	 * Check if the agent connection is initialized and ready.
	 *
	 * Returns true if:
	 * - initialize() has been called successfully
	 * - The agent process is still running
	 * - The connection is still active
	 *
	 * @returns true if initialized and connected, false otherwise
	 */
	isInitialized(): boolean;

	/**
	 * Get the ID of the currently connected agent.
	 *
	 * Returns null if no agent is connected.
	 *
	 * @returns Agent ID or null
	 */
	getCurrentAgentId(): string | null;

	/**
	 * DEPRECATED: Use setSessionConfigOption instead.
	 *
	 * Set the session mode.
	 *
	 * Changes the agent's operating mode for the current session.
	 * The mode must be one of the available modes returned in SessionResult.
	 * After calling this, the agent will send a current_mode_update notification
	 * to confirm the mode change.
	 *
	 * @param sessionId - Session identifier
	 * @param modeId - ID of the mode to set (must be in availableModes)
	 * @returns Promise resolving when the mode change request is sent
	 * @throws Error if connection is not initialized or mode is invalid
	 */
	setSessionMode(sessionId: string, modeId: string): Promise<void>;

	/**
	 * DEPRECATED: Use setSessionConfigOption instead.
	 *
	 * Set the session model (experimental).
	 * @param sessionId - The session ID
	 * @param modelId - The model ID to set
	 */
	setSessionModel(sessionId: string, modelId: string): Promise<void>;

	/**
	 * Set a session configuration option.
	 *
	 * Sends a config option change to the agent. The response contains the
	 * complete set of all config options with their current values, as changing
	 * one option may affect others.
	 *
	 * @param sessionId - Session identifier
	 * @param configId - ID of the config option to change
	 * @param value - New value to set
	 * @returns Updated list of all config options
	 */
	setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]>;

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
	listSessions(cwd?: string, cursor?: string): Promise<ListSessionsResult>;

	/**
	 * Load a previous session with history replay (stable).
	 *
	 * Conversation history is received via onSessionUpdate callback
	 * as user_message_chunk, agent_message_chunk, tool_call, etc.
	 *
	 * Only available if session.agentCapabilities.loadSession is true.
	 *
	 * @param sessionId - Session to load
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	loadSession(sessionId: string, cwd: string): Promise<SessionResult>;

	/**
	 * Resume a session without history replay (unstable).
	 *
	 * Use when client manages its own history storage.
	 * Only available if session.agentCapabilities.sessionCapabilities?.resume is defined.
	 *
	 * @param sessionId - Session to resume
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with modes and models
	 */
	resumeSession(sessionId: string, cwd: string): Promise<SessionResult>;

	/**
	 * Fork a session to create a new branch (unstable).
	 *
	 * Creates a new session with inherited context from the original.
	 * Only available if session.agentCapabilities.sessionCapabilities?.fork is defined.
	 *
	 * @param sessionId - Session to fork from
	 * @param cwd - Working directory
	 * @returns Promise resolving to session result with new sessionId
	 */
	forkSession(sessionId: string, cwd: string): Promise<SessionResult>;
}

/**
 * Result of polling terminal output.
 */
export interface TerminalOutputResult {
	/** Terminal output text captured so far */
	output: string;
	/** Whether the output was truncated due to byte limits */
	truncated: boolean;
	/** Exit status if the command has completed, null if still running */
	exitStatus: {
		exitCode: number | null;
		signal: string | null;
	} | null;
}

/**
 * Interface for terminal output operations.
 *
 * Provides read-only access to terminal output for UI rendering.
 * The actual terminal lifecycle (create, kill, release) is managed
 * internally by the adapter and is not exposed to the UI layer.
 */
export interface ITerminalClient {
	/**
	 * Get the current output and exit status of a terminal.
	 *
	 * @param terminalId - Terminal identifier from a tool_call
	 * @returns Terminal output and optional exit status
	 * @throws Error if terminal not found
	 */
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult>;
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
export class AcpClient implements IAgentClient, ITerminalClient {
	private connection: acp.ClientSideConnection | null = null;
	private agentProcess: ChildProcess | null = null;
	private logger: Logger;

	// Session update callback (unified callback for all session updates)
	private sessionUpdateCallback: ((update: SessionUpdate) => void) | null =
		null;

	// Error callback for process-level errors
	private errorCallback: ((error: ProcessError) => void) | null = null;

	// Message update callback for permission UI updates
	private updateMessage: (
		toolCallId: string,
		content: MessageContent,
	) => void;

	// Configuration state
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;
	// ACP protocol handler properties
	private terminalManager: TerminalManager;
	private permissionManager: PermissionManager;
	private currentMessageId: string | null = null;

	// Tracks whether any session update was received during the current prompt.
	// Used to detect silent failures (e.g., missing API keys) where the agent
	// returns end_turn with no content.
	private promptSessionUpdateCount = 0;
	// Captures recent stderr output for error diagnostics
	private recentStderr = "";

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
		// Initialize with no-op callback
		this.updateMessage = () => {};

		// Initialize managers
		this.terminalManager = new TerminalManager(plugin);
		this.permissionManager = new PermissionManager(
			{
				onSessionUpdate: (update) =>
					this.sessionUpdateCallback?.(update),
				onUpdateMessage: (id, content) =>
					this.updateMessage(id, content),
			},
			false, // autoAllow — updated in initialize()
		);
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
			"[AcpClient] Starting initialization with config:",
			config,
		);
		this.logger.log(
			`[AcpClient] Current state - process: ${!!this.agentProcess}, PID: ${this.agentProcess?.pid}`,
		);

		// Clean up existing process if any (e.g., when switching agents)
		if (this.agentProcess) {
			this.logger.log(
				`[AcpClient] Killing existing process (PID: ${this.agentProcess.pid})`,
			);
			this.agentProcess.kill();
			this.agentProcess = null;
		}

		// Clean up existing connection
		if (this.connection) {
			this.logger.log("[AcpClient] Cleaning up existing connection");
			this.connection = null;
		}

		this.currentConfig = config;

		// Update auto-allow permissions from plugin settings
		this.permissionManager.setAutoAllow(
			this.plugin.settings.autoAllowPermissions,
		);

		// Validate command
		if (!config.command || config.command.trim().length === 0) {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id}). Please configure the agent command in settings.`,
			);
		}

		const command = config.command.trim();
		const args = config.args.length > 0 ? [...config.args] : [];

		this.logger.log(
			`[AcpClient] Active agent: ${config.displayName} (${config.id})`,
		);
		this.logger.log("[AcpClient] Command:", command);
		this.logger.log(
			"[AcpClient] Args:",
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

		// Add Node.js directory to PATH only when nodePath is an explicit absolute path.
		// When nodePath is empty or a bare command name, the login shell handles it.
		const nodeDir = resolveNodeDirectory(this.plugin.settings.nodePath);
		if (nodeDir) {
			const separator = Platform.isWin ? ";" : ":";
			baseEnv.PATH = baseEnv.PATH
				? `${nodeDir}${separator}${baseEnv.PATH}`
				: nodeDir;
			this.logger.log(
				"[AcpClient] Node.js directory added to PATH:",
				nodeDir,
			);
		}

		this.logger.log(
			"[AcpClient] Starting agent process in directory:",
			config.workingDirectory,
		);

		// Prepare command and args for spawning (platform-specific shell wrapping)
		const prepared = prepareShellCommand(
			command,
			args,
			config.workingDirectory,
			{
				wslMode: this.plugin.settings.windowsWslMode,
				wslDistribution: this.plugin.settings.windowsWslDistribution,
				nodeDir,
				alwaysEscape: true,
			},
		);
		const spawnCommand = prepared.command;
		const spawnArgs = prepared.args;
		const needsShell = prepared.needsShell;

		this.logger.log(
			"[AcpClient] Prepared spawn command:",
			spawnCommand,
			spawnArgs,
		);

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
				`[AcpClient] ${agentLabel} process spawned successfully, PID:`,
				agentProcess.pid,
			);
		});

		agentProcess.on("error", (error) => {
			this.logger.error(
				`[AcpClient] ${agentLabel} process error:`,
				error,
			);

			const processError: ProcessError = {
				type: "spawn_failed",
				agentId: config.id,
				errorCode: (error as NodeJS.ErrnoException).code,
				originalError: error,
				...this.getErrorInfo(error, command, agentLabel),
			};

			this.errorCallback?.(processError);
		});

		agentProcess.on("exit", (code, signal) => {
			this.logger.log(
				`[AcpClient] ${agentLabel} process exited with code:`,
				code,
				"signal:",
				signal,
			);

			if (code === 127) {
				this.logger.error(`[AcpClient] Command not found: ${command}`);

				const processError: ProcessError = {
					type: "command_not_found",
					agentId: config.id,
					exitCode: code,
					title: "Command Not Found",
					message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
					suggestion: this.getCommandNotFoundSuggestion(command),
				};

				this.errorCallback?.(processError);
			}
		});

		agentProcess.on("close", (code, signal) => {
			this.logger.log(
				`[AcpClient] ${agentLabel} process closed with code:`,
				code,
				"signal:",
				signal,
			);
		});

		agentProcess.stderr?.setEncoding("utf8");
		agentProcess.stderr?.on("data", (data) => {
			this.logger.log(`[AcpClient] ${agentLabel} stderr:`, data);
			// Keep a rolling window of recent stderr for error diagnostics
			this.recentStderr += data;
			if (this.recentStderr.length > 8192) {
				this.recentStderr = this.recentStderr.slice(-4096);
			}
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
			"[AcpClient] Using working directory:",
			config.workingDirectory,
		);

		const stream = acp.ndJsonStream(input, output);
		this.connection = new acp.ClientSideConnection(() => this, stream);

		try {
			this.logger.log("[AcpClient] Starting ACP initialization...");

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
				`[AcpClient] ✅ Connected to agent (protocol v${initResult.protocolVersion})`,
			);
			this.logger.log(
				"[AcpClient] Auth methods:",
				initResult.authMethods,
			);
			this.logger.log(
				"[AcpClient] Agent capabilities:",
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
			this.logger.error("[AcpClient] Initialization Error:", error);

			// Reset flags on failure
			this.isInitializedFlag = false;
			this.currentAgentId = null;

			throw error;
		}
	}

	/**
	 * Create a new chat session with the agent.
	 */
	async newSession(workingDirectory: string): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log("[AcpClient] Creating new session...");

			const response = await connection.newSession({
				cwd: this.toSessionCwd(workingDirectory),
				mcpServers: [],
			});

			this.logger.log(
				`[AcpClient] Created session: ${response.sessionId}`,
			);
			return AcpTypeConverter.toSessionResult(
				response.sessionId,
				response,
			);
		} catch (error) {
			this.logger.error("[AcpClient] New Session Error:", error);
			throw error;
		}
	}

	/**
	 * Authenticate with the agent using a specific method.
	 */
	async authenticate(methodId: string): Promise<boolean> {
		const connection = this.requireConnection();

		try {
			await connection.authenticate({ methodId });
			this.logger.log("[AcpClient] ✅ authenticate ok:", methodId);
			return true;
		} catch (error: unknown) {
			this.logger.error("[AcpClient] Authentication Error:", error);
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
		const connection = this.requireConnection();

		// Reset current message for new assistant response
		this.resetCurrentMessage();
		this.promptSessionUpdateCount = 0;
		this.recentStderr = "";

		try {
			// Convert domain PromptContent to ACP ContentBlock
			const acpContent = content.map((c) =>
				AcpTypeConverter.toAcpContentBlock(c),
			);

			this.logger.log(
				`[AcpClient] Sending prompt with ${content.length} content blocks`,
			);

			const promptResult = await connection.prompt({
				sessionId: sessionId,
				prompt: acpContent,
			});

			this.logger.log(
				`[AcpClient] Agent completed with: ${promptResult.stopReason}`,
			);

			// Detect silent failures: agent returned end_turn but sent no content.
			// Only surface an error when stderr contains a recognized error pattern
			// (e.g., missing API key). Some commands like /compact legitimately
			// return no session updates, so we avoid false positives.
			if (
				this.promptSessionUpdateCount === 0 &&
				promptResult.stopReason === "end_turn"
			) {
				// Allow pending stderr data events to flush before checking
				await new Promise((r) => setTimeout(r, 100));

				const stderrHint = extractStderrErrorHint(this.recentStderr);
				if (stderrHint) {
					this.logger.warn(
						"[AcpClient] Agent returned end_turn with no session updates — detected error in stderr",
					);
					throw new Error(
						`The agent returned an empty response. ${stderrHint}`,
					);
				} else {
					this.logger.log(
						"[AcpClient] Agent returned end_turn with no session updates (may be expected for some commands)",
					);
				}
			}
		} catch (error: unknown) {
			this.logger.error("[AcpClient] Prompt Error:", error);

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
							"[AcpClient] Empty response text error - ignoring",
						);
						return;
					}
					// Ignore "user aborted" errors (from cancel operation)
					if (errorData.details.includes("user aborted")) {
						this.logger.log(
							"[AcpClient] User aborted request - ignoring",
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
		try {
			const connection = this.requireConnection();

			this.logger.log(
				"[AcpClient] Sending session/cancel notification...",
			);
			await connection.cancel({ sessionId });
			this.logger.log(
				"[AcpClient] Cancellation request sent successfully",
			);
		} catch (error) {
			this.logger.warn("[AcpClient] Failed to send cancellation:", error);
		} finally {
			this.cancelAllOperations();
		}
	}

	/**
	 * Disconnect from the agent and clean up resources.
	 */
	disconnect(): Promise<void> {
		this.logger.log("[AcpClient] Disconnecting...");

		// Cancel all pending operations
		this.cancelAllOperations();

		// Kill the agent process
		if (this.agentProcess) {
			this.logger.log(
				`[AcpClient] Killing agent process (PID: ${this.agentProcess.pid})`,
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

		this.logger.log("[AcpClient] Disconnected");
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
	 * DEPRECATED: Use setSessionConfigOption instead.
	 *
	 * Set the session mode.
	 *
	 * Changes the agent's operating mode for the current session.
	 * The agent will confirm the mode change via a current_mode_update notification.
	 *
	 * Implementation of IAgentClient.setSessionMode()
	 */
	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		const connection = this.requireConnection();

		this.logger.log(
			`[AcpClient] Setting session mode to: ${modeId} for session: ${sessionId}`,
		);

		try {
			await connection.setSessionMode({
				sessionId,
				modeId,
			});
			this.logger.log(`[AcpClient] Session mode set to: ${modeId}`);
		} catch (error) {
			this.logger.error("[AcpClient] Failed to set session mode:", error);
			throw error;
		}
	}

	/**
	 * DEPRECATED: Use setSessionConfigOption instead.
	 *
	 * Implementation of IAgentClient.setSessionModel()
	 */
	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		const connection = this.requireConnection();

		this.logger.log(
			`[AcpClient] Setting session model to: ${modelId} for session: ${sessionId}`,
		);

		try {
			await connection.unstable_setSessionModel({
				sessionId,
				modelId,
			});
			this.logger.log(`[AcpClient] Session model set to: ${modelId}`);
		} catch (error) {
			this.logger.error(
				"[AcpClient] Failed to set session model:",
				error,
			);
			throw error;
		}
	}

	/**
	 * Set a session configuration option.
	 *
	 * Sends a config option change to the agent. The response contains the
	 * complete set of all config options with their current values, as changing
	 * one option may affect others.
	 */
	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]> {
		const connection = this.requireConnection();

		this.logger.log(
			`[AcpClient] Setting config option: ${configId}=${value} for session: ${sessionId}`,
		);

		try {
			const response = await connection.setSessionConfigOption({
				sessionId,
				configId,
				value,
			});
			this.logger.log(
				`[AcpClient] Config option set. Updated options:`,
				response.configOptions,
			);
			return AcpTypeConverter.toSessionConfigOptions(
				response.configOptions,
			);
		} catch (error) {
			this.logger.error(
				"[AcpClient] Failed to set config option:",
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
	onError(callback: (error: ProcessError) => void): void {
		this.errorCallback = callback;
	}

	/**
	 * Respond to a permission request from the agent.
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void> {
		this.requireConnection();

		this.logger.log(
			"[AcpClient] Responding to permission request:",
			requestId,
			"with option:",
			optionId,
		);
		this.permissionManager.respond(requestId, optionId);
		return Promise.resolve();
	}

	// Helper methods

	/**
	 * Assert that the ACP connection is initialized and return it.
	 * @throws Error if connection is not available
	 */
	private requireConnection(): acp.ClientSideConnection {
		if (!this.connection) {
			throw new Error(
				"Connection not initialized. Call initialize() first.",
			);
		}
		return this.connection;
	}

	/**
	 * Convert working directory to WSL path if in WSL mode on Windows.
	 */
	private toSessionCwd(cwd: string): string {
		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			return convertWindowsPathToWsl(cwd);
		}
		return cwd;
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

		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			return `1. Verify the agent path: Use "which ${commandName}" in your WSL terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
		} else if (Platform.isWin) {
			return `1. Verify the agent path: Use "where ${commandName}" in Command Prompt to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "where node" to find it).`;
		} else {
			return `1. Verify the agent path: Use "which ${commandName}" in Terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
		}
	}

	// ========================================================================
	// ACP Client Protocol Handlers
	// ========================================================================

	/**
	 * Handle session updates from the ACP protocol.
	 * This is called by ClientSideConnection when the agent sends updates.
	 */
	sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		const sessionId = params.sessionId;
		this.promptSessionUpdateCount++;
		this.logger.log("[AcpClient] sessionUpdate:", { sessionId, update });

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
					rawInput: update.rawInput as
						| { [k: string]: unknown }
						| undefined,
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
					`[AcpClient] available_commands_update, commands:`,
					update.availableCommands,
				);

				this.sessionUpdateCallback?.({
					type: "available_commands_update",
					sessionId,
					commands: AcpTypeConverter.toSlashCommands(update.availableCommands),
				});
				break;
			}

			case "current_mode_update": {
				this.logger.log(
					`[AcpClient] current_mode_update: ${update.currentModeId}`,
				);

				this.sessionUpdateCallback?.({
					type: "current_mode_update",
					sessionId,
					currentModeId: update.currentModeId,
				});
				break;
			}

			case "session_info_update": {
				this.logger.log(`[AcpClient] session_info_update:`, {
					title: update.title,
					updatedAt: update.updatedAt,
				});

				this.sessionUpdateCallback?.({
					type: "session_info_update",
					sessionId,
					title: update.title,
					updatedAt: update.updatedAt,
				});
				break;
			}

			case "usage_update": {
				this.logger.log(`[AcpClient] usage_update:`, {
					size: update.size,
					used: update.used,
					cost: update.cost,
				});

				this.sessionUpdateCallback?.({
					type: "usage_update",
					sessionId,
					size: update.size,
					used: update.used,
					cost: update.cost ?? undefined,
				});
				break;
			}

			case "config_option_update": {
				this.logger.log(
					`[AcpClient] config_option_update:`,
					update.configOptions,
				);

				this.sessionUpdateCallback?.({
					type: "config_option_update",
					sessionId,
					configOptions: AcpTypeConverter.toSessionConfigOptions(
						update.configOptions,
					),
				});
				break;
			}
		}
		return Promise.resolve();
	}

	/**
	 * Reset the current message ID.
	 */
	private resetCurrentMessage(): void {
		this.currentMessageId = null;
	}

	/**
	 * Cancel all ongoing operations.
	 */
	private cancelAllOperations(): void {
		this.permissionManager.cancelAll();
		this.terminalManager.killAllTerminals();
	}

	/**
	 * Request permission from user for an operation.
	 * Called by ACP ClientSideConnection dispatch.
	 */
	requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		return this.permissionManager.request(params);
	}

	// ========================================================================
	// ACP Extension Handlers
	// ========================================================================

	/**
	 * Handle custom notifications from agents (ACP extensibility).
	 *
	 * ACP agents may send custom notifications prefixed with underscore (e.g.,
	 * `_kiro.dev/commands/available`). Per the ACP spec, clients SHOULD ignore
	 * unrecognized notifications. Without this handler, the SDK raises
	 * `methodNotFound` errors for these notifications.
	 *
	 * @see https://agentclientprotocol.com/protocol/extensibility#custom-notifications
	 */
	async extNotification(
		method: string,
		params: Record<string, unknown>,
	): Promise<void> {
		this.logger.log(
			`[AcpClient] Extension notification received: ${method}`,
			params,
		);
	}

	// ========================================================================
	// Terminal Operations
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
			"[AcpClient] createTerminal called with params:",
			params,
		);

		const terminalId = this.terminalManager.createTerminal({
			command: params.command,
			args: params.args,
			cwd: params.cwd || this.currentConfig?.workingDirectory || "",
			env: params.env ?? undefined,
			outputByteLimit: params.outputByteLimit ?? undefined,
		});
		return Promise.resolve({
			terminalId,
		});
	}

	/**
	 * Get terminal output for UI rendering (ITerminalClient implementation).
	 */
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult> {
		const result = this.terminalManager.getOutput(terminalId);
		if (!result) {
			throw new Error(`Terminal ${terminalId} not found`);
		}
		return Promise.resolve(result);
	}

	/**
	 * ACP protocol handler for terminal output.
	 * Called by ClientSideConnection dispatch. Delegates to getTerminalOutput.
	 */
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		return this.getTerminalOutput(params.terminalId);
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
				`[AcpClient] releaseTerminal: Terminal ${params.terminalId} not found (may have been already cleaned up)`,
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
		const connection = this.requireConnection();

		try {
			this.logger.log("[AcpClient] Listing sessions...");

			const filterCwd = cwd ? this.toSessionCwd(cwd) : undefined;

			const response = await connection.unstable_listSessions({
				cwd: filterCwd ?? null,
				cursor: cursor ?? null,
			});

			this.logger.log(
				`[AcpClient] Found ${response.sessions.length} sessions`,
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
			this.logger.error("[AcpClient] List Sessions Error:", error);
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
	async loadSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log(`[AcpClient] Loading session: ${sessionId}...`);

			const response = await connection.loadSession({
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(`[AcpClient] Session loaded: ${sessionId}`);
			return AcpTypeConverter.toSessionResult(sessionId, response);
		} catch (error) {
			this.logger.error("[AcpClient] Load Session Error:", error);
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
	): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log(`[AcpClient] Resuming session: ${sessionId}...`);

			const response = await connection.unstable_resumeSession({
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(`[AcpClient] Session resumed: ${sessionId}`);
			return AcpTypeConverter.toSessionResult(sessionId, response);
		} catch (error) {
			this.logger.error("[AcpClient] Resume Session Error:", error);
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
	async forkSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const connection = this.requireConnection();

		try {
			this.logger.log(`[AcpClient] Forking session: ${sessionId}...`);

			const response = await connection.unstable_forkSession({
				sessionId,
				cwd: this.toSessionCwd(cwd),
				mcpServers: [],
			});

			this.logger.log(
				`[AcpClient] Session forked: ${sessionId} -> ${response.sessionId}`,
			);
			return AcpTypeConverter.toSessionResult(
				response.sessionId,
				response,
			);
		} catch (error) {
			this.logger.error("[AcpClient] Fork Session Error:", error);
			throw error;
		}
	}
}
