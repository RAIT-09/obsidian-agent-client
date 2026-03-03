import { describe, expect, it, vi } from "vitest";
import { AcpAdapter } from "../src/adapters/acp/acp.adapter";
import type { SessionUpdate } from "../src/domain/models/session-update";
import type AgentClientPlugin from "../src/plugin";

vi.mock("../src/shared/logger", () => ({
	getLogger: () => ({
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

function makePlugin(overrides?: {
	terminalPermissionMode?:
		| "disabled"
		| "prompt_once"
		| "always_allow"
		| "always_deny";
}): AgentClientPlugin {
	return {
		settings: {
			terminalPermissionMode:
				overrides?.terminalPermissionMode ?? "prompt_once",
			windowsWslMode: false,
			nodePath: "",
		},
		runtimeManager: {
			releaseRuntime: vi.fn(),
			forceDisconnectRuntime: vi.fn(),
		},
		manifest: { version: "0.0.0-test" },
	} as unknown as AgentClientPlugin;
}

describe("AcpAdapter execute tool call policy", () => {
	it("blocks execute tool calls when terminal mode is disabled", async () => {
		const adapter = new AcpAdapter(
			makePlugin({ terminalPermissionMode: "disabled" }),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-1",
				title: "Delete file",
				status: "completed",
				kind: "execute",
				rawInput: { command: "rm x.md" },
			},
		} as never);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "tool_call",
			sessionId: "s1",
			toolCallId: "tc-exec-1",
			kind: "execute",
			status: "failed",
		});
	});

	it("keeps blocking follow-up updates of the same execute tool call", async () => {
		const adapter = new AcpAdapter(
			makePlugin({ terminalPermissionMode: "disabled" }),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-2",
				title: "Run command",
				status: "pending",
				kind: "execute",
				rawInput: { command: "ls" },
			},
		} as never);

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "tc-exec-2",
				status: "completed",
				title: "Run command",
			},
		} as never);

		expect(updates).toHaveLength(2);
		expect(updates[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "tc-exec-2",
			kind: "execute",
			status: "failed",
		});
		expect(updates[1]).toMatchObject({
			type: "tool_call_update",
			toolCallId: "tc-exec-2",
			kind: "execute",
			status: "failed",
		});
	});

	it("allows execute tool calls when terminal mode is always_allow", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "always_allow",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-rm",
				title: "Run command",
				status: "completed",
				kind: "execute",
				rawInput: { command: "rm x.md" },
			},
		} as never);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "tc-exec-rm",
			kind: "execute",
			status: "completed",
		});
	});

	it("blocks execute tool calls when terminal permission mode is always_deny", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "always_deny",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-deny",
				title: "Run command",
				status: "completed",
				kind: "execute",
				rawInput: { command: "echo ok" },
			},
		} as never);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "tc-exec-deny",
			kind: "execute",
			status: "failed",
		});
	});

	it("shows permission prompt in prompt_once mode when agent skips handshake", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "prompt_once",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-handshake-missing",
				title: "Run command",
				status: "pending",
				kind: "execute",
				rawInput: { command: "echo ok" },
			},
		} as never);
		await Promise.resolve();

		expect(
			updates.some(
				(update) =>
					update.type === "tool_call" &&
					update.toolCallId === "tc-exec-handshake-missing" &&
					update.permissionRequest?.isActive === true,
			),
		).toBe(true);
	});

	it("keeps execute updates flowing after synthetic allow_once approval", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "prompt_once",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-synth-allow",
				title: "Run command",
				status: "pending",
				kind: "execute",
				rawInput: { command: "echo ok" },
			},
		} as never);
		await Promise.resolve();

		const permissionRequest = updates
			.filter(
				(update): update is Extract<SessionUpdate, { type: "tool_call" }> =>
					update.type === "tool_call" &&
					update.toolCallId === "tc-exec-synth-allow",
			)
			.map((update) => update.permissionRequest)
			.find((request) => request?.isActive);
		expect(permissionRequest?.isActive).toBe(true);
		const allowOptionId = permissionRequest?.options.find(
			(option) => option.kind === "allow_once",
		)?.optionId;
		expect(allowOptionId).toBeTruthy();
		if (!permissionRequest || !allowOptionId) {
			throw new Error("Missing synthetic permission prompt options");
		}

		(
			adapter as unknown as {
				handlePermissionResponse: (requestId: string, optionId: string) => void;
			}
		).handlePermissionResponse(permissionRequest.requestId, allowOptionId);
		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "tc-exec-synth-allow",
				title: "Run command",
				status: "completed",
			},
		} as never);

		expect(
			updates.some(
				(update) =>
					update.type === "tool_call_update" &&
					update.toolCallId === "tc-exec-synth-allow" &&
					update.status === "completed",
			),
		).toBe(true);
	});

	it("allows non-destructive execute after explicit prompt_once permission grant", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "prompt_once",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		const permissionPromise = adapter.requestPermission({
			sessionId: "s1",
			toolCall: {
				toolCallId: "tc-exec-ok",
				kind: "execute",
				title: "Run command",
				rawInput: { command: "echo ok" },
			},
			options: [
				{
					optionId: "allow-once",
					name: "Allow once",
					kind: "allow_once",
				},
				{
					optionId: "reject-once",
					name: "Reject once",
					kind: "reject_once",
				},
			],
		} as never);

		await Promise.resolve();
		const requestId = [
			...(
				adapter as unknown as {
					pendingPermissionRequests: Map<string, unknown>;
				}
			).pendingPermissionRequests.keys(),
		][0];
		(
			adapter as unknown as {
				handlePermissionResponse: (requestId: string, optionId: string) => void;
			}
		).handlePermissionResponse(requestId, "allow-once");
		await permissionPromise;

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-ok",
				title: "Run command",
				status: "completed",
				kind: "execute",
				rawInput: { command: "echo ok" },
			},
		} as never);

		expect(
			updates.some(
				(update) =>
					update.type === "tool_call" &&
					update.toolCallId === "tc-exec-ok" &&
					update.status === "completed",
			),
		).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.type === "tool_call" &&
					update.toolCallId === "tc-exec-ok" &&
					update.status === "failed",
			),
		).toBe(false);
	});

	it("blocks execute tool calls in prompt_once mode after explicit deny", async () => {
		const adapter = new AcpAdapter(
			makePlugin({
				terminalPermissionMode: "prompt_once",
			}),
		);
		const updates: SessionUpdate[] = [];
		adapter.onSessionUpdate((update) => {
			updates.push(update);
		});

		const permissionPromise = adapter.requestPermission({
			sessionId: "s1",
			toolCall: {
				toolCallId: "tc-exec-denied",
				kind: "execute",
				title: "Run command",
				rawInput: { command: "echo denied" },
			},
			options: [
				{
					optionId: "allow-once",
					name: "Allow once",
					kind: "allow_once",
				},
				{
					optionId: "reject-once",
					name: "Reject once",
					kind: "reject_once",
				},
			],
		} as never);

		await Promise.resolve();
		const requestId = [
			...(
				adapter as unknown as {
					pendingPermissionRequests: Map<string, unknown>;
				}
			).pendingPermissionRequests.keys(),
		][0];
		(
			adapter as unknown as {
				handlePermissionResponse: (requestId: string, optionId: string) => void;
			}
		).handlePermissionResponse(requestId, "reject-once");
		await permissionPromise;

		await adapter.sessionUpdate({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tc-exec-denied",
				title: "Run command",
				status: "completed",
				kind: "execute",
				rawInput: { command: "echo denied" },
			},
		} as never);

		expect(
			updates.some(
				(update) =>
					update.type === "tool_call" &&
					update.toolCallId === "tc-exec-denied" &&
					update.status === "failed",
			),
		).toBe(true);
	});
});
