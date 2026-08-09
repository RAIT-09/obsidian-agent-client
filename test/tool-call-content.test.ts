import { describe, expect, it } from "vitest";
import type * as acp from "@agentclientprotocol/sdk";
import { AcpTypeConverter } from "../src/acp/type-converter";
import { mergeToolCallContent } from "../src/services/message-state";
import type { MessageContent } from "../src/types/chat";

type ToolCallMessage = Extract<MessageContent, { type: "tool_call" }>;

function tool(overrides: Partial<ToolCallMessage> = {}): ToolCallMessage {
	return {
		type: "tool_call",
		toolCallId: "tool-1",
		status: "in_progress",
		...overrides,
	};
}

describe("AcpTypeConverter.toToolCallContent", () => {
	it("preserves all ACP standard content, diff, and terminal blocks", () => {
		const input: acp.ToolCallContent[] = [
			{ type: "content", content: { type: "text", text: "result" } },
			{
				type: "content",
				content: {
					type: "image",
					data: "abc",
					mimeType: "image/png",
					uri: null,
				},
			},
			{
				type: "content",
				content: {
					type: "audio",
					data: "audio",
					mimeType: "audio/mpeg",
				},
			},
			{
				type: "content",
				content: {
					type: "resource_link",
					uri: "file:///result.txt",
					name: "result.txt",
				},
			},
			{
				type: "content",
				content: {
					type: "resource",
					resource: {
						uri: "file:///embedded.txt",
						mimeType: "text/plain",
						text: "resource body",
					},
				},
			},
			{
				type: "diff",
				path: "src/App.tsx",
				oldText: "old",
				newText: "new",
			},
			{ type: "terminal", terminalId: "terminal-1" },
		];

		const converted = AcpTypeConverter.toToolCallContent(input);
		expect(converted).toHaveLength(7);
		expect(converted?.map((item) => item.type)).toEqual([
			"content",
			"content",
			"content",
			"content",
			"content",
			"diff",
			"terminal",
		]);
		expect(converted?.[0]).toEqual({
			type: "content",
			content: { type: "text", text: "result" },
		});
		expect(converted?.[3]).toEqual({
			type: "content",
			content: {
				type: "resource_link",
				uri: "file:///result.txt",
				name: "result.txt",
				title: undefined,
				description: undefined,
				mimeType: undefined,
				size: undefined,
			},
		});
	});

	it("distinguishes an omitted update from an explicit clear", () => {
		expect(AcpTypeConverter.toToolCallContent(undefined)).toBeUndefined();
		expect(AcpTypeConverter.toToolCallContent(null)).toEqual([]);
		expect(AcpTypeConverter.toToolCallContent([])).toEqual([]);
	});
});

describe("mergeToolCallContent", () => {
	it("replaces content collections and retains omitted raw output", () => {
		const existing = tool({
			content: [{ type: "terminal", terminalId: "old-terminal" }],
			rawOutput: { stdout: "done" },
		});
		const update = {
			type: "tool_call" as const,
			toolCallId: "tool-1",
			status: "completed" as const,
			content: [
				{
					type: "content" as const,
					content: { type: "text" as const, text: "final result" },
				},
			],
		};

		const merged = mergeToolCallContent(existing, update);
		expect(merged.content).toEqual(update.content);
		expect(merged.rawOutput).toEqual({ stdout: "done" });
	});

	it("retains status when a partial update omits it", () => {
		const merged = mergeToolCallContent(tool(), {
			type: "tool_call",
			toolCallId: "tool-1",
			rawOutput: { stdout: "still running" },
		});
		expect(merged.status).toBe("in_progress");
	});

	it("honors an explicitly empty content collection", () => {
		const merged = mergeToolCallContent(
			tool({ content: [{ type: "terminal", terminalId: "terminal-1" }] }),
			{
				type: "tool_call",
				toolCallId: "tool-1",
				content: [],
			},
		);
		expect(merged.content).toEqual([]);
	});
});
