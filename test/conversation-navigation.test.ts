import { describe, expect, it } from "vitest";
import {
	getConversationNavigationItems,
	selectActiveNavigationIndex,
} from "../src/services/conversation-navigation";
import type { ChatMessage, MessageContent } from "../src/types/chat";

function message(
	id: string,
	role: ChatMessage["role"],
	content: MessageContent[],
): ChatMessage {
	return { id, role, content, timestamp: new Date("2026-08-07T00:00:00Z") };
}

describe("conversation navigation projection", () => {
	it("maps each user turn to its message index and response", () => {
		const items = getConversationNavigationItems([
			message("a0", "assistant", [{ type: "text", text: "Welcome" }]),
			message("u1", "user", [{ type: "text", text: "First question" }]),
			message("a1", "assistant", [
				{ type: "text", text: "First answer" },
			]),
			message("u2", "user", [{ type: "text", text: "Second question" }]),
			message("a2", "assistant", [
				{ type: "text", text: "Second answer" },
			]),
		]);

		expect(items).toEqual([
			{
				id: "u1",
				messageIndex: 1,
				question: "First question",
				response: "First answer",
			},
			{
				id: "u2",
				messageIndex: 3,
				question: "Second question",
				response: "Second answer",
			},
		]);
	});

	it("normalizes whitespace, truncates summaries, and uses fallbacks", () => {
		const longQuestion = `  ${"question ".repeat(30)} `;
		const longResponse = `\n${"response ".repeat(50)}\n`;
		const textItems = getConversationNavigationItems([
			message("u1", "user", [
				{ type: "text_with_context", text: longQuestion },
			]),
			message("a1", "assistant", [{ type: "text", text: longResponse }]),
		]);

		expect(textItems[0].question).toHaveLength(160);
		expect(textItems[0].question.endsWith("…")).toBe(true);
		expect(textItems[0].response).toHaveLength(280);
		expect(textItems[0].response.endsWith("…")).toBe(true);
		expect(textItems[0].question).not.toMatch(/\s{2,}/);

		const fallbackItems = getConversationNavigationItems([
			message("u2", "user", [
				{ type: "image", data: "image", mimeType: "image/png" },
			]),
			message("a2", "assistant", [
				{ type: "image", data: "image", mimeType: "image/png" },
			]),
		]);

		expect(fallbackItems[0].question).toBe("Image message");
		expect(fallbackItems[0].response).toBe(
			"Assistant response includes an image.",
		);
	});
});

describe("active conversation navigation selection", () => {
	const items = [
		{ id: "u1", messageIndex: 1, question: "one", response: "answer" },
		{ id: "u2", messageIndex: 3, question: "two", response: "answer" },
		{ id: "u3", messageIndex: 5, question: "three", response: "answer" },
	];
	const positions = [
		{ index: 0, start: 0, end: 100 },
		{ index: 1, start: 100, end: 300 },
		{ index: 2, start: 300, end: 420 },
		{ index: 3, start: 420, end: 620 },
		{ index: 4, start: 620, end: 720 },
		{ index: 5, start: 720, end: 920 },
	];

	it("selects the user turn at the reading anchor", () => {
		expect(selectActiveNavigationIndex(items, positions, 20, false)).toBe(
			0,
		);
		expect(selectActiveNavigationIndex(items, positions, 450, false)).toBe(
			1,
		);
		expect(selectActiveNavigationIndex(items, positions, 800, false)).toBe(
			2,
		);
	});

	it("selects the final turn when the viewport is at the bottom", () => {
		expect(selectActiveNavigationIndex(items, positions, 120, true)).toBe(
			2,
		);
	});
});
