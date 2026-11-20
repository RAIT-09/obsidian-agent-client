import type { AttachedFile, QueuedPrompt } from "../types/chat";

export interface QueuedPromptEditState {
	editingId: string | null;
	resumeAfterEdit: boolean;
}

export interface BeginQueuedPromptEditResult {
	state: QueuedPromptEditState;
	shouldPause: boolean;
}

export interface FinishQueuedPromptEditResult {
	state: QueuedPromptEditState;
	shouldResume: boolean;
}

/**
 * Start or switch a queue edit without forgetting who paused the queue.
 * Switching from one item to another keeps the original resume intent.
 */
export function beginQueuedPromptEdit(
	state: QueuedPromptEditState,
	id: string,
	isPaused: boolean,
): BeginQueuedPromptEditResult {
	if (state.editingId !== null) {
		return {
			state: { ...state, editingId: id },
			shouldPause: false,
		};
	}

	return {
		state: {
			editingId: id,
			resumeAfterEdit: !isPaused,
		},
		shouldPause: !isPaused,
	};
}

/** Finish an edit and decide whether the queue should run again. */
export function finishQueuedPromptEdit(
	state: QueuedPromptEditState,
	resumeNow = false,
): FinishQueuedPromptEditResult {
	return {
		state: { editingId: null, resumeAfterEdit: false },
		shouldResume: resumeNow || state.resumeAfterEdit,
	};
}

/** Take the next item for a session without disturbing any other queued work. */
export function takeNextQueueItemForSession<T extends { sessionId: string }>(
	queue: T[],
	sessionId: string,
): { item: T | null; remaining: T[] } {
	const index = queue.findIndex((item) => item.sessionId === sessionId);
	if (index === -1) {
		return { item: null, remaining: queue };
	}
	return {
		item: queue[index],
		remaining: [...queue.slice(0, index), ...queue.slice(index + 1)],
	};
}

/** Restore a failed queue item ahead of work that has not been attempted. */
export function requeueItemAtFront<T>(queue: T[], item: T): T[] {
	return [item, ...queue];
}

/** Create an isolated queued-prompt snapshot for later dispatch. */
export function createQueuedPrompt(
	content: string,
	attachments: AttachedFile[] = [],
	id = crypto.randomUUID(),
	createdAt = new Date(),
): QueuedPrompt {
	return {
		id,
		content,
		attachments: [...attachments],
		createdAt,
	};
}

/** Update a queued prompt without mutating or reordering the source queue. */
export function updateQueuedPromptItem(
	queue: QueuedPrompt[],
	id: string,
	updates: Pick<QueuedPrompt, "content" | "attachments">,
): QueuedPrompt[] {
	return queue.map((item) =>
		item.id === id
			? {
					...item,
					content: updates.content,
					attachments: [...updates.attachments],
				}
			: item,
	);
}

/** Remove a queued prompt by id while preserving the order of all others. */
export function removeQueuedPromptItem(
	queue: QueuedPrompt[],
	id: string,
): QueuedPrompt[] {
	return queue.filter((item) => item.id !== id);
}
