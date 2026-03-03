import * as acp from "@agentclientprotocol/sdk";
import type {
	AgentConfig,
} from "../../domain/ports/agent-client.port";
import type { PermissionOption } from "../../domain/models/chat-message";
import type { ProcessError } from "../../domain/models/agent-error";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { TerminalOutputSnapshot } from "../../domain/models/terminal-output";
import type {
	ForkSessionResult,
	ListSessionsResult,
	LoadSessionResult,
	ResumeSessionResult,
} from "../../domain/models/session-info";
import { getLogger, type Logger } from "../../shared/logger";
import { TerminalManager } from "./terminal-manager";
import type AgentClientPlugin from "../../plugin";
import {
	cancelPendingPermissionRequestsOperation,
	handlePermissionResponseOperation,
} from "./permission-queue";
import type { ExecutePolicyState } from "./execute-policy";
import type {
	PermissionQueueState,
	TerminalPermissionMode,
} from "./permission-queue";
import { resolveTerminalPermissionMode } from "./execute-policy";
import {
	createTerminalViaBridge,
	forkSessionViaBridge,
	getTerminalOutputSnapshot,
	killTerminalViaBridge,
	listSessionsViaBridge,
	loadSessionViaBridge,
	releaseTerminalViaBridge,
	resumeSessionViaBridge,
	terminalOutputViaBridge,
	waitForTerminalExitViaBridge,
} from "./acp.adapter-delegates";
import type {
	AgentRuntime,
	AgentRuntimeManager,
} from "./agent-runtime-manager";
import type { SessionHandler } from "./runtime-multiplexer";

export abstract class AcpAdapterBase {
	protected runtime: AgentRuntime | null = null;
	protected runtimeManager: AgentRuntimeManager;
	protected logger: Logger;

	protected sessionUpdateCallback: ((update: SessionUpdate) => void) | null =
		null;
	protected errorCallback: ((error: ProcessError) => void) | null = null;

	protected currentConfig: AgentConfig | null = null;
	protected isInitializedFlag = false;
	protected currentAgentId: string | null = null;
	protected currentSessionId: string | null = null;
	protected blockedExecuteToolCallIds = new Set<string>();
	protected grantedExecuteToolCallIds = new Set<string>();
	protected rejectedExecuteToolCallIds = new Set<string>();
	protected pendingSyntheticExecutePermissionToolCallIds = new Set<string>();
	protected latestExecuteUpdates = new Map<
		string,
		{
			sessionId: string;
			update: Extract<
				acp.SessionUpdate,
				{ sessionUpdate: "tool_call" | "tool_call_update" }
			>;
		}
	>();
	protected cancelRequestedForExecutePolicySessions = new Set<string>();

	protected terminalManager: TerminalManager;
	protected currentMessageId: string | null = null;
	protected pendingPermissionRequests = new Map<
		string,
		{
			resolve: (response: acp.RequestPermissionResponse) => void;
			toolCallId: string;
			sessionId: string;
			options: PermissionOption[];
		}
	>();
	protected pendingPermissionQueue: Array<{
		requestId: string;
		toolCallId: string;
		sessionId: string;
		options: PermissionOption[];
	}> = [];

	protected promptSessionUpdateCount = 0;
	protected recentStderr = "";

	constructor(protected readonly plugin: AgentClientPlugin) {
		this.logger = getLogger();
		this.runtimeManager = plugin.runtimeManager;
		this.terminalManager = new TerminalManager(plugin);
	}

	abstract sessionUpdate(
		params: acp.SessionNotification,
	): Promise<void>;
	abstract requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse>;

	protected get connection(): acp.ClientSideConnection | null {
		return this.runtime?.connection ?? null;
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

	async getTerminalOutput(terminalId: string): Promise<TerminalOutputSnapshot> {
		this.ensureTerminalEnabled();
		return getTerminalOutputSnapshot({
			terminalId,
			sessionId: this.currentSessionId ?? "",
			terminalManager: this.terminalManager,
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

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		this.ensureTerminalEnabled();
		return Promise.resolve(
			createTerminalViaBridge({
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
		this.ensureTerminalEnabled();
		return Promise.resolve(
			terminalOutputViaBridge({
				params,
				terminalManager: this.terminalManager,
			}),
		);
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		this.ensureTerminalEnabled();
		return await waitForTerminalExitViaBridge({
			params,
			terminalManager: this.terminalManager,
		});
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		this.ensureTerminalEnabled();
		return Promise.resolve(
			killTerminalViaBridge({
				params,
				terminalManager: this.terminalManager,
			}),
		);
	}

	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		this.ensureTerminalEnabled();
		return Promise.resolve(
			releaseTerminalViaBridge({
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

	protected resetCurrentMessage(): void {
		this.currentMessageId = null;
	}

	protected handlePermissionResponse(
		requestId: string,
		optionId: string,
	): void {
		handlePermissionResponseOperation({
			state: this.getPermissionQueueState(),
			requestId,
			optionId,
			sessionUpdateCallback: this.sessionUpdateCallback,
		});
	}

	protected cancelAllOperations(): void {
		this.cancelPendingPermissionRequests();
		this.terminalManager.killAllTerminals();
	}

	protected clearExecutePolicyTracking(): void {
		this.currentSessionId = null;
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
	}

	protected unbindCurrentSession(): void {
		if (this.currentSessionId && this.runtime) {
			this.runtime.multiplexer.unregisterSession(this.currentSessionId);
		}
		this.currentSessionId = null;
	}

	protected bindSession(sessionId: string): void {
		this.unbindCurrentSession();
		this.currentSessionId = sessionId;
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
		this.runtime?.multiplexer.registerSession(
			sessionId,
			this as SessionHandler,
		);
	}

	protected releaseCurrentRuntime(): void {
		if (this.runtime && this.currentAgentId) {
			this.runtimeManager.releaseRuntime(this.currentAgentId);
		}
		this.runtime = null;
	}

	protected ensureTerminalEnabled(): void {
		if (this.getTerminalPermissionMode() === "disabled") {
			throw new Error(
				"Terminal methods are disabled by client settings (terminalPermissionMode=disabled).",
			);
		}
	}

	protected getTerminalPermissionMode(): TerminalPermissionMode {
		return resolveTerminalPermissionMode(
			this.plugin.settings.terminalPermissionMode,
		);
	}

	protected getExecutePolicyState(): ExecutePolicyState {
		return {
			blockedExecuteToolCallIds: this.blockedExecuteToolCallIds,
			grantedExecuteToolCallIds: this.grantedExecuteToolCallIds,
			rejectedExecuteToolCallIds: this.rejectedExecuteToolCallIds,
			pendingSyntheticExecutePermissionToolCallIds:
				this.pendingSyntheticExecutePermissionToolCallIds,
			latestExecuteUpdates: this.latestExecuteUpdates,
			cancelRequestedForExecutePolicySessions:
				this.cancelRequestedForExecutePolicySessions,
		};
	}

	protected getPermissionQueueState(): PermissionQueueState {
		return {
			pendingPermissionRequests: this.pendingPermissionRequests,
			pendingPermissionQueue: this.pendingPermissionQueue,
		};
	}

	protected cancelPendingPermissionRequests(): void {
		cancelPendingPermissionRequestsOperation({
			state: this.getPermissionQueueState(),
			logger: this.logger,
			sessionUpdateCallback: this.sessionUpdateCallback,
		});
	}

	async listSessions(
		cwd?: string,
		cursor?: string,
	): Promise<ListSessionsResult> {
		return await listSessionsViaBridge({
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
		this.bindSession(sessionId);
		return await loadSessionViaBridge({
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
		this.bindSession(sessionId);
		return await resumeSessionViaBridge({
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
		const result = await forkSessionViaBridge({
			connection: this.connection,
			logger: this.logger,
			windowsWslMode: this.plugin.settings.windowsWslMode,
			sessionId,
			cwd,
		});
		this.bindSession(result.sessionId);
		return result;
	}
}
