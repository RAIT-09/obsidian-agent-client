import { describe, expect, it } from "vitest";
import {
	createQueuedPrompt,
	removeQueuedPromptItem,
	takeNextQueueItemForSession,
	updateQueuedPromptItem,
} from "../src/services/message-queue";
import type { AttachedFile } from "../src/types/chat";

const attachment: AttachedFile = {
	id: "file-1",
	kind: "file",
	mimeType: "text/plain",
	name: "notes.txt",
	path: "/tmp/notes.txt",
};

describe("message queue transforms", () => {
	it("never takes queued work from another session", () => {
		const queue = [
			{ sessionId: "session-a", value: "from-a" },
			{ sessionId: "session-b", value: "from-b" },
		];

		const result = takeNextQueueItemForSession(queue, "session-b");

		expect(result.item).toEqual({
			sessionId: "session-b",
			value: "from-b",
		});
		expect(result.remaining).toEqual([]);
	});

	it("creates an isolated prompt with the supplied fields", () => {
		const attachments = [attachment];
		const prompt = createQueuedPrompt(
			"first",
			attachments,
			"q1",
			new Date(1),
		);
		attachments.pop();

		expect(prompt).toEqual({
			id: "q1",
			content: "first",
			attachments: [attachment],
			createdAt: new Date(1),
		});
	});

	it("keeps FIFO order after append and removal", () => {
		const queue = [
			createQueuedPrompt("first", [], "q1"),
			createQueuedPrompt("second", [], "q2"),
		];
		const appended = [...queue, createQueuedPrompt("third", [], "q3")];

		expect(
			removeQueuedPromptItem(appended, "q2").map((item) => item.id),
		).toEqual(["q1", "q3"]);
	});

	it("edits an item without moving it", () => {
		const queue = [
			createQueuedPrompt("first", [], "q1"),
			createQueuedPrompt("second", [], "q2"),
		];
		const attachments = [attachment];
		const updated = updateQueuedPromptItem(queue, "q1", {
			content: "edited",
			attachments,
		});
		attachments.pop();

		expect(updated.map((item) => item.id)).toEqual(["q1", "q2"]);
		expect(updated[0]).toMatchObject({
			content: "edited",
			attachments: [attachment],
		});
		expect(queue[0].content).toBe("first");
	});

	it("leaves the queue unchanged for an unknown id", () => {
		const queue = [createQueuedPrompt("first", [], "q1")];
		const updated = updateQueuedPromptItem(queue, "missing", {
			content: "edited",
			attachments: [],
		});

		expect(updated[0]).toBe(queue[0]);
		expect(removeQueuedPromptItem(queue, "missing")).toEqual(queue);
	});

	it("removes only the requested item", () => {
		const queue = [
			createQueuedPrompt("first", [], "q1"),
			createQueuedPrompt("second", [], "q2"),
		];
		expect(
			removeQueuedPromptItem(queue, "q1").map((item) => item.id),
		).toEqual(["q2"]);
	});
});
