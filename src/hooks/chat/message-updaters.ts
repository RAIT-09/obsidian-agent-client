import type {
	ChatMessage,
	MessageContent,
} from "../../domain/models/chat-message";
import type { SessionUpdate } from "../../domain/models/session-update";

type ToolCallMessageContent = Extract<MessageContent, { type: "tool_call" }>;
type ToolCallContentEntry = NonNullable<
	ToolCallMessageContent["content"]
>[number];
type DiffToolCallContent = Extract<ToolCallContentEntry, { type: "diff" }>;

function mergeToolCallEntries(
	existing: ToolCallMessageContent["content"],
	update: ToolCallMessageContent["content"],
): ToolCallMessageContent["content"] {
	if (update === undefined) {
		return existing;
	}

	const nextEntries = update ?? [];
	const previousDiffs = new Map<string, DiffToolCallContent>();

	for (const entry of existing ?? []) {
		if (entry.type === "diff") {
			previousDiffs.set(entry.path, entry);
		}
	}

	return nextEntries.map((entry) => {
		if (entry.type !== "diff") {
			return entry;
		}

		if (entry.oldText !== undefined) {
			return entry;
		}

		const previous = previousDiffs.get(entry.path);
		if (!previous || previous.oldText === undefined) {
			return entry;
		}

		return {
			...entry,
			oldText: previous.oldText,
		};
	});
}

export function mergeToolCallContent(
	existing: ToolCallMessageContent,
	update: ToolCallMessageContent,
): ToolCallMessageContent {
	const mergedContent = mergeToolCallEntries(existing.content, update.content);

	return {
		...existing,
		toolCallId: update.toolCallId,
		title: update.title !== undefined ? update.title : existing.title,
		kind: update.kind !== undefined ? update.kind : existing.kind,
		status: update.status !== undefined ? update.status : existing.status,
		content: mergedContent,
		locations:
			update.locations !== undefined ? update.locations : existing.locations,
		rawInput:
			update.rawInput !== undefined && Object.keys(update.rawInput).length > 0
				? update.rawInput
				: existing.rawInput,
		permissionRequest:
			update.permissionRequest !== undefined
				? update.permissionRequest
				: existing.permissionRequest,
	};
}

function appendOrMergeAssistantContent(
	messages: ChatMessage[],
	content: MessageContent,
): ChatMessage[] {
	if (messages.length === 0 || messages[messages.length - 1].role !== "assistant") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "assistant",
			content: [content],
			timestamp: new Date(),
		};
		return [...messages, newMessage];
	}

	const lastMessage = messages[messages.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text" || content.type === "agent_thought") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === content.type,
		);
		if (existingContentIndex >= 0) {
			const existingContent = updatedMessage.content[existingContentIndex];
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

	return [...messages.slice(0, -1), updatedMessage];
}

function appendOrMergeUserContent(
	messages: ChatMessage[],
	content: MessageContent,
): ChatMessage[] {
	if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
		const newMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [content],
			timestamp: new Date(),
		};
		return [...messages, newMessage];
	}

	const lastMessage = messages[messages.length - 1];
	const updatedMessage = { ...lastMessage };

	if (content.type === "text") {
		const existingContentIndex = updatedMessage.content.findIndex(
			(c) => c.type === "text",
		);
		if (existingContentIndex >= 0) {
			const existingContent = updatedMessage.content[existingContentIndex];
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

	return [...messages.slice(0, -1), updatedMessage];
}

function upsertToolCall(
	messages: ChatMessage[],
	toolCallId: string,
	content: ToolCallMessageContent,
): ChatMessage[] {
	let found = false;
	const updated = messages.map((message) => ({
		...message,
		content: message.content.map((entry) => {
			if (entry.type === "tool_call" && entry.toolCallId === toolCallId) {
				found = true;
				return mergeToolCallContent(entry, content);
			}
			return entry;
		}),
	}));

	if (found) {
		return updated;
	}

	return [
		...messages,
		{
			id: crypto.randomUUID(),
			role: "assistant",
			content: [content],
			timestamp: new Date(),
		},
	];
}

export function applySessionUpdateToMessages(
	messages: ChatMessage[],
	update: SessionUpdate,
): ChatMessage[] {
	switch (update.type) {
		case "agent_message_chunk":
			return appendOrMergeAssistantContent(messages, {
				type: "text",
				text: update.text,
			});

		case "agent_thought_chunk":
			return appendOrMergeAssistantContent(messages, {
				type: "agent_thought",
				text: update.text,
			});

		case "user_message_chunk":
			return appendOrMergeUserContent(messages, {
				type: "text",
				text: update.text,
			});

		case "tool_call":
		case "tool_call_update":
			return upsertToolCall(messages, update.toolCallId, {
				type: "tool_call",
				toolCallId: update.toolCallId,
				title: update.title,
				status: update.status || "pending",
				kind: update.kind,
				content: update.content,
				locations: update.locations,
				rawInput: update.rawInput,
				permissionRequest: update.permissionRequest,
			});

		case "plan":
			return appendOrMergeAssistantContent(messages, {
				type: "plan",
				entries: update.entries,
			});

		case "available_commands_update":
		case "current_mode_update":
		case "usage_update":
			return messages;

		default: {
			const exhaustiveCheck: never = update;
			return exhaustiveCheck;
		}
	}
}
