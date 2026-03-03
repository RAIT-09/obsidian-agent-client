import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeManager } from "../src/adapters/acp/agent-runtime-manager";
import type { SessionHandler } from "../src/adapters/acp/runtime-multiplexer";
import { RuntimeMultiplexer } from "../src/adapters/acp/runtime-multiplexer";
import type { AgentConfig } from "../src/domain/ports/agent-client.port";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("../src/shared/logger", () => ({
	getLogger: () => ({
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

const mockInitResult = {
	protocolVersion: 1,
	authMethods: [],
	promptCapabilities: { image: false, audio: false, embeddedContext: false },
	agentCapabilities: {},
};

vi.mock("../src/adapters/acp/process-lifecycle", () => ({
	initializeOperation: vi.fn().mockImplementation(async () => ({
		connection: { initialize: vi.fn() },
		agentProcess: { pid: 1234, kill: vi.fn() },
		initializeResult: mockInitResult,
	})),
}));

vi.mock("../src/adapters/acp/error-diagnostics", () => ({
	getSpawnErrorInfo: vi.fn(),
	getCommandNotFoundSuggestion: vi.fn(),
}));

function makeConfig(id: string): AgentConfig {
	return {
		id,
		displayName: `Agent ${id}`,
		command: `/usr/bin/${id}`,
		args: [],
		workingDirectory: "/tmp",
	};
}

const defaultInitArgs = {
	pluginVersion: "0.1.0",
	windowsWslMode: false,
	nodePath: "",
	terminalCapabilityEnabled: false,
};

// ── RuntimeMultiplexer ─────────────────────────────────────────────────

describe("RuntimeMultiplexer", () => {
	let multiplexer: RuntimeMultiplexer;

	beforeEach(() => {
		multiplexer = new RuntimeMultiplexer();
	});

	it("routes sessionUpdate to the correct handler", async () => {
		const handler: SessionHandler = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};

		multiplexer.registerSession("session-A", handler);

		await multiplexer.sessionUpdate({
			sessionId: "session-A",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hi" },
			},
		} as never);

		expect(handler.sessionUpdate).toHaveBeenCalledTimes(1);
	});

	it("does not route to unrelated sessions", async () => {
		const handlerA: SessionHandler = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};
		const handlerB: SessionHandler = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};

		multiplexer.registerSession("session-A", handlerA);
		multiplexer.registerSession("session-B", handlerB);

		await multiplexer.sessionUpdate({
			sessionId: "session-B",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hello" },
			},
		} as never);

		expect(handlerA.sessionUpdate).not.toHaveBeenCalled();
		expect(handlerB.sessionUpdate).toHaveBeenCalledTimes(1);
	});

	it("cancels permission requests for unknown sessions", async () => {
		const result = await multiplexer.requestPermission({
			sessionId: "unknown",
			options: [],
			toolCall: {} as never,
		});

		expect(result).toEqual({ outcome: { outcome: "cancelled" } });
	});

	it("broadcasts errors to all registered handlers", () => {
		const handlerA: SessionHandler = {
			sessionUpdate: vi.fn(),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};
		const handlerB: SessionHandler = {
			sessionUpdate: vi.fn(),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};

		multiplexer.registerSession("s1", handlerA);
		multiplexer.registerSession("s2", handlerB);

		const error = {
			type: "process_crashed" as const,
			agentId: "claude",
			title: "Crashed",
			message: "Process died",
		};
		multiplexer.broadcastError(error);

		expect(handlerA.handleProcessError).toHaveBeenCalledWith(error);
		expect(handlerB.handleProcessError).toHaveBeenCalledWith(error);
	});

	it("unregisters sessions correctly", async () => {
		const handler: SessionHandler = {
			sessionUpdate: vi.fn().mockResolvedValue(undefined),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};

		multiplexer.registerSession("session-A", handler);
		multiplexer.unregisterSession("session-A");

		await multiplexer.sessionUpdate({
			sessionId: "session-A",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hi" },
			},
		} as never);

		expect(handler.sessionUpdate).not.toHaveBeenCalled();
	});

	it("tracks session count", () => {
		const handler: SessionHandler = {
			sessionUpdate: vi.fn(),
			requestPermission: vi.fn(),
			createTerminal: vi.fn(),
			terminalOutput: vi.fn(),
			waitForTerminalExit: vi.fn(),
			killTerminal: vi.fn(),
			releaseTerminal: vi.fn(),
			handleProcessError: vi.fn(),
			handleStderrData: vi.fn(),
		};

		expect(multiplexer.sessionCount).toBe(0);
		multiplexer.registerSession("s1", handler);
		expect(multiplexer.sessionCount).toBe(1);
		multiplexer.registerSession("s2", handler);
		expect(multiplexer.sessionCount).toBe(2);
		multiplexer.unregisterSession("s1");
		expect(multiplexer.sessionCount).toBe(1);
		multiplexer.clear();
		expect(multiplexer.sessionCount).toBe(0);
	});

	it("rejects ACP fs/read_text_file when capability is disabled", async () => {
		await expect(
			multiplexer.readTextFile({
				sessionId: "s1",
				path: "notes/a.md",
			} as never),
		).rejects.toThrow(/fs\/read_text_file is disabled/i);
	});

	it("rejects ACP fs/write_text_file when capability is disabled", async () => {
		await expect(
			multiplexer.writeTextFile({
				sessionId: "s1",
				path: "notes/a.md",
				content: "x",
			} as never),
		).rejects.toThrow(/fs\/write_text_file is disabled/i);
	});
});

// ── AgentRuntimeManager ────────────────────────────────────────────────

describe("AgentRuntimeManager", () => {
	let manager: AgentRuntimeManager;

	beforeEach(() => {
		manager = new AgentRuntimeManager();
	});

	it("creates a new runtime on first acquire", async () => {
		const runtime = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);

		expect(runtime.agentId).toBe("claude");
		expect(runtime.refcount).toBe(1);
		expect(manager.hasRuntime("claude")).toBe(true);
	});

	it("reuses existing runtime for the same agent", async () => {
		const first = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);
		const second = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);

		expect(first).toBe(second);
		expect(first.refcount).toBe(2);
	});

	it("creates separate runtimes for different agents", async () => {
		const claude = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);
		const gemini = await manager.acquireRuntime(
			makeConfig("gemini"),
			defaultInitArgs,
		);

		expect(claude).not.toBe(gemini);
		expect(claude.agentId).toBe("claude");
		expect(gemini.agentId).toBe("gemini");
		expect(claude.refcount).toBe(1);
		expect(gemini.refcount).toBe(1);
	});

	it("tears down runtime when refcount reaches zero", async () => {
		const runtime = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);
		const killSpy = runtime.process.kill as ReturnType<typeof vi.fn>;

		manager.releaseRuntime("claude");

		expect(manager.hasRuntime("claude")).toBe(false);
		expect(killSpy).toHaveBeenCalled();
	});

	it("keeps runtime alive while refcount > 0", async () => {
		await manager.acquireRuntime(makeConfig("claude"), defaultInitArgs);
		await manager.acquireRuntime(makeConfig("claude"), defaultInitArgs);

		manager.releaseRuntime("claude");

		expect(manager.hasRuntime("claude")).toBe(true);
		const runtime = manager.getRuntime("claude");
		expect(runtime?.refcount).toBe(1);
	});

	it("force-disconnect tears down regardless of refcount", async () => {
		const runtime = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);
		await manager.acquireRuntime(makeConfig("claude"), defaultInitArgs);
		const killSpy = runtime.process.kill as ReturnType<typeof vi.fn>;

		expect(runtime.refcount).toBe(2);

		manager.forceDisconnectRuntime("claude");

		expect(manager.hasRuntime("claude")).toBe(false);
		expect(killSpy).toHaveBeenCalled();
	});

	it("disconnectAll tears down all runtimes", async () => {
		const claude = await manager.acquireRuntime(
			makeConfig("claude"),
			defaultInitArgs,
		);
		const gemini = await manager.acquireRuntime(
			makeConfig("gemini"),
			defaultInitArgs,
		);

		manager.disconnectAll();

		expect(manager.hasRuntime("claude")).toBe(false);
		expect(manager.hasRuntime("gemini")).toBe(false);
		expect(claude.process.kill).toHaveBeenCalled();
		expect(gemini.process.kill).toHaveBeenCalled();
	});

	it("releaseRuntime is safe for unknown agentId", () => {
		expect(() => manager.releaseRuntime("nonexistent")).not.toThrow();
	});

	it("forceDisconnectRuntime is safe for unknown agentId", () => {
		expect(() => manager.forceDisconnectRuntime("nonexistent")).not.toThrow();
	});
});
