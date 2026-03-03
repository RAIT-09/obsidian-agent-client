import { describe, expect, it, vi } from "vitest";
import {
	handlePermissionResponseOperation,
	requestPermissionOperation,
	type PermissionQueueState,
} from "../src/adapters/acp/permission-queue";

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
	it("auto-allows non-terminal permission requests when enabled", async () => {
		const state = createState();

		const response = await requestPermissionOperation({
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
			autoAllowPermissions: true,
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: null,
		});

		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "allow",
		});
	});

	it("auto-allow prefers allow_once when allow_always appears first", async () => {
		const state = createState();
		const response = await requestPermissionOperation({
			params: {
				sessionId: "s1",
				toolCall: {
					toolCallId: "tc-pref",
					kind: "read",
					title: "Read note",
					rawInput: { path: "notes/a.md" },
				},
				options: [
					{
						optionId: "allow-always",
						name: "Allow always",
						kind: "allow_always",
					},
					{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject", name: "Reject once", kind: "reject_once" },
				],
			} as never,
			logger: logger as never,
			autoAllowPermissions: true,
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback: null,
		});

		expect(response.outcome).toEqual({
			outcome: "selected",
			optionId: "allow-once",
		});
	});

	it("does not auto-allow terminal-like permission requests", async () => {
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
			autoAllowPermissions: true,
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

	it("preserves reject_always option kind in emitted permission request", async () => {
		const state = createState();
		const sessionUpdateCallback = vi.fn();
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
			autoAllowPermissions: false,
			state,
			updateMessage: vi.fn(),
			sessionUpdateCallback,
		});

		await Promise.resolve();
		const update = sessionUpdateCallback.mock.calls[0][0];
		expect(update.permissionRequest.options).toEqual([
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
});
