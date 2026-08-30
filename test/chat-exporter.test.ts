import { describe, it, expect } from "vitest";
import {
	fencedCodeBlock,
	convertToolResultBlockToMarkdown,
	convertRawOutputToMarkdown,
} from "../src/services/chat-exporter";
import type { ToolResultContentBlock } from "../src/types/chat";

describe("fencedCodeBlock", () => {
	it("wraps plain text in a triple-backtick fence", () => {
		expect(fencedCodeBlock("hello\nworld")).toBe(
			"```\nhello\nworld\n```\n\n",
		);
	});

	it("uses a longer fence when the text contains a code fence", () => {
		// The text contains a 3-backtick run, so the wrapper must use >= 4
		// or the embedded fence would close the block and corrupt the export.
		expect(fencedCodeBlock("before\n```\ncode\n```\nafter")).toBe(
			"````\nbefore\n```\ncode\n```\nafter\n````\n\n",
		);
	});

	it("outruns arbitrarily long backtick runs", () => {
		expect(fencedCodeBlock("a `````culprit````` b")).toBe(
			"``````\na `````culprit````` b\n``````\n\n",
		);
	});

	it("handles empty text", () => {
		expect(fencedCodeBlock("")).toBe("```\n\n```\n\n");
	});
});

describe("convertToolResultBlockToMarkdown", () => {
	it("fences text output", () => {
		expect(
			convertToolResultBlockToMarkdown({ type: "text", text: "ok" }),
		).toBe("```\nok\n```\n\n");
	});

	it("renders a resource link with title and description", () => {
		expect(
			convertToolResultBlockToMarkdown({
				type: "resource_link",
				uri: "file:///report.md",
				name: "report.md",
				title: "Full report",
				description: "120 findings",
			}),
		).toBe("[Full report](file:///report.md) — 120 findings\n\n");
	});

	it("falls back to the name when a resource link has no title", () => {
		expect(
			convertToolResultBlockToMarkdown({
				type: "resource_link",
				uri: "https://example.com",
				name: "example",
			}),
		).toBe("[example](https://example.com)\n\n");
	});

	it("renders a text resource as a heading plus fence", () => {
		expect(
			convertToolResultBlockToMarkdown({
				type: "resource",
				resource: { uri: "file:///config.ini", text: "a = 1" },
			}),
		).toBe("**Resource**: `file:///config.ini`\n\n```\na = 1\n```\n\n");
	});

	it("renders a binary resource as a placeholder line", () => {
		expect(
			convertToolResultBlockToMarkdown({
				type: "resource",
				resource: {
					uri: "file:///blob.bin",
					mimeType: "application/octet-stream",
					blob: "AAAA",
				},
			}),
		).toBe(
			"**Resource**: `file:///blob.bin` (binary · application/octet-stream)\n\n",
		);
	});

	it("returns null for media blocks handled by the attachment pipeline", () => {
		const image: ToolResultContentBlock = {
			type: "image",
			data: "AAAA",
			mimeType: "image/png",
		};
		const audio: ToolResultContentBlock = {
			type: "audio",
			data: "AAAA",
			mimeType: "audio/wav",
		};
		expect(convertToolResultBlockToMarkdown(image)).toBeNull();
		expect(convertToolResultBlockToMarkdown(audio)).toBeNull();
	});
});

describe("convertToolCallToMarkdown ordering", () => {
	it("keeps content items in their received order", async () => {
		// The private method touches the vault only for media; with images
		// excluded a bare instance converts text and diffs purely.
		const { ChatExporter } = await import("../src/services/chat-exporter");
		const exporter = new ChatExporter(
			{} as unknown as ConstructorParameters<typeof ChatExporter>[0],
		);
		const md = await (
			exporter as unknown as {
				convertToolCallToMarkdown(
					c: unknown,
					ctx: unknown,
				): Promise<string>;
			}
		).convertToolCallToMarkdown(
			{
				type: "tool_call",
				toolCallId: "t1",
				status: "completed",
				content: [
					{ type: "content", content: { type: "text", text: "first" } },
					{ type: "diff", path: "/f.ts", oldText: "a", newText: "b" },
					{ type: "content", content: { type: "text", text: "last" } },
				],
			},
			{
				exportFilePath: "x.md",
				imageIndex: 0,
				includeImages: false,
				imageLocation: "obsidian",
				imageCustomFolder: "",
			},
		);
		const order = [
			md.indexOf("first"),
			md.indexOf("```diff"),
			md.indexOf("last"),
		];
		expect(order.every((i) => i >= 0)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});
});

describe("convertRawOutputToMarkdown", () => {
	it("passes string output through into a fence", () => {
		expect(convertRawOutputToMarkdown("done")).toBe(
			"**Raw output**:\n\n```\ndone\n```\n\n",
		);
	});

	it("pretty-prints non-string output as JSON", () => {
		expect(convertRawOutputToMarkdown({ exit: 0 })).toBe(
			'**Raw output**:\n\n```\n{\n  "exit": 0\n}\n```\n\n',
		);
	});
});
