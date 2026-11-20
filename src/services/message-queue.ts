import type { AttachedFile, QueuedPrompt } from "../types/chat";

export interface QueuedPromptEditState {
	editingId: string | null;
	resumeAfterEdit: boolean;
	pauseRevision: number | null;
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
			pauseRevision: null,
		},
		shouldPause: !isPaused,
	};
}

/** Finish an edit and decide whether the queue should run again. */
export function finishQueuedPromptEdit(
	state: QueuedPromptEditState,
	currentPauseRevision: number,
	resumeNow = false,
): FinishQueuedPromptEditResult {
	return {
		state: {
			editingId: null,
			resumeAfterEdit: false,
			pauseRevision: null,
		},
		shouldResume:
			resumeNow ||
			(state.resumeAfterEdit &&
				state.pauseRevision === currentPauseRevision),
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

/** Whether an async queue dispatch still belongs to the active queue/session. */
export function isQueueDispatchCurrent(
	expectedGeneration: number,
	currentGeneration: number,
	expectedSessionId: string,
	currentSessionId: string | null,
): boolean {
	return (
		expectedGeneration === currentGeneration &&
		expectedSessionId === currentSessionId
	);
}

/** Move one queue item to another item's position without mutating the source. */
export function moveQueueItem<T>(
	queue: T[],
	fromIndex: number,
	toIndex: number,
): T[] {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= queue.length ||
		toIndex >= queue.length
	) {
		return queue;
	}

	const reordered = [...queue];
	const [item] = reordered.splice(fromIndex, 1);
	reordered.splice(toIndex, 0, item);
	return reordered;
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
