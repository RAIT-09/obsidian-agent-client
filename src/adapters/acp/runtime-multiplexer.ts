import * as acp from "@agentclientprotocol/sdk";

import type { ProcessError } from "../../domain/models/agent-error";
import { getLogger } from "../../shared/logger";

/**
 * Per-session handler interface.
 *
 * Each AcpAdapter registers itself for its sessionId so the multiplexer
 * can route incoming ACP events to the correct tab.
 */
export interface SessionHandler {
	sessionUpdate(params: acp.SessionNotification): Promise<void>;
	requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse>;
	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse>;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
	waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse>;
	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse>;
	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse>;
	handleProcessError(error: ProcessError): void;
	handleStderrData(chunk: string): void;
}

/**
 * Routes ACP Client callbacks to the correct per-session AcpAdapter.
 *
 * One multiplexer exists per shared agent runtime. The ACP connection
 * calls methods on this object; the multiplexer looks up the registered
 * adapter by `params.sessionId` and forwards the call.
 */
export class RuntimeMultiplexer implements acp.Client {
	private sessionHandlers = new Map<string, SessionHandler>();
	private logger = getLogger();

	registerSession(sessionId: string, handler: SessionHandler): void {
		this.sessionHandlers.set(sessionId, handler);
	}

	unregisterSession(sessionId: string): void {
		this.sessionHandlers.delete(sessionId);
	}

	broadcastError(error: ProcessError): void {
		for (const handler of this.sessionHandlers.values()) {
			handler.handleProcessError(error);
		}
	}

	broadcastStderrData(chunk: string): void {
		for (const handler of this.sessionHandlers.values()) {
			handler.handleStderrData(chunk);
		}
	}

	get sessionCount(): number {
		return this.sessionHandlers.size;
	}

	clear(): void {
		this.sessionHandlers.clear();
	}

	// ── acp.Client implementation ──────────────────────────────────────

	async sessionUpdate(params: acp.SessionNotification): Promise<void> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			await handler.sessionUpdate(params);
			return;
		}
		this.logger.log(
			`[RuntimeMultiplexer] No handler for session ${params.sessionId} (sessionUpdate)`,
		);
	}

	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return await handler.requestPermission(params);
		}
		this.logger.log(
			`[RuntimeMultiplexer] No handler for session ${params.sessionId} (requestPermission) — cancelling`,
		);
		return { outcome: { outcome: "cancelled" } };
	}

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return handler.createTerminal(params);
		}
		throw new Error(
			`No handler for session ${params.sessionId} (createTerminal)`,
		);
	}

	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return handler.terminalOutput(params);
		}
		throw new Error(
			`No handler for session ${params.sessionId} (terminalOutput)`,
		);
	}

	waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return handler.waitForTerminalExit(params);
		}
		throw new Error(
			`No handler for session ${params.sessionId} (waitForTerminalExit)`,
		);
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return handler.killTerminal(params);
		}
		throw new Error(
			`No handler for session ${params.sessionId} (killTerminal)`,
		);
	}

	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		const handler = this.sessionHandlers.get(params.sessionId);
		if (handler) {
			return handler.releaseTerminal(params);
		}
		throw new Error(
			`No handler for session ${params.sessionId} (releaseTerminal)`,
		);
	}

	readTextFile(_params: acp.ReadTextFileRequest) {
		return Promise.reject(
			new Error(
				"fs/read_text_file is disabled by client capabilities (vault-only policy).",
			),
		);
	}

	writeTextFile(_params: acp.WriteTextFileRequest) {
		return Promise.reject(
			new Error(
				"fs/write_text_file is disabled by client capabilities (vault-only policy).",
			),
		);
	}
}
