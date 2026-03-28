import test from "node:test";
import assert from "node:assert/strict";

import {
	formatSelectionRangeLabel,
	formatAutoMentionPrefix,
	extractSelectionText,
} from "./selection-range.ts";

test("formatSelectionRangeLabel renders a single-line selection with columns", () => {
	assert.equal(
		formatSelectionRangeLabel({
			fromLine: 45,
			fromColumn: 12,
			toLine: 45,
			toColumn: 28,
		}),
		"L45:C12-C28",
	);
});

test("formatSelectionRangeLabel renders a multi-line selection with full endpoints", () => {
	assert.equal(
		formatSelectionRangeLabel({
			fromLine: 45,
			fromColumn: 12,
			toLine: 47,
			toColumn: 3,
		}),
		"L45:C12-L47:C3",
	);
});

test("formatAutoMentionPrefix includes the formatted range when selection exists", () => {
	assert.equal(
		formatAutoMentionPrefix("台灣零售與電商競爭分析", {
			fromLine: 45,
			fromColumn: 12,
			toLine: 45,
			toColumn: 28,
		}),
		"@[[台灣零售與電商競爭分析]] L45:C12-C28\n",
	);
});

test("formatAutoMentionPrefix falls back to plain note mention without selection", () => {
	assert.equal(
		formatAutoMentionPrefix("台灣零售與電商競爭分析"),
		"@[[台灣零售與電商競爭分析]]\n",
	);
});

test("extractSelectionText returns only the selected columns for a single-line selection", () => {
	assert.equal(
		extractSelectionText(
			["0123456789", "abcdefghij"].join("\n"),
			{
				from: { line: 0, ch: 2 },
				to: { line: 0, ch: 6 },
			},
		),
		"2345",
	);
});

test("extractSelectionText returns only the selected span for a multi-line selection", () => {
	assert.equal(
		extractSelectionText(
			["0123456789", "abcdefghij", "KLMNOPQRST"].join("\n"),
			{
				from: { line: 0, ch: 8 },
				to: { line: 2, ch: 3 },
			},
		),
		["89", "abcdefghij", "KLM"].join("\n"),
	);
});
