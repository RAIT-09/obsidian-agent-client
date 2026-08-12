import { describe, expect, it } from "vitest";
import {
	createQueuedPrompt,
	removeQueuedPromptItem,
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
	it("preserves FIFO order", () => {
		const first = createQueuedPrompt("first", [], "q1", new Date(1));
		const second = createQueuedPrompt("second", [], "q2", new Date(2));
		expect([first, second].map((item) => item.id)).toEqual(["q1", "q2"]);
	});

	it("edits an item without moving it", () => {
		const queue = [
			createQueuedPrompt("first", [], "q1"),
			createQueuedPrompt("second", [], "q2"),
		];
		const updated = updateQueuedPromptItem(queue, "q1", {
			content: "edited",
			attachments: [attachment],
		});

		expect(updated.map((item) => item.id)).toEqual(["q1", "q2"]);
		expect(updated[0]).toMatchObject({
			content: "edited",
			attachments: [attachment],
		});
		expect(queue[0].content).toBe("first");
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
