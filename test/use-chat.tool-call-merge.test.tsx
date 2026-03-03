import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionUpdate } from "../src/domain/models/session-update";
import type { IAgentClient } from "../src/domain/ports/agent-client.port";
import type { IVaultAccess } from "../src/domain/ports/vault-access.port";
import { useChat } from "../src/hooks/useChat";
import type { IMentionService } from "../src/shared/mention-utils";

function makeHook() {
	const agentClient = {} as IAgentClient;
	const vaultAccess = {} as IVaultAccess;
	const mentionService: IMentionService = {
		getAllFiles: () => [],
	};

	return renderHook(() =>
		useChat(
			agentClient,
			vaultAccess,
			mentionService,
			{
				sessionId: "session-1",
				authMethods: [],
			},
			{
				windowsWslMode: false,
				maxNoteLength: 10000,
				maxSelectionLength: 2000,
			},
		),
	);
}

function applyUpdate(
	result: ReturnType<typeof makeHook>["result"],
	update: SessionUpdate,
): void {
	act(() => {
		result.current.handleSessionUpdate(update);
	});
}

describe("useChat tool_call_update merge", () => {
	it("preserves previous diff oldText when update omits it", () => {
		const { result } = makeHook();

		applyUpdate(result, {
			type: "tool_call",
			sessionId: "session-1",
			toolCallId: "tc-1",
			status: "in_progress",
			content: [
				{
					type: "diff",
					path: "notes/a.md",
					oldText: "original content",
					newText: "intermediate content",
				},
			],
		});

		applyUpdate(result, {
			type: "tool_call_update",
			sessionId: "session-1",
			toolCallId: "tc-1",
			status: "completed",
			content: [
				{
					type: "diff",
					path: "notes/a.md",
					newText: "final content",
				},
			],
		});

		const assistantMessage = result.current.messages.find(
			(message) => message.role === "assistant",
		);
		expect(assistantMessage).toBeTruthy();
		if (!assistantMessage) {
			throw new Error("Expected assistant message to exist");
		}

		const toolCall = assistantMessage.content.find(
			(content) => content.type === "tool_call",
		);
		expect(toolCall?.type).toBe("tool_call");
		if (toolCall?.type !== "tool_call") return;

		const diff = toolCall.content?.find((item) => item.type === "diff");
		expect(diff?.type).toBe("diff");
		if (diff?.type !== "diff") return;

		expect(diff.oldText).toBe("original content");
		expect(diff.newText).toBe("final content");
	});
});
