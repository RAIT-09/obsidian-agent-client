import { describe, expect, it } from "vitest";
import {
	beginQueuedPromptEdit,
	createQueuedPrompt,
	finishQueuedPromptEdit,
	isQueueDispatchCurrent,
	requeueItemAtFront,
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
	it("keeps automatic resume intent when switching edited items", () => {
		const first = beginQueuedPromptEdit(
			{ editingId: null, resumeAfterEdit: false, pauseRevision: null },
			"q1",
			false,
		);
		const editing = { ...first.state, pauseRevision: 4 };
		const second = beginQueuedPromptEdit(editing, "q2", true);
		const finished = finishQueuedPromptEdit(second.state, 4);

		expect(first.shouldPause).toBe(true);
		expect(second).toEqual({
			state: {
				editingId: "q2",
				resumeAfterEdit: true,
				pauseRevision: 4,
			},
			shouldPause: false,
		});
		expect(finished.shouldResume).toBe(true);
	});

	it("does not resume a queue that was paused before editing", () => {
		const editing = beginQueuedPromptEdit(
			{ editingId: null, resumeAfterEdit: false, pauseRevision: null },
			"q1",
			true,
		);

		expect(editing.shouldPause).toBe(false);
		expect(finishQueuedPromptEdit(editing.state, 3).shouldResume).toBe(
			false,
		);
	});

	it("explicit Resume closes editing and resumes regardless of origin", () => {
		const editing = beginQueuedPromptEdit(
			{ editingId: null, resumeAfterEdit: false, pauseRevision: null },
			"q1",
			true,
		);
		const finished = finishQueuedPromptEdit(editing.state, 3, true);

		expect(finished).toEqual({
			state: {
				editingId: null,
				resumeAfterEdit: false,
				pauseRevision: null,
			},
			shouldResume: true,
		});
	});

	it("does not resume when a newer pause supersedes the edit pause", () => {
		const editing = beginQueuedPromptEdit(
			{ editingId: null, resumeAfterEdit: false, pauseRevision: null },
			"q1",
			false,
		);
		const ownedPause = { ...editing.state, pauseRevision: 7 };

		expect(finishQueuedPromptEdit(ownedPause, 8).shouldResume).toBe(false);
	});

	it("takes matching work without removing another session's jobs", () => {
		const queue = [
			{ sessionId: "session-a", value: "from-a" },
			{ sessionId: "session-b", value: "from-b" },
		];

		const result = takeNextQueueItemForSession(queue, "session-b");

		expect(result.item).toEqual({
			sessionId: "session-b",
			value: "from-b",
		});
		expect(result.remaining).toEqual([
			{ sessionId: "session-a", value: "from-a" },
		]);
	});

	it("leaves the queue untouched when the session has no matching job", () => {
		const queue = [{ sessionId: "session-a", value: "from-a" }];

		const result = takeNextQueueItemForSession(queue, "session-b");

		expect(result.item).toBeNull();
		expect(result.remaining).toBe(queue);
	});

	it("restores a failed job at the front of the queue", () => {
		const failed = { sessionId: "session-a", value: "failed" };
		const waiting = { sessionId: "session-a", value: "waiting" };

		expect(requeueItemAtFront([waiting], failed)).toEqual([
			failed,
			waiting,
		]);
	});

	it("accepts dispatch only while queue generation and session still match", () => {
		expect(isQueueDispatchCurrent(4, 4, "session-a", "session-a")).toBe(
			true,
		);
		expect(isQueueDispatchCurrent(4, 5, "session-a", "session-a")).toBe(
			false,
		);
		expect(isQueueDispatchCurrent(4, 4, "session-a", "session-b")).toBe(
			false,
		);
		expect(isQueueDispatchCurrent(4, 4, "session-a", null)).toBe(false);
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
