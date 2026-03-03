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
import { AcpTypeConverter } from "./acp-type-converter";
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
	type TerminalPermissionMode,
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
	private blockedExecuteToolCallIds = new Set<string>();
	private grantedExecuteToolCallIds = new Set<string>();
	private rejectedExecuteToolCallIds = new Set<string>();
	private pendingSyntheticExecutePermissionToolCallIds = new Set<string>();
	private latestExecuteUpdates = new Map<
		string,
		{
			sessionId: string;
			update: Extract<
				acp.SessionUpdate,
				{ sessionUpdate: "tool_call" | "tool_call_update" }
			>;
		}
	>();
	private cancelRequestedForExecutePolicySessions = new Set<string>();

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

		try {
			const runtime = await this.runtimeManager.acquireRuntime(config, {
				pluginVersion: this.plugin.manifest.version,
				windowsWslMode: this.plugin.settings.windowsWslMode,
				windowsWslDistribution: this.plugin.settings.windowsWslDistribution,
				nodePath: this.plugin.settings.nodePath,
				terminalCapabilityEnabled:
					this.getTerminalPermissionMode() !== "disabled",
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
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

	async sendPrompt(sessionId: string, content: PromptContent[]): Promise<void> {
		const policyContent = this.withExecutionPolicyPrompt(content);
		await sendPromptOperation({
			connection: this.connection,
			logger: this.logger,
			sessionId,
			content: policyContent,
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
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

		if (this.handleExecuteToolCallPolicy(update, sessionId)) {
			return Promise.resolve();
		}

		if (this.sessionUpdateCallback) {
			routeSessionUpdate(update, sessionId, this.sessionUpdateCallback);
		}
		return Promise.resolve();
	}

	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		const response = await requestPermissionOperation({
			params,
			logger: this.logger,
			terminalPermissionMode: this.plugin.settings.terminalPermissionMode,
			state: {
				pendingPermissionRequests: this.pendingPermissionRequests,
				pendingPermissionQueue: this.pendingPermissionQueue,
			},
			updateMessage: this.updateMessage,
			sessionUpdateCallback: this.sessionUpdateCallback,
		});

		this.recordTerminalPermissionDecision(params, response);
		return response;
	}

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		this.ensureTerminalEnabled();
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
		this.ensureTerminalEnabled();
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
		this.ensureTerminalEnabled();
		return await waitForTerminalExitOperation({
			params,
			terminalManager: this.terminalManager,
		});
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		this.ensureTerminalEnabled();
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
		this.ensureTerminalEnabled();
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

	private ensureTerminalEnabled(): void {
		if (this.getTerminalPermissionMode() === "disabled") {
			throw new Error(
				"Terminal methods are disabled by client settings (terminalPermissionMode=disabled).",
			);
		}
	}

	private withExecutionPolicyPrompt(content: PromptContent[]): PromptContent[] {
		const mode = this.getTerminalPermissionMode();
		const policy =
			mode === "disabled"
				? "Client policy: terminal/command execution is disabled. Do not use execute/shell/terminal tools. Use Obsidian file-editing tools only."
				: `Client policy: terminal/command execution is enabled. Permission mode is "${mode}". ${
						mode === "prompt_once"
							? "Request ACP session/request_permission before execute/shell/terminal calls so the user can allow or deny each command."
							: mode === "always_allow"
								? "Terminal permission requests are auto-approved by client settings."
								: "Terminal permission requests are auto-denied by client settings; do not execute commands."
					}`;
		const next = [...content];
		const textIndex = next.findIndex((item) => item.type === "text");
		if (textIndex >= 0) {
			const block = next[textIndex];
			if (block.type === "text") {
				next[textIndex] = {
					type: "text",
					text: `${policy}\n\n${block.text}`,
				};
			}
			return next;
		}

		return [{ type: "text", text: policy }, ...next];
	}

	private handleExecuteToolCallPolicy(
		update: acp.SessionUpdate,
		sessionId: string,
	): boolean {
		if (
			update.sessionUpdate !== "tool_call" &&
			update.sessionUpdate !== "tool_call_update"
		) {
			return false;
		}

		const toolCallId = update.toolCallId;
		const wasBlocked = this.blockedExecuteToolCallIds.has(toolCallId);
		const isExecute =
			update.kind === "execute" ||
			wasBlocked ||
			this.grantedExecuteToolCallIds.has(toolCallId) ||
			this.rejectedExecuteToolCallIds.has(toolCallId) ||
			this.pendingSyntheticExecutePermissionToolCallIds.has(toolCallId);
		if (!isExecute) {
			return false;
		}
		this.latestExecuteUpdates.set(toolCallId, {
			sessionId,
			update,
		});

		if (wasBlocked) {
			this.blockExecuteToolCallByPolicy({
				update,
				sessionId,
				reason: "already blocked by client policy",
				wasBlocked,
			});
			return true;
		}

		if (this.getTerminalPermissionMode() === "disabled") {
			this.blockExecuteToolCallByPolicy({
				update,
				sessionId,
				reason: "terminal permission mode is disabled",
				wasBlocked,
			});
			return true;
		}

		const terminalPermissionMode = this.getTerminalPermissionMode();
		if (terminalPermissionMode === "always_deny") {
			this.blockExecuteToolCallByPolicy({
				update,
				sessionId,
				reason: "terminal permission mode is always deny",
				wasBlocked,
			});
			return true;
		}

		if (terminalPermissionMode === "prompt_once") {
			if (this.rejectedExecuteToolCallIds.has(toolCallId)) {
				this.blockExecuteToolCallByPolicy({
					update,
					sessionId,
					reason: "execute permission denied by user",
					wasBlocked,
				});
				return true;
			}

			if (this.grantedExecuteToolCallIds.has(toolCallId)) {
				if (this.isToolCallStatusFinal(update.status)) {
					this.grantedExecuteToolCallIds.delete(toolCallId);
					this.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
					this.latestExecuteUpdates.delete(toolCallId);
				}
				return false;
			}

			this.ensureSyntheticExecutePermissionRequest({
				toolCallId,
				sessionId,
				update,
			});
			if (this.isToolCallStatusFinal(update.status)) {
				this.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
				this.latestExecuteUpdates.delete(toolCallId);
			}
			return false;
		}

		return false;
	}

	private blockExecuteToolCallByPolicy(args: {
		update: Extract<
			acp.SessionUpdate,
			{ sessionUpdate: "tool_call" | "tool_call_update" }
		>;
		sessionId: string;
		reason: string;
		wasBlocked: boolean;
	}): void {
		const { update, sessionId, reason, wasBlocked } = args;
		const toolCallId = update.toolCallId;
		this.blockedExecuteToolCallIds.add(toolCallId);
		this.grantedExecuteToolCallIds.delete(toolCallId);
		this.rejectedExecuteToolCallIds.delete(toolCallId);
		this.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
		this.latestExecuteUpdates.delete(toolCallId);
		this.logger.warn("[AcpAdapter] Blocking execute tool call by policy:", {
			sessionId,
			toolCallId,
			reason,
			title: update.title,
			rawInput: update.rawInput,
		});

		if (this.sessionUpdateCallback) {
			this.sessionUpdateCallback({
				type: update.sessionUpdate,
				sessionId,
				toolCallId,
				title: update.title
					? `${update.title} (blocked by client policy: ${reason})`
					: `Command blocked by client policy: ${reason}`,
				status: "failed",
				kind: "execute",
				content: AcpTypeConverter.toToolCallContent(update.content),
				locations: update.locations ?? undefined,
				rawInput: update.rawInput as { [k: string]: unknown } | undefined,
			});
		}

		if (
			!wasBlocked &&
			this.connection &&
			!this.cancelRequestedForExecutePolicySessions.has(sessionId)
		) {
			this.cancelRequestedForExecutePolicySessions.add(sessionId);
			void this.cancel(sessionId)
				.catch((error: unknown) => {
					this.logger.warn(
						`[AcpAdapter] Failed to cancel session after blocked execute tool call (${sessionId}):`,
						error,
					);
				})
				.finally(() => {
					this.cancelRequestedForExecutePolicySessions.delete(sessionId);
				});
		}
	}

	private getTerminalPermissionMode(): TerminalPermissionMode {
		const mode = this.plugin.settings.terminalPermissionMode;
		if (
			mode === "disabled" ||
			mode === "prompt_once" ||
			mode === "always_allow" ||
			mode === "always_deny"
		) {
			return mode;
		}
		return "disabled";
	}

	private getCommandFromRawInput(rawInput: unknown): string | null {
		const input = (rawInput as Record<string, unknown> | undefined) || {};
		if (typeof input.command !== "string") {
			return null;
		}
		const command = input.command.trim();
		return command.length > 0 ? command : null;
	}

	private isTerminalPermissionRequest(
		params: acp.RequestPermissionRequest,
	): boolean {
		const toolCall = params.toolCall;
		if (!toolCall) {
			return false;
		}
		if (toolCall.kind === "execute") {
			return true;
		}

		const command = this.getCommandFromRawInput(toolCall.rawInput);
		if (command) {
			return true;
		}

		const title = toolCall.title?.toLowerCase() || "";
		return /\b(terminal|shell|bash|command)\b/.test(title);
	}

	private recordTerminalPermissionDecision(
		params: acp.RequestPermissionRequest,
		response: acp.RequestPermissionResponse,
	): void {
		if (!this.isTerminalPermissionRequest(params)) {
			return;
		}

		if (response.outcome.outcome !== "selected") {
			return;
		}

		const toolCallId = params.toolCall?.toolCallId;
		if (!toolCallId) {
			return;
		}

		const selectedOptionId =
			"optionId" in response.outcome ? response.outcome.optionId : null;
		if (!selectedOptionId) {
			return;
		}

		const selectedOption = params.options.find(
			(option) => option.optionId === selectedOptionId,
		);
		if (!selectedOption) {
			return;
		}

		if (
			selectedOption.kind === "allow_once" ||
			selectedOption.kind === "allow_always"
		) {
			this.grantedExecuteToolCallIds.add(toolCallId);
			this.rejectedExecuteToolCallIds.delete(toolCallId);
		} else if (
			selectedOption.kind === "reject_once" ||
			selectedOption.kind === "reject_always"
		) {
			this.grantedExecuteToolCallIds.delete(toolCallId);
			this.rejectedExecuteToolCallIds.add(toolCallId);
		}
	}

	private ensureSyntheticExecutePermissionRequest(args: {
		toolCallId: string;
		sessionId: string;
		update: Extract<
			acp.SessionUpdate,
			{ sessionUpdate: "tool_call" | "tool_call_update" }
		>;
	}): void {
		const { toolCallId, sessionId, update } = args;
		if (this.pendingSyntheticExecutePermissionToolCallIds.has(toolCallId)) {
			return;
		}
		this.pendingSyntheticExecutePermissionToolCallIds.add(toolCallId);
		void requestPermissionOperation({
			params: {
				sessionId,
				toolCall: {
					toolCallId,
					title: update.title,
					status: update.status,
					kind: "execute",
					content: update.content,
					locations: update.locations,
					rawInput: update.rawInput,
				},
				options: [
					{
						optionId: `synthetic:${toolCallId}:allow_once`,
						name: "Allow",
						kind: "allow_once",
					},
					{
						optionId: `synthetic:${toolCallId}:reject_once`,
						name: "Deny",
						kind: "reject_once",
					},
				],
			},
			logger: this.logger,
			terminalPermissionMode: "prompt_once",
			state: {
				pendingPermissionRequests: this.pendingPermissionRequests,
				pendingPermissionQueue: this.pendingPermissionQueue,
			},
			updateMessage: this.updateMessage,
			sessionUpdateCallback: this.sessionUpdateCallback,
		})
			.then((response) => {
				this.handleSyntheticExecutePermissionOutcome(toolCallId, response);
			})
			.catch((error: unknown) => {
				this.logger.warn(
					"[AcpAdapter] Synthetic execute permission request failed:",
					{
						toolCallId,
						error,
					},
				);
				const latest = this.latestExecuteUpdates.get(toolCallId);
				if (latest) {
					this.blockExecuteToolCallByPolicy({
						update: latest.update,
						sessionId: latest.sessionId,
						reason: "failed to complete execute permission prompt",
						wasBlocked: false,
					});
				}
			})
			.finally(() => {
				this.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
			});
	}

	private handleSyntheticExecutePermissionOutcome(
		toolCallId: string,
		response: acp.RequestPermissionResponse,
	): void {
		const selectedOptionId =
			response.outcome.outcome === "selected" &&
			"optionId" in response.outcome
				? response.outcome.optionId
				: null;
		const isAllowed =
			selectedOptionId === `synthetic:${toolCallId}:allow_once`;
		if (isAllowed) {
			this.grantedExecuteToolCallIds.add(toolCallId);
			const latest = this.latestExecuteUpdates.get(toolCallId);
			if (latest && this.isToolCallStatusFinal(latest.update.status)) {
				this.grantedExecuteToolCallIds.delete(toolCallId);
				this.pendingSyntheticExecutePermissionToolCallIds.delete(toolCallId);
				this.latestExecuteUpdates.delete(toolCallId);
			}
			return;
		}

		this.rejectedExecuteToolCallIds.add(toolCallId);
		const latest = this.latestExecuteUpdates.get(toolCallId);
		if (latest) {
			this.blockExecuteToolCallByPolicy({
				update: latest.update,
				sessionId: latest.sessionId,
				reason: "execute permission denied by user",
				wasBlocked: false,
			});
		}
	}

	private isToolCallStatusFinal(status: string | null | undefined): boolean {
		return status === "completed" || status === "failed" || status === "cancelled";
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
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
		this.blockedExecuteToolCallIds.clear();
		this.grantedExecuteToolCallIds.clear();
		this.rejectedExecuteToolCallIds.clear();
		this.pendingSyntheticExecutePermissionToolCallIds.clear();
		this.latestExecuteUpdates.clear();
		this.cancelRequestedForExecutePolicySessions.clear();
		this.runtime?.multiplexer.registerSession(result.sessionId, this);

		return result;
	}
}
