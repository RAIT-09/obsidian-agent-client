import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../src/domain/models/chat-message";
import type { FileChange } from "../src/shared/session-file-restoration";
import { SnapshotManager, type FileIo } from "../src/shared/snapshot-manager";

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

function makeDiffMessage(
	path: string,
	oldText: string | null | undefined,
	newText: string,
): ChatMessage {
	return makeMessage("assistant", [
		{
			type: "tool_call",
			toolCallId: crypto.randomUUID(),
			status: "completed",
			content: [{ type: "diff", path, oldText, newText }],
		},
	]);
}

function makeLocationMessage(
	title: string,
	locations: { path: string }[],
	kind?: string,
): ChatMessage {
	return makeMessage("assistant", [
		{
			type: "tool_call",
			toolCallId: crypto.randomUUID(),
			status: "completed",
			title,
			kind: kind as never,
			locations,
		},
	]);
}

function mockFileIo(
	files: Record<string, string> = {},
): FileIo & { files: Record<string, string>; deleted: string[] } {
	const deleted: string[] = [];
	const io: FileIo & { files: Record<string, string>; deleted: string[] } = {
		files,
		deleted,
		readFile: vi.fn(async (path: string) => {
			if (path in files) return files[path];
			throw new Error(`File not found: ${path}`);
		}),
		writeFile: vi.fn(async (path: string, content: string) => {
			files[path] = content;
		}),
		deleteFile: vi.fn(async (path: string) => {
			delete files[path];
			deleted.push(path);
		}),
	};
	return io;
}

describe("SnapshotManager", () => {
	let manager: SnapshotManager;

	beforeEach(() => {
		manager = new SnapshotManager();
	});

	describe("computeChanges — disk comparison", () => {
		it("detects change when disk content differs from diff oldText", async () => {
			const io = mockFileIo({ "src/foo.ts": "new content" });
			const messages = [makeDiffMessage("src/foo.ts", "old content", "new content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].originalText).toBe("old content");
			expect(cs!.changes[0].finalText).toBe("new content");
			expect(cs!.changes[0].isNewFile).toBe(false);
			expect(cs!.changes[0].canRevert).toBe(true);
		});

		it("returns null when no tool calls modify files", async () => {
			const io = mockFileIo();
			const messages = [
				makeMessage("user", [{ type: "text", text: "hello" }]),
			];
			expect(await manager.computeChanges(messages, undefined, io.readFile)).toBeNull();
		});

		it("detects new file (oldText null)", async () => {
			const io = mockFileIo({ "new.ts": "created content" });
			const messages = [makeDiffMessage("new.ts", null, "created content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(true);
			expect(cs!.changes[0].originalText).toBeNull();
			expect(cs!.changes[0].finalText).toBe("created content");
			expect(cs!.changes[0].canRevert).toBe(true);
		});

		it("treats undefined oldText as new file", async () => {
			const io = mockFileIo({ "new.ts": "content" });
			const messages = [makeDiffMessage("new.ts", undefined, "content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(true);
			expect(cs!.changes[0].canRevert).toBe(true);
		});

		it("skips files where disk matches original (no change)", async () => {
			const io = mockFileIo({ "a.ts": "same content" });
			const messages = [makeDiffMessage("a.ts", "same content", "whatever")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});

		it("tracks multiple edits: keeps first original, reads latest from disk", async () => {
			const io = mockFileIo({ "a.ts": "v3" });
			const messages = [
				makeDiffMessage("a.ts", "v1", "v2"),
				makeDiffMessage("a.ts", "v2", "v3"),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].originalText).toBe("v1");
			expect(cs!.changes[0].finalText).toBe("v3");
		});

		it("ignores trailing whitespace differences", async () => {
			const io = mockFileIo({ "a.ts": "content\n\n" });
			const messages = [makeDiffMessage("a.ts", "content", "modified")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});
	});

	describe("captureSnapshots — original state capture", () => {
		it("captures original from diff oldText (highest priority)", async () => {
			const io = mockFileIo({ "a.md": "already modified on disk" });
			const messages = [makeDiffMessage("a.md", "original from diff", "modified")];

			await manager.captureSnapshots(messages, undefined, io.readFile);
			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes[0].originalText).toBe("original from diff");
		});

		it("falls back to disk read when no diff oldText", async () => {
			const messages: ChatMessage[] = [
				makeMessage("assistant", [
					{
						type: "tool_call",
						toolCallId: "tc1",
						status: "completed",
						kind: "other",
						rawInput: { path: "notes/a.md" },
					},
				]),
			];

			const readFile = vi.fn(async () => "disk content");
			await manager.captureSnapshots(messages, undefined, readFile);

			const io = mockFileIo({ "notes/a.md": "modified" });
			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes[0].originalText).toBe("disk content");
		});

		it("does not re-capture paths already recorded", async () => {
			const io = mockFileIo({ "a.ts": "content" });
			const messages = [makeDiffMessage("a.ts", "original", "content")];

			await manager.captureSnapshots(messages, undefined, io.readFile);
			await manager.captureSnapshots(messages, undefined, io.readFile);

			expect(io.readFile).not.toHaveBeenCalled();
		});
	});

	describe("location-based detection (custom MCP tools)", () => {
		it("captures snapshot from read tool location, detects change after write", async () => {
			const manager = new SnapshotManager();

			const readMessages: ChatMessage[] = [
				makeLocationMessage("Read", [{ path: "notes/摘要.md" }], "read"),
			];

			const preWriteRead = vi.fn(async () => "original content");
			await manager.captureSnapshots(readMessages, undefined, preWriteRead);

			const allMessages: ChatMessage[] = [
				...readMessages,
				makeLocationMessage("obsidian-markdown", [{ path: "notes/摘要.md" }]),
			];

			const postWriteIo = mockFileIo({ "notes/摘要.md": "polished content" });
			const cs = await manager.computeChanges(allMessages, undefined, postWriteIo.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].originalText).toBe("original content");
			expect(cs!.changes[0].finalText).toBe("polished content");
		});

		it("ignores location files that haven't changed on disk", async () => {
			const io = mockFileIo({ "notes/a.md": "same content" });
			const messages = [makeLocationMessage("some-tool", [{ path: "notes/a.md" }])];

			const readFile = vi.fn(async () => "same content");
			await manager.captureSnapshots(messages, undefined, readFile);

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});

		it("reverts location-based changes using original snapshot", async () => {
			const readMessages = [makeLocationMessage("Read", [{ path: "notes/摘要.md" }], "read")];
			const preWriteRead = vi.fn(async () => "original");
			await manager.captureSnapshots(readMessages, undefined, preWriteRead);

			const allMessages = [
				...readMessages,
				makeLocationMessage("obsidian-markdown", [{ path: "notes/摘要.md" }]),
			];
			const io = mockFileIo({ "notes/摘要.md": "polished" });
			const cs = await manager.computeChanges(allMessages, undefined, io.readFile);

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["notes/摘要.md"]).toBe("original");
		});

		it("skips search tool locations", async () => {
			const io = mockFileIo({ "a.md": "content", "b.md": "content" });
			const messages = [
				makeLocationMessage("Grep", [{ path: "a.md" }, { path: "b.md" }], "search"),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});
	});

	describe("keepFile", () => {
		it("filters kept files from subsequent computeChanges", async () => {
			const io = mockFileIo({ "a.ts": "new-a", "b.ts": "new-b" });
			const messages = [
				makeDiffMessage("a.ts", "old", "new-a"),
				makeDiffMessage("b.ts", "old", "new-b"),
			];

			let cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes).toHaveLength(2);

			const changeA = cs!.changes.find((c) => c.path === "a.ts")!;
			manager.keepFile(changeA);

			cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].path).toBe("b.ts");
		});
	});

	describe("revertFile", () => {
		it("restores original content for modified file", async () => {
			const io = mockFileIo({ "src/foo.ts": "agent content" });
			const messages = [makeDiffMessage("src/foo.ts", "original", "agent content")];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["src/foo.ts"]).toBe("original");
		});

		it("deletes newly created file on revert", async () => {
			const io = mockFileIo({ "new.ts": "content" });
			const messages = [makeDiffMessage("new.ts", null, "content")];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.deleted).toContain("new.ts");
		});

		it("reports conflict when vaultPath is null", async () => {
			const change: FileChange = {
				path: "/outside/vault.ts",
				vaultPath: null,
				isNewFile: false,
				canRevert: true,
				originalText: "original",
				finalText: "new",
			};
			const io = mockFileIo();
			const result = await manager.revertFile(change, io);
			expect(result).toEqual({ reverted: false, conflict: true });
		});

		it("removes reverted file from subsequent computeChanges", async () => {
			const io = mockFileIo({ "a.ts": "new" });
			const messages = [makeDiffMessage("a.ts", "old", "new")];

			let cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes).toHaveLength(1);

			await manager.revertFile(cs!.changes[0], io);

			cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});
	});

	describe("revertAll", () => {
		it("reverts all changes and reports results", async () => {
			const io = mockFileIo({ "a.ts": "new-a", "b.ts": "new-b" });
			const messages = [
				makeDiffMessage("a.ts", "old-a", "new-a"),
				makeDiffMessage("b.ts", "old-b", "new-b"),
			];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);

			const result = await manager.revertAll(cs!.changes, io);
			expect(result.reverted).toEqual(["a.ts", "b.ts"]);
			expect(result.conflicts).toEqual([]);
			expect(io.files["a.ts"]).toBe("old-a");
			expect(io.files["b.ts"]).toBe("old-b");
		});
	});

	describe("dismissAll", () => {
		it("hides all changes from subsequent computeChanges", async () => {
			const io = mockFileIo({ "a.ts": "new", "b.ts": "new" });
			const messages = [
				makeDiffMessage("a.ts", "old", "new"),
				makeDiffMessage("b.ts", "old", "new"),
			];

			const cs = (await manager.computeChanges(messages, undefined, io.readFile))!;
			manager.dismissAll(cs.changes);

			expect(await manager.computeChanges(messages, undefined, io.readFile)).toBeNull();
		});
	});

	describe("undoRevert", () => {
		it("restores pre-revert content for reverted files", async () => {
			const io = mockFileIo({ "a.ts": "agent content" });
			const messages = [makeDiffMessage("a.ts", "original", "agent content")];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);

			await manager.revertFile(cs!.changes[0], io);
			expect(io.files["a.ts"]).toBe("original");
			expect(manager.canUndo).toBe(true);

			await manager.undoRevert(io.writeFile);
			expect(io.files["a.ts"]).toBe("agent content");
			expect(manager.canUndo).toBe(false);
		});
	});

	describe("reset", () => {
		it("clears all internal state", async () => {
			const io = mockFileIo({ "a.ts": "new" });
			const messages = [makeDiffMessage("a.ts", "old", "new")];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			manager.keepFile(cs!.changes[0]);

			manager.reset();

			const csAfter = await manager.computeChanges(messages, undefined, io.readFile);
			expect(csAfter).not.toBeNull();
			expect(csAfter!.changes).toHaveLength(1);
		});
	});

	describe("real-world scenarios", () => {
		it("create file then edit it: tracks as new", async () => {
			const io = mockFileIo({ "summary.md": "content without title" });
			const messages = [
				makeDiffMessage("summary.md", null, "# Title\ncontent without title"),
				makeDiffMessage("summary.md", "# Title\ncontent without title", "content without title"),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(true);
			expect(cs!.changes[0].originalText).toBeNull();
			expect(cs!.changes[0].finalText).toBe("content without title");
		});

		it("reverts new file by deleting it", async () => {
			const io = mockFileIo({ "summary.md": "content" });
			const messages = [makeDiffMessage("summary.md", null, "content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.deleted).toContain("summary.md");
		});

		it("handles undefined oldText for new file (ACP sends undefined)", async () => {
			const io = mockFileIo({ "summary.md": "final content" });
			const messages = [
				makeDiffMessage("summary.md", undefined, "initial content"),
				makeDiffMessage("summary.md", "initial content", "final content"),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(true);
			expect(cs!.changes[0].originalText).toBeNull();
		});

		it("read then write via custom tool: captures before write", async () => {
			const messages1: ChatMessage[] = [
				makeLocationMessage("Read", [{ path: "Clippings/摘要.md" }], "read"),
			];
			const preWriteRead = vi.fn(async () => "# Title\nOriginal callout content");
			await manager.captureSnapshots(messages1, undefined, preWriteRead);

			const messages2: ChatMessage[] = [
				...messages1,
				makeLocationMessage("obsidian-markdown", [{ path: "Clippings/摘要.md" }]),
			];
			const io = mockFileIo({ "Clippings/摘要.md": "## Title\nConverted heading content" });
			const cs = await manager.computeChanges(messages2, undefined, io.readFile);

			expect(cs).not.toBeNull();
			expect(cs!.changes[0].originalText).toBe("# Title\nOriginal callout content");
			expect(cs!.changes[0].finalText).toBe("## Title\nConverted heading content");

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["Clippings/摘要.md"]).toBe("# Title\nOriginal callout content");
		});
	});
});
