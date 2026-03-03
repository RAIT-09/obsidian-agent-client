import * as acp from "@agentclientprotocol/sdk";

import type {
	AgentConfig,
	IAgentClient,
	InitializeResult,
	NewSessionResult,
} from "../../domain/ports/agent-client.port";
import type { PromptContent } from "../../domain/models/prompt-content";
import type AgentClientPlugin from "../../plugin";
import { extractStderrErrorHint } from "./error-diagnostics";
import {
	authenticateOperation,
	cancelOperation,
	newSessionOperation,
	sendPromptOperation,
	setSessionModeOperation,
	setSessionModelOperation,
} from "./runtime-ops";
import { requestPermissionOperation } from "./permission-queue";
import {
	handleExecuteToolCallPolicy as handleExecuteToolCallPolicyOperation,
	recordTerminalPermissionDecision as recordTerminalPermissionDecisionOperation,
	withExecutionPolicyPrompt as withExecutionPolicyPromptOperation,
} from "./execute-policy";
import { routeSessionUpdate } from "./update-routing";
import { AcpAdapterBase } from "./acp.adapter-base";
import type { SessionHandler } from "./runtime-multiplexer";

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
export class AcpAdapter
	extends AcpAdapterBase
	implements IAgentClient, SessionHandler
{
	constructor(plugin: AgentClientPlugin) {
		super(plugin);
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		this.logger.log(
			"[AcpAdapter] Starting initialization with config:",
			config,
		);
		this.unbindCurrentSession();
		this.releaseCurrentRuntime();
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
		this.bindSession(result.sessionId);
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
		const policyContent = withExecutionPolicyPromptOperation(
			content,
			this.getTerminalPermissionMode(),
		);
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
		this.unbindCurrentSession();
		this.releaseCurrentRuntime();
		this.currentConfig = null;
		this.isInitializedFlag = false;
		this.currentAgentId = null;
		this.clearExecutePolicyTracking();
		return Promise.resolve();
	}

	forceDisconnectRuntime(): void {
		if (this.currentAgentId) {
			this.runtimeManager.forceDisconnectRuntime(this.currentAgentId);
		}
		this.runtime = null;
		this.isInitializedFlag = false;
		this.clearExecutePolicyTracking();
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

	sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const update = params.update;
		const sessionId = params.sessionId;
		this.promptSessionUpdateCount++;
		this.logger.log("[AcpAdapter] sessionUpdate:", { sessionId, update });

		if (
			handleExecuteToolCallPolicyOperation({
				update,
				sessionId,
				state: this.getExecutePolicyState(),
				permissionState: this.getPermissionQueueState(),
				terminalPermissionMode: this.getTerminalPermissionMode(),
				logger: this.logger,
				connection: this.connection,
				sessionUpdateCallback: this.sessionUpdateCallback,
				cancelSession: async (targetSessionId: string) => {
					await this.cancel(targetSessionId);
				},
			})
		) {
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
			state: this.getPermissionQueueState(),
			sessionUpdateCallback: this.sessionUpdateCallback,
		});
		recordTerminalPermissionDecisionOperation({
			params,
			response,
			state: this.getExecutePolicyState(),
		});
		return response;
	}

	private extractStderrErrorHint(): string | null {
		return extractStderrErrorHint(this.recentStderr);
	}
}
