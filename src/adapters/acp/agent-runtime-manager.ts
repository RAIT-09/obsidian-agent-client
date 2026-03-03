import { ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";

import type {
	AgentConfig,
	InitializeResult,
} from "../../domain/ports/agent-client.port";
import type { ProcessError } from "../../domain/models/agent-error";
import { getLogger, type Logger } from "../../shared/logger";
import { RuntimeMultiplexer } from "./runtime-multiplexer";
import { initializeOperation } from "./process-lifecycle";
import {
	getSpawnErrorInfo,
	getCommandNotFoundSuggestion,
} from "./error-diagnostics";

export interface AgentRuntime {
	readonly agentId: string;
	readonly process: ChildProcess;
	readonly connection: acp.ClientSideConnection;
	readonly initResult: InitializeResult;
	readonly config: AgentConfig;
	readonly multiplexer: RuntimeMultiplexer;
	refcount: number;
}

export interface RuntimeInitArgs {
	pluginVersion: string;
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	nodePath: string;
	allowTerminalCommands: boolean;
}

/**
 * Manages one shared ACP runtime per agent.
 *
 * Multiple tabs using the same agent share a single process + connection.
 * Each tab creates its own ACP session via `newSession` on the shared
 * connection. The runtime is torn down when the last tab releases it
 * (refcount → 0) or on plugin unload.
 *
 * Concurrent `acquireRuntime` calls for the same agent are coalesced
 * via promise memoization to avoid double-spawning.
 */
export class AgentRuntimeManager {
	private runtimes = new Map<string, AgentRuntime>();
	private initPromises = new Map<string, Promise<AgentRuntime>>();
	private logger: Logger;

	constructor() {
		this.logger = getLogger();
	}

	/**
	 * Acquire a shared runtime for the given agent.
	 * Increments refcount if already running; spawns a new process otherwise.
	 */
	async acquireRuntime(
		config: AgentConfig,
		initArgs: RuntimeInitArgs,
	): Promise<AgentRuntime> {
		const agentId = config.id;

		const existing = this.runtimes.get(agentId);
		if (existing) {
			existing.refcount++;
			this.logger.log(
				`[RuntimeManager] Reusing runtime for ${agentId} (refcount → ${existing.refcount})`,
			);
			return existing;
		}

		const pending = this.initPromises.get(agentId);
		if (pending) {
			this.logger.log(
				`[RuntimeManager] Waiting for in-flight init of ${agentId}`,
			);
			const runtime = await pending;
			runtime.refcount++;
			return runtime;
		}

		const promise = this.createRuntime(config, initArgs);
		this.initPromises.set(agentId, promise);
		try {
			const runtime = await promise;
			this.runtimes.set(agentId, runtime);
			return runtime;
		} catch (error) {
			this.logger.error(
				`[RuntimeManager] Failed to create runtime for ${agentId}:`,
				error,
			);
			throw error;
		} finally {
			this.initPromises.delete(agentId);
		}
	}

	/**
	 * Decrement refcount. Tears down the runtime when it reaches zero.
	 */
	releaseRuntime(agentId: string): void {
		const runtime = this.runtimes.get(agentId);
		if (!runtime) return;

		runtime.refcount--;
		this.logger.log(
			`[RuntimeManager] Released ${agentId} (refcount → ${runtime.refcount})`,
		);

		if (runtime.refcount <= 0) {
			this.teardownRuntime(runtime);
			this.runtimes.delete(agentId);
		}
	}

	/**
	 * Force-kill the runtime regardless of refcount.
	 * Used by "restart agent" to ensure a fresh process on next acquire.
	 */
	forceDisconnectRuntime(agentId: string): void {
		const runtime = this.runtimes.get(agentId);
		if (!runtime) return;

		this.logger.log(
			`[RuntimeManager] Force-disconnecting runtime for ${agentId} (refcount was ${runtime.refcount})`,
		);
		this.teardownRuntime(runtime);
		this.runtimes.delete(agentId);
	}

	/** Tear down all runtimes. Called on plugin unload / Obsidian quit. */
	disconnectAll(): void {
		for (const runtime of this.runtimes.values()) {
			this.teardownRuntime(runtime);
		}
		this.runtimes.clear();
	}

	/** Check whether a live runtime exists for the given agent. */
	hasRuntime(agentId: string): boolean {
		return this.runtimes.has(agentId);
	}

	getRuntime(agentId: string): AgentRuntime | undefined {
		return this.runtimes.get(agentId);
	}

	// ── internal ───────────────────────────────────────────────────────

	private async createRuntime(
		config: AgentConfig,
		initArgs: RuntimeInitArgs,
	): Promise<AgentRuntime> {
		const multiplexer = new RuntimeMultiplexer();

		this.logger.log(
			`[RuntimeManager] Spawning new runtime for ${config.id} (${config.displayName})`,
		);

		const initialized = await initializeOperation({
			config,
			logger: this.logger,
			pluginVersion: initArgs.pluginVersion,
			windowsWslMode: initArgs.windowsWslMode,
			windowsWslDistribution: initArgs.windowsWslDistribution,
			nodePath: initArgs.nodePath,
			allowTerminalCommands: initArgs.allowTerminalCommands,
			onError: (error: ProcessError) => {
				multiplexer.broadcastError(error);
			},
			clientFactory: (stream) =>
				new acp.ClientSideConnection(() => multiplexer, stream),
			onStderrData: (chunk: string) => {
				multiplexer.broadcastStderrData(chunk);
			},
			getErrorInfo: (error, command, agentLabel) =>
				getSpawnErrorInfo(error, command, agentLabel),
			getCommandNotFoundSuggestion: (command) =>
				getCommandNotFoundSuggestion(command),
		});

		return {
			agentId: config.id,
			process: initialized.agentProcess,
			connection: initialized.connection,
			initResult: initialized.initializeResult,
			config,
			multiplexer,
			refcount: 1,
		};
	}

	private teardownRuntime(runtime: AgentRuntime): void {
		this.logger.log(
			`[RuntimeManager] Tearing down runtime for ${runtime.agentId}`,
		);
		try {
			runtime.process?.kill();
		} catch {
			// Process may already be dead
		}
		runtime.multiplexer.clear();
	}
}
