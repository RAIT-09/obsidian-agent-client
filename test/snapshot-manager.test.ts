import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/domain/models/chat-message";
import type { FileChange } from "../src/shared/session-file-restoration";
import { type FileIo, SnapshotManager } from "../src/shared/snapshot-manager";

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
	rawInput?: Record<string, unknown>,
): ChatMessage {
	return makeMessage("assistant", [
		{
			type: "tool_call",
			toolCallId: crypto.randomUUID(),
			status: "completed",
			title,
			kind: kind as never,
			locations,
			rawInput,
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
			const messages = [
				makeDiffMessage("src/foo.ts", "old content", "new content"),
			];

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
			const messages = [makeMessage("user", [{ type: "text", text: "hello" }])];
			expect(
				await manager.computeChanges(messages, undefined, io.readFile),
			).toBeNull();
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

		it("detects deletion from execute rm command without diff payload", async () => {
			const messages: ChatMessage[] = [
				makeMessage("assistant", [
					{
						type: "tool_call",
						toolCallId: crypto.randomUUID(),
						status: "completed",
						kind: "execute",
						rawInput: { command: 'rm "/vault/notes/deleted.md"' },
					},
				]),
			];

			const io = mockFileIo({});
			const cs = await manager.computeChanges(messages, "/vault", io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].vaultPath).toBe("notes/deleted.md");
			expect(cs!.changes[0].isDeleted).toBe(true);
			expect(cs!.changes[0].canRevert).toBe(false);
		});
	});

	describe("captureSnapshots — original state capture", () => {
		it("captures original from diff oldText (highest priority)", async () => {
			const io = mockFileIo({ "a.md": "already modified on disk" });
			const messages = [
				makeDiffMessage("a.md", "original from diff", "modified"),
			];

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
			const cs = await manager.computeChanges(
				allMessages,
				undefined,
				postWriteIo.readFile,
			);
			expect(cs).not.toBeNull();
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].originalText).toBe("original content");
			expect(cs!.changes[0].finalText).toBe("polished content");
		});

		it("ignores location files that haven't changed on disk", async () => {
			const io = mockFileIo({ "notes/a.md": "same content" });
			const messages = [
				makeLocationMessage("some-tool", [{ path: "notes/a.md" }]),
			];

			const readFile = vi.fn(async () => "same content");
			await manager.captureSnapshots(messages, undefined, readFile);

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});

		it("reverts location-based changes using original snapshot", async () => {
			const readMessages = [
				makeLocationMessage("Read", [{ path: "notes/摘要.md" }], "read"),
			];
			const preWriteRead = vi.fn(async () => "original");
			await manager.captureSnapshots(readMessages, undefined, preWriteRead);

			const allMessages = [
				...readMessages,
				makeLocationMessage("obsidian-markdown", [{ path: "notes/摘要.md" }]),
			];
			const io = mockFileIo({ "notes/摘要.md": "polished" });
			const cs = await manager.computeChanges(
				allMessages,
				undefined,
				io.readFile,
			);

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["notes/摘要.md"]).toBe("original");
		});

		it("skips search tool locations", async () => {
			const io = mockFileIo({ "a.md": "content", "b.md": "content" });
			const messages = [
				makeLocationMessage(
					"Grep",
					[{ path: "a.md" }, { path: "b.md" }],
					"search",
				),
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

		it("advances baseline so future edits on kept file are tracked", async () => {
			const io = mockFileIo({ "a.md": "v2" });
			const messages = [makeDiffMessage("a.md", "v1", "v2")];

			let cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].originalText).toBe("v1");
			expect(cs!.changes[0].finalText).toBe("v2");

			manager.keepFile(cs!.changes[0]);
			expect(
				await manager.computeChanges(messages, undefined, io.readFile),
			).toBeNull();

			io.files["a.md"] = "v3";
			cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(false);
			expect(cs!.changes[0].originalText).toBe("v2");
			expect(cs!.changes[0].finalText).toBe("v3");
		});
	});

	describe("revertFile", () => {
		it("restores original content for modified file", async () => {
			const io = mockFileIo({ "src/foo.ts": "agent content" });
			const messages = [
				makeDiffMessage("src/foo.ts", "original", "agent content"),
			];
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
				isDeleted: false,
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

			const cs = (await manager.computeChanges(
				messages,
				undefined,
				io.readFile,
			))!;
			manager.dismissAll(cs.changes);

			expect(
				await manager.computeChanges(messages, undefined, io.readFile),
			).toBeNull();
		});

		it("advances baseline for all files and still tracks later edits", async () => {
			const io = mockFileIo({ "a.ts": "new-a", "b.ts": "new-b" });
			const messages = [
				makeDiffMessage("a.ts", "old-a", "new-a"),
				makeDiffMessage("b.ts", "old-b", "new-b"),
			];

			const cs = (await manager.computeChanges(
				messages,
				undefined,
				io.readFile,
			))!;
			manager.dismissAll(cs.changes);

			expect(
				await manager.computeChanges(messages, undefined, io.readFile),
			).toBeNull();

			io.files["a.ts"] = "new-a-2";
			const csAfter = await manager.computeChanges(
				messages,
				undefined,
				io.readFile,
			);
			expect(csAfter).not.toBeNull();
			expect(csAfter!.changes).toHaveLength(1);
			expect(csAfter!.changes[0].path).toBe("a.ts");
			expect(csAfter!.changes[0].originalText).toBe("new-a");
			expect(csAfter!.changes[0].finalText).toBe("new-a-2");
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

			await manager.undoRevert(io);
			expect(io.files["a.ts"]).toBe("agent content");
			expect(manager.canUndo).toBe(false);
		});

		it("re-deletes file when undoing revert of a deletion", async () => {
			const io = mockFileIo({ "a.ts": "original content" });
			const readMessages = [
				makeLocationMessage("Read", [{ path: "a.ts" }], "read"),
			];
			await manager.captureSnapshots(readMessages, undefined, io.readFile);

			delete io.files["a.ts"];
			const deleteMessages = [
				...readMessages,
				makeLocationMessage("Delete", [{ path: "a.ts" }], "delete", {
					path: "a.ts",
				}),
			];
			const cs = await manager.computeChanges(
				deleteMessages,
				undefined,
				io.readFile,
			);
			expect(cs!.changes[0].isDeleted).toBe(true);

			await manager.revertFile(cs!.changes[0], io);
			expect(io.files["a.ts"]).toBe("original content");

			await manager.undoRevert(io);
			expect(io.files["a.ts"]).toBeUndefined();
			expect(io.deleted).toContain("a.ts");
		});
	});

	describe("reset", () => {
		it("clears all internal state", async () => {
			const io = mockFileIo({ "a.ts": "new" });
			const messages = [makeDiffMessage("a.ts", "old", "new")];
			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			manager.keepFile(cs!.changes[0]);

			manager.reset();

			const csAfter = await manager.computeChanges(
				messages,
				undefined,
				io.readFile,
			);
			expect(csAfter).not.toBeNull();
			expect(csAfter!.changes).toHaveLength(1);
		});
	});

	describe("deletion tracking", () => {
		it("detects deletion when original was captured before delete", async () => {
			const io = mockFileIo({ "a.ts": "original content" });
			const readMessages = [
				makeLocationMessage("Read", [{ path: "a.ts" }], "read"),
			];
			await manager.captureSnapshots(readMessages, undefined, io.readFile);

			delete io.files["a.ts"];
			const allMessages = [
				...readMessages,
				makeLocationMessage("Delete", [{ path: "a.ts" }], "delete", {
					path: "a.ts",
				}),
			];
			const cs = await manager.computeChanges(
				allMessages,
				undefined,
				io.readFile,
			);
			expect(cs).not.toBeNull();
			expect(cs!.changes).toHaveLength(1);
			expect(cs!.changes[0].isDeleted).toBe(true);
			expect(cs!.changes[0].isNewFile).toBe(false);
			expect(cs!.changes[0].canRevert).toBe(true);
			expect(cs!.changes[0].originalText).toBe("original content");
			expect(cs!.changes[0].finalText).toBe("");
		});

		it("detects deletion via kind hint even without prior snapshot", async () => {
			const io = mockFileIo();
			const messages: ChatMessage[] = [
				makeMessage("assistant", [
					{
						type: "tool_call",
						toolCallId: "tc1",
						status: "completed",
						kind: "delete",
						rawInput: { path: "notes/gone.md" },
					},
				]),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isDeleted).toBe(true);
			expect(cs!.changes[0].canRevert).toBe(false);
			expect(cs!.changes[0].originalText).toBeNull();
		});

		it("reverts deletion by recreating file with original content", async () => {
			const io = mockFileIo({ "a.md": "the original" });
			const readMessages = [
				makeLocationMessage("Read", [{ path: "a.md" }], "read"),
			];
			await manager.captureSnapshots(readMessages, undefined, io.readFile);

			delete io.files["a.md"];
			const allMessages = [
				...readMessages,
				makeLocationMessage("Delete", [{ path: "a.md" }], "delete", {
					path: "a.md",
				}),
			];
			const cs = await manager.computeChanges(
				allMessages,
				undefined,
				io.readFile,
			);
			const result = await manager.revertFile(cs!.changes[0], io);

			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["a.md"]).toBe("the original");
		});

		it("cannot revert deletion without original content", async () => {
			const io = mockFileIo();
			const messages: ChatMessage[] = [
				makeMessage("assistant", [
					{
						type: "tool_call",
						toolCallId: "tc1",
						status: "completed",
						kind: "delete",
						rawInput: { path: "notes/gone.md" },
					},
				]),
			];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: false, conflict: true });
		});

		it("create then delete: no net change", async () => {
			const io = mockFileIo();
			const messages = [makeDiffMessage("temp.ts", null, "content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).toBeNull();
		});

		it("edit then delete: detects as deleted", async () => {
			const io = mockFileIo({ "a.ts": "v2" });
			const messages = [makeDiffMessage("a.ts", "v1", "v2")];
			await manager.captureSnapshots(messages, undefined, io.readFile);

			delete io.files["a.ts"];
			const deleteMessages: ChatMessage[] = [
				...messages,
				makeMessage("assistant", [
					{
						type: "tool_call",
						toolCallId: "tc2",
						status: "completed",
						kind: "delete",
						rawInput: { path: "a.ts" },
					},
				]),
			];
			const cs = await manager.computeChanges(
				deleteMessages,
				undefined,
				io.readFile,
			);
			expect(cs!.changes[0].isDeleted).toBe(true);
			expect(cs!.changes[0].originalText).toBe("v1");
			expect(cs!.changes[0].canRevert).toBe(true);
		});

		it("modified files have isDeleted false", async () => {
			const io = mockFileIo({ "a.ts": "new content" });
			const messages = [makeDiffMessage("a.ts", "old content", "new content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes[0].isDeleted).toBe(false);
			expect(cs!.changes[0].isNewFile).toBe(false);
		});

		it("new files have isDeleted false", async () => {
			const io = mockFileIo({ "new.ts": "content" });
			const messages = [makeDiffMessage("new.ts", null, "content")];

			const cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs!.changes[0].isDeleted).toBe(false);
			expect(cs!.changes[0].isNewFile).toBe(true);
		});
	});

	describe("real-world scenarios", () => {
		it("create file then edit it: tracks as new", async () => {
			const io = mockFileIo({ "summary.md": "content without title" });
			const messages = [
				makeDiffMessage("summary.md", null, "# Title\ncontent without title"),
				makeDiffMessage(
					"summary.md",
					"# Title\ncontent without title",
					"content without title",
				),
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

		it("kept full-file rewrite becomes baseline for later modifications", async () => {
			const io = mockFileIo({ "note.md": "rewritten content" });
			const messages = [makeDiffMessage("note.md", "", "rewritten content")];

			let cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			manager.keepFile(cs!.changes[0]);

			io.files["note.md"] = "rewritten content\nwith extra line";
			cs = await manager.computeChanges(messages, undefined, io.readFile);
			expect(cs).not.toBeNull();
			expect(cs!.changes[0].isNewFile).toBe(false);
			expect(cs!.changes[0].originalText).toBe("rewritten content");
			expect(cs!.changes[0].finalText).toBe(
				"rewritten content\nwith extra line",
			);
		});

		it("read then write via custom tool: captures before write", async () => {
			const messages1: ChatMessage[] = [
				makeLocationMessage("Read", [{ path: "Clippings/摘要.md" }], "read"),
			];
			const preWriteRead = vi.fn(
				async () => "# Title\nOriginal callout content",
			);
			await manager.captureSnapshots(messages1, undefined, preWriteRead);

			const messages2: ChatMessage[] = [
				...messages1,
				makeLocationMessage("obsidian-markdown", [
					{ path: "Clippings/摘要.md" },
				]),
			];
			const io = mockFileIo({
				"Clippings/摘要.md": "## Title\nConverted heading content",
			});
			const cs = await manager.computeChanges(
				messages2,
				undefined,
				io.readFile,
			);

			expect(cs).not.toBeNull();
			expect(cs!.changes[0].originalText).toBe(
				"# Title\nOriginal callout content",
			);
			expect(cs!.changes[0].finalText).toBe(
				"## Title\nConverted heading content",
			);

			const result = await manager.revertFile(cs!.changes[0], io);
			expect(result).toEqual({ reverted: true, conflict: false });
			expect(io.files["Clippings/摘要.md"]).toBe(
				"# Title\nOriginal callout content",
			);
		});
	});
});
