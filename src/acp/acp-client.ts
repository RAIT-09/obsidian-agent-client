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
import { AcpHandler } from "./acp-handler";
import { getLogger, Logger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
import {
	convertWindowsPathToWsl,
	getEnhancedWindowsEnv,
	prepareShellCommand,
} from "../utils/platform";
import { resolveNodeDirectory } from "../utils/paths";
import {
	extractStderrErrorHint,
	getSpawnErrorInfo,
	getCommandNotFoundSuggestion,
	isEmptyResponseError,
	isUserAbortedError,
} from "../utils/error-utils";

/**
 * Runtime configuration for launching an AI agent process.
 * Converted from BaseAgentSettings by toAgentConfig() in settings-service.
 */
export interface AgentConfig {
	id: string;
	displayName: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	workingDirectory: string;
}

/**
 * Result of polling terminal output.
 */
export interface TerminalOutputResult {
	output: string;
	truncated: boolean;
	exitStatus: {
		exitCode: number | null;
		signal: string | null;
	} | null;
}

/**
 * ACP client for agent communication and process lifecycle management.
 */
export class AcpClient {
	// Connection & process
	private connection: acp.ClientSideConnection | null = null;
	private agentProcess: ChildProcess | null = null;
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;

	// Callbacks
	private errorListeners = new Set<(error: ProcessError) => void>();
	private updateMessage: (toolCallId: string, content: MessageContent) => void;

	// Delegates
	private terminalManager: TerminalManager;
	private permissionManager: PermissionManager;
	private handler: AcpHandler;

	// Prompt state (reset per sendPrompt)
	private recentStderr = "";

	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
		// Initialize with no-op callback
		this.updateMessage = () => {};

		// Initialize managers
		this.terminalManager = new TerminalManager(plugin);
		this.permissionManager = new PermissionManager(
			{
				onSessionUpdate: (update) =>
					this.handler.emitSessionUpdate(update),
				onUpdateMessage: (id, content) =>
					this.updateMessage(id, content),
			},
			false, // autoAllow — updated in initialize()
		);

		// Initialize protocol handler
		this.handler = new AcpHandler(
			this.permissionManager,
			this.terminalManager,
			() => this.currentConfig?.workingDirectory ?? "",
			this.logger,
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
				...getSpawnErrorInfo(error, command, agentLabel, this.plugin.settings.windowsWslMode),
			};

			for (const listener of this.errorListeners) {
				listener(processError);
			}
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
					suggestion: getCommandNotFoundSuggestion(command, this.plugin.settings.windowsWslMode),
				};

				for (const listener of this.errorListeners) {
					listener(processError);
				}
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
		this.connection = new acp.ClientSideConnection(() => this.handler, stream);

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

			this.isInitializedFlag = true;
			this.currentAgentId = config.id;

			return AcpTypeConverter.toInitializeResult(initResult);
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

		this.handler.resetUpdateCount();
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
				!this.handler.hasReceivedUpdates() &&
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
			if (isEmptyResponseError(error) || isUserAbortedError(error)) {
				return;
			}
			this.logger.error("[AcpClient] Prompt Error:", error);
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
	 */
	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	/**
	 * DEPRECATED: Use setSessionConfigOption instead.
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
	onSessionUpdate(
		callback: (update: SessionUpdate) => void,
	): () => void {
		return this.handler.onSessionUpdate(callback);
	}

	/**
	 * Register callback for error notifications.
	 *
	 * Called when errors occur during agent operations that cannot be
	 * propagated via exceptions (e.g., process spawn errors, exit code 127).
	 *
	 * @returns Unsubscribe function to remove the listener
	 */
	onError(callback: (error: ProcessError) => void): () => void {
		this.errorListeners.add(callback);
		return () => this.errorListeners.delete(callback);
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

	private cancelAllOperations(): void {
		this.permissionManager.cancelAll();
		this.terminalManager.killAllTerminals();
	}

	/**
	 * Get terminal output for UI rendering.
	 */
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult> {
		const result = this.terminalManager.getOutput(terminalId);
		if (!result) {
			throw new Error(`Terminal ${terminalId} not found`);
		}
		return Promise.resolve(result);
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
