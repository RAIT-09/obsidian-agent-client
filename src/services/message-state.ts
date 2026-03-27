/**
 * Pure functions for message state updates.
 *
 * These functions are extracted from useMessages to keep the hook thin
 * and to allow independent testing. They handle message array transformations
 * for streaming updates, tool call management, and permission state.
 */

import type {
	ChatMessage,
	MessageContent,
	ActivePermission,
	PermissionOption,
} from "../types/chat";
import type { SessionUpdate } from "../types/session";

// ============================================================================
// Types
// ============================================================================

/** Tool call content type extracted for type safety */
export type ToolCallMessageContent = Extract<
	MessageContent,
	{ type: "tool_call" }
>;

// ============================================================================
// Tool Call Merge
// ============================================================================

/**
 * Merge new tool call content into existing tool call.
 * Preserves existing values when new values are undefined.
 */
export function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	// Merge content arrays
	let mergedContent = existing.content || [];
	if (update.content !== undefined) {
		const newContent = update.content || [];

		// If new content contains diff, replace all old diffs
		const hasDiff = newContent.some((item) => item.type === "diff");
		if (hasDiff) {
			mergedContent = mergedContent.filter(
				(item) => item.type !== "diff",
			);
		}

		mergedContent = [...mergedContent, ...newContent];
	}

	return {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		status: update.status !== undefined ? update.status : existing.status,
		content: mergedContent,
		locations:
			update.locations !== undefined
				? update.locations
				: existing.locations,
		rawInput:
			update.rawInput !== undefined &&
			Object.keys(update.rawInput).length > 0
				? update.rawInput
				: existing.rawInput,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
}

// ============================================================================
// Message Array Update Functions (for batching)
// ============================================================================

/**
 * Apply a "last assistant message" update to the messages array.
 * Creates a new assistant message if needed.
 */
export function applyUpdateLastMessage(
	prev: ChatMessage[],
	content: MessageContent,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [content],
			timestamp: new Date(),
		};
		return [...prev, newMessage];
	}

	const lastMessage = prev[prev.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text" || content.type === "agent_thought") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingContentIndex >= 0) {
			const existingContent =
				updatedMessage.content[existingContentIndex];
			if (
				existingContent.type === "text" ||
				existingContent.type === "agent_thought"
			) {
				updatedMessage.content[existingContentIndex] = {
					type: content.type,
					text: existingContent.text + content.text,
				};
			}
		} else {
			updatedMessage.content.push(content);
		}
	} else {
		const existingIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingIndex >= 0) {
			updatedMessage.content[existingIndex] = content;
		} else {
			updatedMessage.content.push(content);
		}
	}

	return [...prev.slice(0, -1), updatedMessage];
}

/**
 * Apply a "last user message" update to the messages array.
 * Creates a new user message if needed. Used for session/load history replay.
 */
export function applyUpdateUserMessage(
	prev: ChatMessage[],
	content: MessageContent,
): ChatMessage[] {
	if (prev.length === 0 || prev[prev.length - 1].role !== "user") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [content],
			timestamp: new Date(),
		};
		return [...prev, newMessage];
	}

	const lastMessage = prev[prev.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === "text",
		);
		if (existingContentIndex >= 0) {
			const existingContent =
				updatedMessage.content[existingContentIndex];
			if (existingContent.type === "text") {
				updatedMessage.content[existingContentIndex] = {
					type: "text",
					text: existingContent.text + content.text,
				};
			}
		} else {
			updatedMessage.content.push(content);
		}
	} else {
		const existingIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingIndex >= 0) {
			updatedMessage.content[existingIndex] = content;
		} else {
			updatedMessage.content.push(content);
		}
	}

	return [...prev.slice(0, -1), updatedMessage];
}

/**
 * Apply a tool call upsert to the messages array.
 * If a tool call with the given ID exists, merges. Otherwise creates new message.
 */
export function applyUpsertToolCall(
	prev: ChatMessage[],
	content: ToolCallMessageContent,
	toolCallIndex: Map<string, number>,
): ChatMessage[] {
	// O(1) lookup via index
	const messageIdx = toolCallIndex.get(content.toolCallId);
	if (messageIdx !== undefined && messageIdx < prev.length) {
		const message = prev[messageIdx];
		const hasTarget = message.content.some(
			(c) =>
				c.type === "tool_call" &&
				c.toolCallId === content.toolCallId,
		);
		if (hasTarget) {
			const updatedMessage = {
				...message,
				content: message.content.map((c) => {
					if (
						c.type === "tool_call" &&
						c.toolCallId === content.toolCallId
					) {
						return mergeToolCallContent(c, content);
					}
					return c;
				}),
			};
			const result = [...prev];
			result[messageIdx] = updatedMessage;
			return result;
		}
	}

	// Fallback: linear scan (index miss or stale index)
	let found = false;
	const updated = prev.map((message, idx) => {
		const hasTarget = message.content.some(
			(c) =>
				c.type === "tool_call" &&
				c.toolCallId === content.toolCallId,
		);
		if (!hasTarget) return message;
		found = true;
		toolCallIndex.set(content.toolCallId, idx); // Fix stale index
		return {
			...message,
			content: message.content.map((c) => {
				if (
					c.type === "tool_call" &&
					c.toolCallId === content.toolCallId
				) {
					return mergeToolCallContent(c, content);
				}
				return c;
			}),
		};
	});

	if (found) return updated;

	// Not found: create new message and register in index
	toolCallIndex.set(content.toolCallId, prev.length);
	return [
		...prev,
		{
			id: crypto.randomUUID(),
			role: "assistant" as const,
			content: [content],
			timestamp: new Date(),
		},
	];
}

/**
 * Rebuild the tool call index from a messages array.
 */
export function rebuildToolCallIndex(
	messages: ChatMessage[],
	toolCallIndex: Map<string, number>,
): void {
	toolCallIndex.clear();
	messages.forEach((msg, msgIdx) => {
		for (const c of msg.content) {
			if (c.type === "tool_call") {
				toolCallIndex.set(c.toolCallId, msgIdx);
			}
		}
	});
}

/**
 * Apply a single session update to the messages array.
 * Returns the same array reference if no change (session-level updates).
 */
export function applySingleUpdate(
	prev: ChatMessage[],
	update: SessionUpdate,
	toolCallIndex: Map<string, number>,
): ChatMessage[] {
	switch (update.type) {
		case "agent_message_chunk":
			return applyUpdateLastMessage(prev, {
				type: "text",
				text: update.text,
			});
		case "agent_thought_chunk":
			return applyUpdateLastMessage(prev, {
				type: "agent_thought",
				text: update.text,
			});
		case "user_message_chunk":
			return applyUpdateUserMessage(prev, {
				type: "text",
				text: update.text,
			});
		case "tool_call":
		case "tool_call_update":
			return applyUpsertToolCall(
				prev,
				{
					type: "tool_call",
					toolCallId: update.toolCallId,
					title: update.title,
					status: update.status || "pending",
					kind: update.kind,
					content: update.content,
					locations: update.locations,
					rawInput: update.rawInput,
					permissionRequest: update.permissionRequest,
				},
				toolCallIndex,
			);
		case "plan":
			return applyUpdateLastMessage(prev, {
				type: "plan",
				entries: update.entries,
			});
		default:
			return prev;
	}
}

// ============================================================================
// Permission Helper Functions
// ============================================================================

/**
 * Find the active permission request from messages.
 */
export function findActivePermission(
	messages: ChatMessage[],
): ActivePermission | null {
	for (const message of messages) {
		for (const content of message.content) {
			if (content.type === "tool_call") {
				const permission = content.permissionRequest;
				if (permission?.isActive) {
					return {
						requestId: permission.requestId,
						toolCallId: content.toolCallId,
						options: permission.options,
					};
				}
			}
		}
	}
	return null;
}

/**
 * Select an option from the available options based on preferred kinds.
 */
export function selectOption(
	options: PermissionOption[],
	preferredKinds: PermissionOption["kind"][],
	fallback?: (option: PermissionOption) => boolean,
): PermissionOption | undefined {
	for (const kind of preferredKinds) {
		const match = options.find((opt) => opt.kind === kind);
		if (match) return match;
	}
	if (fallback) {
		const fallbackOption = options.find(fallback);
		if (fallbackOption) return fallbackOption;
	}
	return options[0];
}
