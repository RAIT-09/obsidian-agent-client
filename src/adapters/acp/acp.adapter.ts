import * as acp from "@agentclientprotocol/sdk";

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
import type { ProcessError } from "../../domain/models/agent-error";
import type {
	ListSessionsResult,
	LoadSessionResult,
	ResumeSessionResult,
	ForkSessionResult,
} from "../../domain/models/session-info";
import { TerminalManager } from "../../shared/terminal-manager";
import { getLogger, Logger } from "../../shared/logger";
import type AgentClientPlugin from "../../plugin";
import { routeSessionUpdate } from "./update-routing";
import { extractStderrErrorHint } from "./error-diagnostics";
import {
	authenticateOperation,
	cancelOperation,
	newSessionOperation,
	sendPromptOperation,
	setSessionModeOperation,
	setSessionModelOperation,
} from "./runtime-ops";
import {
	cancelPendingPermissionRequestsOperation,
	handlePermissionResponseOperation,
	requestPermissionOperation,
} from "./permission-queue";
import {
	createTerminalOperation,
	killTerminalOperation,
	releaseTerminalOperation,
	terminalOutputOperation,
	waitForTerminalExitOperation,
} from "./terminal-bridge";
import {
	forkSessionOperation,
	listSessionsOperation,
	loadSessionOperation,
	resumeSessionOperation,
} from "./session-ops";
import type {
	AgentRuntime,
	AgentRuntimeManager,
} from "./agent-runtime-manager";
import type { SessionHandler } from "./runtime-multiplexer";

export interface IAcpClient {
	handlePermissionResponse(requestId: string, optionId: string): void;
	cancelAllOperations(): void;
	resetCurrentMessage(): void;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
	setUpdateMessageCallback(
		updateMessage: (toolCallId: string, content: MessageContent) => void,
	): void;
}

/**
 * Per-tab ACP adapter.
 *
 * Owns session-scoped state (permissions, terminals, callbacks) but
 * delegates process/connection lifecycle to a shared {@link AgentRuntime}
 * managed by {@link AgentRuntimeManager}.
 *
 * Implements {@link SessionHandler} so the runtime's multiplexer can
 * route ACP events to this adapter by sessionId.
 */
export class AcpAdapter implements IAgentClient, IAcpClient, SessionHandler {
	private runtime: AgentRuntime | null = null;
	private runtimeManager: AgentRuntimeManager;
	private logger: Logger;

	private sessionUpdateCallback: ((update: SessionUpdate) => void) | null =
		null;

	private errorCallback: ((error: ProcessError) => void) | null = null;

	private updateMessage: (toolCallId: string, content: MessageContent) => void;

	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;
	private currentSessionId: string | null = null;
	private autoAllowPermissions = false;

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

	private promptSessionUpdateCount = 0;
	private recentStderr = "";

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
		this.updateMessage = () => {};
		this.runtimeManager = plugin.runtimeManager;
		this.terminalManager = new TerminalManager(plugin);
	}

	// ── Convenience accessors for the shared connection ────────────────

	private get connection(): acp.ClientSideConnection | null {
		return this.runtime?.connection ?? null;
	}

	// ── IAgentClient implementation ───────────────────────────────────

	setUpdateMessageCallback(
		updateMessage: (toolCallId: string, content: MessageContent) => void,
	): void {
		this.updateMessage = updateMessage;
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		this.logger.log(
			"[AcpAdapter] Starting initialization with config:",
			config,
		);

		if (this.runtime && this.currentSessionId) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
			this.currentSessionId = null;
		}

		if (this.runtime && this.currentAgentId) {
			this.runtimeManager.releaseRuntime(this.currentAgentId);
			this.runtime = null;
		}

		this.currentConfig = config;
		this.autoAllowPermissions = this.plugin.settings.autoAllowPermissions;

		try {
			const runtime = await this.runtimeManager.acquireRuntime(config, {
				pluginVersion: this.plugin.manifest.version,
				windowsWslMode: this.plugin.settings.windowsWslMode,
				windowsWslDistribution:
					this.plugin.settings.windowsWslDistribution,
				nodePath: this.plugin.settings.nodePath,
			});
			this.runtime = runtime;
			this.isInitializedFlag = true;
			this.currentAgentId = config.id;
			return runtime.initResult;
		} catch (error) {
			this.logger.error("[AcpAdapter] Initialization Error:", error);
			this.isInitializedFlag = false;
			this.currentAgentId = null;
			throw error;
		}
	}

	async newSession(workingDirectory: string): Promise<NewSessionResult> {
		const result = await newSessionOperation({
			connection: this.connection,
			logger: this.logger,
			workingDirectory,
			windowsWslMode: this.plugin.settings.windowsWslMode,
		});

		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}
		this.currentSessionId = result.sessionId;
		this.runtime?.multiplexer.registerSession(result.sessionId, this);

		return result;
	}

	async authenticate(methodId: string): Promise<boolean> {
		return await authenticateOperation({
			connection: this.connection,
			logger: this.logger,
			methodId,
		});
	}

	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		await sendPromptOperation({
			connection: this.connection,
			logger: this.logger,
			sessionId,
			content,
			resetCurrentMessage: () => {
				this.resetCurrentMessage();
			},
			setPromptSessionUpdateCount: (value) => {
				this.promptSessionUpdateCount = value;
			},
			getPromptSessionUpdateCount: () => this.promptSessionUpdateCount,
			setRecentStderr: (value) => {
				this.recentStderr = value;
			},
			extractStderrErrorHint: () => this.extractStderrErrorHint(),
		});
	}

	async cancel(sessionId: string): Promise<void> {
		await cancelOperation({
			connection: this.connection,
			logger: this.logger,
			sessionId,
			cancelAllOperations: () => this.cancelAllOperations(),
		});
	}

	disconnect(): Promise<void> {
		this.logger.log("[AcpAdapter] Disconnecting...");
		this.cancelAllOperations();

		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}

		if (this.runtime && this.currentAgentId) {
			this.runtimeManager.releaseRuntime(this.currentAgentId);
			this.runtime = null;
		}

		this.currentConfig = null;
		this.isInitializedFlag = false;
		this.currentAgentId = null;
		this.currentSessionId = null;
		return Promise.resolve();
	}

	/**
	 * Force-disconnect the shared runtime (kills the agent process).
	 * Other tabs sharing this runtime will receive error callbacks.
	 */
	forceDisconnectRuntime(): void {
		if (this.currentAgentId) {
			this.runtimeManager.forceDisconnectRuntime(this.currentAgentId);
		}
		this.runtime = null;
		this.isInitializedFlag = false;
		this.currentSessionId = null;
	}

	isInitialized(): boolean {
		return (
			this.isInitializedFlag &&
			this.runtime !== null &&
			this.runtime.connection !== null &&
			this.runtime.process !== null
		);
	}

	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		await setSessionModeOperation({
			connection: this.connection,
			logger: this.logger,
			sessionId,
			modeId,
		});
	}

	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		await setSessionModelOperation({
			connection: this.connection,
			logger: this.logger,
			sessionId,
			modelId,
		});
	}

	onSessionUpdate(callback: (update: SessionUpdate) => void): void {
		this.sessionUpdateCallback = callback;
	}

	onError(callback: (error: ProcessError) => void): void {
		this.errorCallback = callback;
	}

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

	// ── SessionHandler implementation (called by RuntimeMultiplexer) ──

	sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		const sessionId = params.sessionId;
		this.promptSessionUpdateCount++;
		this.logger.log("[AcpAdapter] sessionUpdate:", { sessionId, update });

		if (this.sessionUpdateCallback) {
			routeSessionUpdate(update, sessionId, this.sessionUpdateCallback);
		}
		return Promise.resolve();
	}

	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		return await requestPermissionOperation({
			params,
			logger: this.logger,
			autoAllowPermissions: this.autoAllowPermissions,
			state: {
				pendingPermissionRequests: this.pendingPermissionRequests,
				pendingPermissionQueue: this.pendingPermissionQueue,
			},
			updateMessage: this.updateMessage,
			sessionUpdateCallback: this.sessionUpdateCallback,
		});
	}

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		return Promise.resolve(
			createTerminalOperation({
				params,
				logger: this.logger,
				terminalManager: this.terminalManager,
				currentConfig: this.currentConfig,
			}),
		);
	}

	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		return Promise.resolve(
			terminalOutputOperation({
				params,
				terminalManager: this.terminalManager,
			}),
		);
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		return await waitForTerminalExitOperation({
			params,
			terminalManager: this.terminalManager,
		});
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		return Promise.resolve(
			killTerminalOperation({
				params,
				terminalManager: this.terminalManager,
			}),
		);
	}

	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		return Promise.resolve(
			releaseTerminalOperation({
				params,
				logger: this.logger,
				terminalManager: this.terminalManager,
			}),
		);
	}

	handleProcessError(error: ProcessError): void {
		this.errorCallback?.(error);
	}

	handleStderrData(chunk: string): void {
		this.recentStderr += chunk;
		if (this.recentStderr.length > 8192) {
			this.recentStderr = this.recentStderr.slice(-4096);
		}
	}

	// ── IAcpClient methods ────────────────────────────────────────────

	resetCurrentMessage(): void {
		this.currentMessageId = null;
	}

	handlePermissionResponse(requestId: string, optionId: string): void {
		handlePermissionResponseOperation({
			state: {
				pendingPermissionRequests: this.pendingPermissionRequests,
				pendingPermissionQueue: this.pendingPermissionQueue,
			},
			requestId,
			optionId,
			updateMessage: this.updateMessage,
		});
	}

	cancelAllOperations(): void {
		this.cancelPendingPermissionRequests();
		this.terminalManager.killAllTerminals();
	}

	// ── Private helpers ───────────────────────────────────────────────

	private extractStderrErrorHint(): string | null {
		return extractStderrErrorHint(this.recentStderr);
	}

	private cancelPendingPermissionRequests(): void {
		cancelPendingPermissionRequestsOperation({
			state: {
				pendingPermissionRequests: this.pendingPermissionRequests,
				pendingPermissionQueue: this.pendingPermissionQueue,
			},
			logger: this.logger,
			updateMessage: this.updateMessage,
		});
	}

	// ── Session management ────────────────────────────────────────────

	async listSessions(
		cwd?: string,
		cursor?: string,
	): Promise<ListSessionsResult> {
		return await listSessionsOperation({
			connection: this.connection,
			logger: this.logger,
			windowsWslMode: this.plugin.settings.windowsWslMode,
			cwd,
			cursor,
		});
	}

	async loadSession(
		sessionId: string,
		cwd: string,
	): Promise<LoadSessionResult> {
		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}
		this.currentSessionId = sessionId;
		this.runtime?.multiplexer.registerSession(sessionId, this);

		return await loadSessionOperation({
			connection: this.connection,
			logger: this.logger,
			windowsWslMode: this.plugin.settings.windowsWslMode,
			sessionId,
			cwd,
		});
	}

	async resumeSession(
		sessionId: string,
		cwd: string,
	): Promise<ResumeSessionResult> {
		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}
		this.currentSessionId = sessionId;
		this.runtime?.multiplexer.registerSession(sessionId, this);

		return await resumeSessionOperation({
			connection: this.connection,
			logger: this.logger,
			windowsWslMode: this.plugin.settings.windowsWslMode,
			sessionId,
			cwd,
		});
	}

	async forkSession(
		sessionId: string,
		cwd: string,
	): Promise<ForkSessionResult> {
		const result = await forkSessionOperation({
			connection: this.connection,
			logger: this.logger,
			windowsWslMode: this.plugin.settings.windowsWslMode,
			sessionId,
			cwd,
		});

		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}
		this.currentSessionId = result.sessionId;
		this.runtime?.multiplexer.registerSession(result.sessionId, this);

		return result;
	}
}
