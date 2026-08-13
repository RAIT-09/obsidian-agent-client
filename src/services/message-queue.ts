import type { AttachedFile, QueuedPrompt } from "../types/chat";

/** Drop work from other sessions and take the next item for this session. */
export function takeNextQueueItemForSession<T extends { sessionId: string }>(
	queue: T[],
	sessionId: string,
): { item: T | null; remaining: T[] } {
	const matching = queue.filter((item) => item.sessionId === sessionId);
	return {
		item: matching[0] ?? null,
		remaining: matching.slice(1),
	};
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
