import type { ChatMessage, MessageContent } from "../types/chat";

const QUESTION_SUMMARY_LIMIT = 160;
const RESPONSE_SUMMARY_LIMIT = 280;

export interface ConversationNavigationItem {
	id: string;
	messageIndex: number;
	question: string;
	response: string;
}

export interface ConversationMessagePosition {
	index: number;
	start: number;
	end: number;
}

function normalizeSummary(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncateSummary(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function appendSummary(
	current: string,
	value: string,
	limit: number,
): { value: string; complete: boolean } {
	const normalized = normalizeSummary(value);
	if (!normalized) return { value: current, complete: false };
	const combined = current ? `${current} ${normalized}` : normalized;
	return combined.length > limit
		? { value: truncateSummary(combined, limit), complete: true }
		: { value: combined, complete: false };
}

function textFromContent(
	content: MessageContent[],
	limit: number,
): string | undefined {
	let summary = "";
	for (const item of content) {
		if (item.type !== "text" && item.type !== "text_with_context") continue;
		const result = appendSummary(summary, item.text, limit);
		summary = result.value;
		if (result.complete) break;
	}
	return summary || undefined;
}

function textFromMessages(
	messages: ChatMessage[],
	limit: number,
): string | undefined {
	let summary = "";
	for (const message of messages) {
		for (const item of message.content) {
			if (item.type !== "text" && item.type !== "text_with_context") {
				continue;
			}
			const result = appendSummary(summary, item.text, limit);
			summary = result.value;
			if (result.complete) return summary;
		}
	}
	return summary || undefined;
}

function getUserFallback(message: ChatMessage): string {
	if (message.content.some((item) => item.type === "image")) {
		return "Image message";
	}
	const resource = message.content.find(
		(item) => item.type === "resource_link",
	);
	if (resource?.type === "resource_link") {
		return `Attachment: ${resource.name}`;
	}
	return "User message";
}

function getAssistantFallback(messages: ChatMessage[]): string {
	const toolCall = messages
		.flatMap((message) => message.content)
		.find((item) => item.type === "tool_call");
	if (toolCall?.type === "tool_call") {
		return toolCall.title
			? `Tool activity: ${toolCall.title}`
			: "Assistant used tools in this turn.";
	}
	if (
		messages.some((message) =>
			message.content.some((item) => item.type === "image"),
		)
	) {
		return "Assistant response includes an image.";
	}
	if (
		messages.some((message) =>
			message.content.some((item) => item.type === "resource_link"),
		)
	) {
		return "Assistant response includes an attachment.";
	}
	return "No text response in this turn.";
}

export function getConversationNavigationItems(
	messages: ChatMessage[],
): ConversationNavigationItem[] {
	const items: ConversationNavigationItem[] = [];

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const userMessage = messages[messageIndex];
		if (userMessage.role !== "user") continue;

		let nextUserIndex = messageIndex + 1;
		while (
			nextUserIndex < messages.length &&
			messages[nextUserIndex].role !== "user"
		) {
			nextUserIndex++;
		}
		const assistantMessages = messages
			.slice(messageIndex + 1, nextUserIndex)
			.filter((message) => message.role === "assistant");
		items.push({
			id: userMessage.id,
			messageIndex,
			question: truncateSummary(
				textFromContent(userMessage.content, QUESTION_SUMMARY_LIMIT) ??
					getUserFallback(userMessage),
				QUESTION_SUMMARY_LIMIT,
			),
			response: truncateSummary(
				textFromMessages(assistantMessages, RESPONSE_SUMMARY_LIMIT) ||
					getAssistantFallback(assistantMessages),
				RESPONSE_SUMMARY_LIMIT,
			),
		});
	}

	return items;
}

export function selectActiveNavigationIndex(
	items: ConversationNavigationItem[],
	positions: ConversationMessagePosition[],
	anchorOffset: number,
	isAtBottom: boolean,
): number {
	if (items.length === 0) return -1;
	if (isAtBottom) return items.length - 1;
	if (positions.length === 0) return 0;

	let anchorMessageIndex = positions[0].index;
	for (const position of positions) {
		if (anchorOffset >= position.start) {
			anchorMessageIndex = position.index;
		}
		if (anchorOffset < position.end) break;
	}

	let activeIndex = 0;
	for (let index = 0; index < items.length; index++) {
		if (items[index].messageIndex > anchorMessageIndex) break;
		activeIndex = index;
	}
	return activeIndex;
}
