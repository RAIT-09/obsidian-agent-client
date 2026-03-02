import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/domain/models/chat-message";
import {
	discoverModifiedFiles,
	getLastAssistantMessage,
	toVaultRelativePath,
} from "../src/shared/session-file-restoration";

function makeMessage(
	role: "user" | "assistant",
	content: ChatMessage["content"],
): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content,
		timestamp: new Date(),
	};
}

describe("discoverModifiedFiles", () => {
	it("discovers files from diff content in any tool call", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					content: [
						{
							type: "diff",
							path: "/vault/notes/summary.md",
							oldText: null,
							newText: "content",
						},
					],
				},
			]),
		];
		const files = discoverModifiedFiles(messages, "/vault");
		expect(files).toHaveLength(1);
		expect(files[0].vaultPath).toBe("notes/summary.md");
		expect(files[0].firstOldText).toBeNull();
	});

	it("discovers files from rawInput path keys", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "in_progress",
					kind: "other",
					rawInput: { filePath: "/vault/a.md", content: "x" },
				},
			]),
		];
		const files = discoverModifiedFiles(messages, "/vault");
		expect(files).toHaveLength(1);
		expect(files[0].vaultPath).toBe("a.md");
		expect(files[0].firstOldText).toBeUndefined();
	});

	it("discovers files from tool call locations", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					kind: "other",
					locations: [{ path: "notes/摘要.md" }],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(1);
		expect(files[0].vaultPath).toBe("notes/摘要.md");
		expect(files[0].firstOldText).toBeUndefined();
	});

	it("includes locations for read tools (captures before write)", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					kind: "read",
					locations: [{ path: "notes/a.md" }],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(1);
		expect(files[0].vaultPath).toBe("notes/a.md");
	});

	it("skips locations for search tools", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					kind: "search",
					locations: [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(0);
	});

	it("discovers files from locations when kind is undefined (custom MCP tools)", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					title: "obsidian-markdown",
					locations: [
						{ path: "notes/doc.md" },
						{ path: "notes/doc.md" },
					],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(1);
		expect(files[0].vaultPath).toBe("notes/doc.md");
	});

	it("prefers diff-based discovery over location-based", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					content: [
						{ type: "diff", path: "a.ts", oldText: "old", newText: "new" },
					],
					locations: [{ path: "a.ts" }],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(1);
		expect(files[0].firstOldText).toBe("old");
	});

	it("keeps only first oldText per path", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					content: [
						{ type: "diff", path: "a.ts", oldText: "v1", newText: "v2" },
					],
				},
			]),
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc2",
					status: "completed",
					content: [
						{ type: "diff", path: "a.ts", oldText: "v2", newText: "v3" },
					],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files).toHaveLength(1);
		expect(files[0].firstOldText).toBe("v1");
	});

	it("normalizes undefined oldText from diff to null", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [
				{
					type: "tool_call",
					toolCallId: "tc1",
					status: "completed",
					content: [
						{ type: "diff", path: "new.ts", oldText: undefined, newText: "content" },
					],
				},
			]),
		];
		const files = discoverModifiedFiles(messages);
		expect(files[0].firstOldText).toBeNull();
	});
});

describe("toVaultRelativePath", () => {
	it("returns null for absolute path outside vault", () => {
		expect(toVaultRelativePath("/other/file.ts", "/vault")).toBeNull();
	});
});

describe("getLastAssistantMessage", () => {
	it("returns last assistant text", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [{ type: "text", text: "first" }]),
			makeMessage("user", [{ type: "text", text: "question" }]),
			makeMessage("assistant", [{ type: "text", text: "last answer" }]),
		];

		expect(getLastAssistantMessage(messages)).toBe("last answer");
	});

	it("returns null when no assistant messages", () => {
		const messages: ChatMessage[] = [
			makeMessage("user", [{ type: "text", text: "hello" }]),
		];

		expect(getLastAssistantMessage(messages)).toBeNull();
	});

	it("skips empty text content", () => {
		const messages: ChatMessage[] = [
			makeMessage("assistant", [{ type: "text", text: "real content" }]),
			makeMessage("assistant", [{ type: "text", text: "   " }]),
		];

		expect(getLastAssistantMessage(messages)).toBe("real content");
	});
});
