import { describe, it, expect } from "vitest";
import { findLatestPlan, summarizePlan } from "../src/services/message-state";
import type { ChatMessage, PlanEntry } from "../src/types/chat";

function msg(content: ChatMessage["content"]): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role: "assistant",
		content,
		timestamp: new Date("2026-01-01T00:00:00Z"),
	};
}

const entry = (
	status: PlanEntry["status"],
	content: string = status,
): PlanEntry => ({
	content,
	status,
	priority: "medium",
});

describe("findLatestPlan", () => {
	it("returns null when no message carries a plan", () => {
		expect(findLatestPlan([msg([{ type: "text", text: "hi" }])])).toBeNull();
	});

	it("returns the plan from the newest message that has one", () => {
		const older = [entry("completed", "old")];
		const newer = [entry("pending", "new")];
		const messages = [
			msg([{ type: "plan", entries: older }]),
			msg([{ type: "text", text: "..." }]),
			msg([{ type: "plan", entries: newer }]),
		];
		expect(findLatestPlan(messages)).toBe(newer);
	});

	it("looks past newer messages without a plan", () => {
		const entries = [entry("in_progress")];
		const messages = [
			msg([{ type: "plan", entries }]),
			msg([{ type: "text", text: "the turn moved on" }]),
		];
		expect(findLatestPlan(messages)).toBe(entries);
	});
});

describe("summarizePlan", () => {
	it("prefers the first in_progress entry", () => {
		const s = summarizePlan([
			entry("completed"),
			entry("in_progress", "current"),
			entry("in_progress", "second"),
			entry("pending"),
		]);
		expect(s).toMatchObject({ completed: 1, total: 4 });
		expect(s.current?.content).toBe("current");
	});

	it("falls back to the first pending when nothing is in progress", () => {
		const s = summarizePlan([
			entry("completed"),
			entry("pending", "next up"),
			entry("pending"),
		]);
		expect(s.current?.content).toBe("next up");
	});

	it("handles the all-pending first update", () => {
		const s = summarizePlan([entry("pending", "first"), entry("pending")]);
		expect(s).toMatchObject({ completed: 0, total: 2 });
		expect(s.current?.content).toBe("first");
	});

	it("returns no current entry when everything is done", () => {
		const s = summarizePlan([entry("completed"), entry("completed")]);
		expect(s).toMatchObject({ completed: 2, total: 2, current: null });
	});
});
