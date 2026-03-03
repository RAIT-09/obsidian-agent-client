import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	ChatMessage,
	PermissionOption,
} from "../src/domain/models/chat-message";
import type { IAgentClient } from "../src/domain/ports/agent-client.port";
import { usePermission } from "../src/hooks/usePermission";

function makePermissionMessage(options: PermissionOption[]): ChatMessage[] {
	return [
		{
			id: crypto.randomUUID(),
			role: "assistant",
			content: [
				{
					type: "tool_call",
					toolCallId: "tc-1",
					status: "pending",
					permissionRequest: {
						requestId: "req-1",
						options,
						isActive: true,
					},
				},
			],
			timestamp: new Date(),
		},
	];
}

function makeAgentClient(
	respondToPermission: (requestId: string, optionId: string) => Promise<void>,
): IAgentClient {
	return {
		respondToPermission,
	} as unknown as IAgentClient;
}

describe("usePermission", () => {
	it("approveActivePermission prefers allow_once over allow_always", async () => {
		const respondToPermission = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			usePermission(
				makeAgentClient(respondToPermission),
				makePermissionMessage([
					{
						optionId: "allow-always",
						name: "Allow always",
						kind: "allow_always",
					},
					{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				]),
			),
		);

		await act(async () => {
			const approved = await result.current.approveActivePermission();
			expect(approved).toBe(true);
		});

		expect(respondToPermission).toHaveBeenCalledWith("req-1", "allow-once");
	});

	it("rejectActivePermission prefers reject_once over reject_always", async () => {
		const respondToPermission = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			usePermission(
				makeAgentClient(respondToPermission),
				makePermissionMessage([
					{
						optionId: "reject-always",
						name: "Reject always",
						kind: "reject_always",
					},
					{ optionId: "reject-once", name: "Reject once", kind: "reject_once" },
				]),
			),
		);

		await act(async () => {
			const rejected = await result.current.rejectActivePermission();
			expect(rejected).toBe(true);
		});

		expect(respondToPermission).toHaveBeenCalledWith("req-1", "reject-once");
	});

	it("approveActivePermission falls back to allow_always when allow_once is missing", async () => {
		const respondToPermission = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			usePermission(
				makeAgentClient(respondToPermission),
				makePermissionMessage([
					{
						optionId: "allow-always",
						name: "Allow always",
						kind: "allow_always",
					},
				]),
			),
		);

		await act(async () => {
			const approved = await result.current.approveActivePermission();
			expect(approved).toBe(true);
		});

		expect(respondToPermission).toHaveBeenCalledWith("req-1", "allow-always");
	});

	it("rejectActivePermission falls back to reject_always when reject_once is missing", async () => {
		const respondToPermission = vi.fn().mockResolvedValue(undefined);
		const { result } = renderHook(() =>
			usePermission(
				makeAgentClient(respondToPermission),
				makePermissionMessage([
					{
						optionId: "reject-always",
						name: "Reject always",
						kind: "reject_always",
					},
				]),
			),
		);

		await act(async () => {
			const rejected = await result.current.rejectActivePermission();
			expect(rejected).toBe(true);
		});

		expect(respondToPermission).toHaveBeenCalledWith("req-1", "reject-always");
	});
});
