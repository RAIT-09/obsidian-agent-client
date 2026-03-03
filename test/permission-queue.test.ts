import { describe, expect, it, vi } from "vitest";
import {
	handlePermissionResponseOperation,
	type PermissionQueueState,
	requestPermissionOperation,
} from "../src/adapters/acp/permission-queue";
import type { SessionUpdate } from "../src/domain/models/session-update";

function createState(): PermissionQueueState {
	return {
		pendingPermissionRequests: new Map(),
		pendingPermissionQueue: [],
	};
}

const logger = {
	log: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as const;

describe("permission-queue terminal policy", () => {
	it("queues non-terminal permission requests for manual selection", async () => {
		const state = createState();
		const updateMessage = vi.fn();
		const promise = requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc1",
					kind: "read",
					title: "Read note",
					rawInput: { path: "notes/a.md" },
				},
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject", name: "Reject once", kind: "reject_once" },
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "prompt_once",
			state,
			updateMessage,
			sessionUpdateCallback: null,
		});

		await Promise.resolve();
		expect(state.pendingPermissionRequests.size).toBe(1);

		const requestId = [...state.pendingPermissionRequests.keys()][0];
		handlePermissionResponseOperation({
			state,
			requestId,
			optionId: "allow",
			updateMessage,
		});

		const response = await promise;
		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "allow",
		});
	});

	it("keeps terminal permission requests pending in prompt_once mode", async () => {
		const state = createState();
		const updateMessage = vi.fn();
		const sessionUpdateCallback = vi.fn();
		const promise = requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-exec",
					kind: "execute",
					title: "Run command",
					rawInput: { command: "rm notes/a.md" },
				},
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject", name: "Reject once", kind: "reject_once" },
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "prompt_once",
			state,
			updateMessage,
			sessionUpdateCallback,
		});

		let settled = false;
		void promise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(state.pendingPermissionRequests.size).toBe(1);

		const requestId = [...state.pendingPermissionRequests.keys()][0];
		handlePermissionResponseOperation({
			state,
			requestId,
			optionId: "allow",
			updateMessage,
		});

		const response = await promise;
		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "allow",
		});
	});

	it("auto-denies terminal permission requests when mode is disabled", async () => {
		const state = createState();
		const response = await requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-exec",
					kind: "execute",
					title: "Run command",
					rawInput: { command: "rm notes/a.md" },
				},
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject", name: "Reject once", kind: "reject_once" },
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "disabled",
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: null,
		});

		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "reject",
		});
		expect(state.pendingPermissionRequests.size).toBe(0);
	});

	it("preserves reject_always option kind in emitted permission request", async () => {
		const state = createState();
		let capturedUpdate: SessionUpdate | undefined;
		const promise = requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-reject",
					kind: "read",
					title: "Read note",
					rawInput: { path: "notes/a.md" },
				},
				options: [
					{
						optionId: "reject-always",
						name: "Reject always",
						kind: "reject_always",
					},
					{ optionId: "reject-once", name: "Reject once", kind: "reject_once" },
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "prompt_once",
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: (update) => {
				capturedUpdate = update;
			},
		});

		await Promise.resolve();
		expect(capturedUpdate).toBeDefined();
		if (!capturedUpdate) {
			throw new Error("Expected session update callback payload");
		}
		if (
			capturedUpdate.type !== "tool_call" ||
			!capturedUpdate.permissionRequest
		) {
			throw new Error("Expected tool_call update with permissionRequest");
		}
		expect(capturedUpdate.permissionRequest.options).toEqual([
			{
				optionId: "reject-always",
				name: "Reject always",
				kind: "reject_always",
			},
			{
				optionId: "reject-once",
				name: "Reject once",
				kind: "reject_once",
			},
		]);

		const requestId = [...state.pendingPermissionRequests.keys()][0];
		handlePermissionResponseOperation({
			state,
			requestId,
			optionId: "reject-always",
			updateMessage: vi.fn(),
		});

		const response = await promise;
		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "reject-always",
		});
	});

	it("auto-selects allow for terminal permission requests when mode is always_allow", async () => {
		const state = createState();
		const response = await requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-exec-allow",
					kind: "execute",
					title: "Run command",
					rawInput: { command: "echo hi" },
				},
				options: [
					{
						optionId: "allow-always",
						name: "Allow always",
						kind: "allow_always",
					},
					{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
					{
						optionId: "reject-once",
						name: "Reject once",
						kind: "reject_once",
					},
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "always_allow",
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: null,
		});

		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "allow-always",
		});
		expect(state.pendingPermissionRequests.size).toBe(0);
	});

	it("auto-selects reject for terminal permission requests when mode is always_deny", async () => {
		const state = createState();
		const response = await requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-exec-deny",
					kind: "execute",
					title: "Run command",
					rawInput: { command: "echo hi" },
				},
				options: [
					{
						optionId: "allow-once",
						name: "Allow once",
						kind: "allow_once",
					},
					{
						optionId: "reject-always",
						name: "Reject always",
						kind: "reject_always",
					},
					{
						optionId: "reject-once",
						name: "Reject once",
						kind: "reject_once",
					},
				],
			} as never,
			logger: logger as never,
			terminalPermissionMode: "always_deny",
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: null,
		});

		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "reject-always",
		});
		expect(state.pendingPermissionRequests.size).toBe(0);
	});

	it("passes selected optionId through unchanged for all ACP kinds", async () => {
		const kinds = [
			"allow_once",
			"allow_always",
			"reject_once",
			"reject_always",
		] as const;

		for (const kind of kinds) {
			const state = createState();
			const optionId = `option-${kind}`;
			const promise = requestPermissionOperation({
				params: {
					sessionId: "s1",
					toolCall: {
						toolCallId: `tc-${kind}`,
						kind: "read",
						title: "Read note",
						rawInput: { path: "notes/a.md" },
					},
					options: [{ optionId, name: kind, kind }],
				} as never,
				logger: logger as never,
				terminalPermissionMode: "prompt_once",
				state,
				updateMessage: vi.fn(),
				sessionUpdateCallback: vi.fn(),
			});

			await Promise.resolve();
			const requestId = [...state.pendingPermissionRequests.keys()][0];
			handlePermissionResponseOperation({
				state,
				requestId,
				optionId,
				updateMessage: vi.fn(),
			});

			const response = await promise;
			expect(response.outcome).toEqual({
				outcome: "selected",
				optionId,
			});
		}
	});
});
