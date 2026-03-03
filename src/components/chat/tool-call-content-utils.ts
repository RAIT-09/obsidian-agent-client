import * as Diff from "diff";
import type { MessageContent } from "../../domain/models/chat-message";

type ToolCallContent = Extract<MessageContent, { type: "tool_call" }>["content"];

export function countDiffStats(
	content: ToolCallContent,
): { added: number; removed: number } | null {
	if (!content) return null;
	let added = 0;
	let removed = 0;
	for (const item of content) {
		if (item.type !== "diff") continue;
		const oldText = item.oldText || "";
		const newText = item.newText || "";
		if (!oldText && !newText) continue;
		if (!oldText) {
			added += newText.split("\n").length;
			continue;
		}
		const changes = Diff.diffLines(oldText, newText);
		for (const change of changes) {
			if (change.added) added += change.count ?? 0;
			else if (change.removed) removed += change.count ?? 0;
		}
	}
	if (added === 0 && removed === 0) return null;
	return { added, removed };
}

export function extractRawPatchText(
	rawInput: { [k: string]: unknown } | undefined,
): string | null {
	if (!rawInput) return null;
	for (const key of ["diff", "patch", "unified_diff"]) {
		const value = rawInput[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return null;
}

export function countRawPatchStats(
	text: string,
): { added: number; removed: number } | null {
	let added = 0;
	let removed = 0;
	for (const line of text.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}
	if (added === 0 && removed === 0) return null;
	return { added, removed };
}
