import { describe, it, expect } from "vitest";
import { insertMentions } from "../src/utils/mention-parser";

describe("insertMentions", () => {
	it("inserts into empty input with a trailing space", () => {
		expect(insertMentions("", 0, ["Note"])).toEqual({
			newText: "@[[Note]] ",
			newCursorPos: 10,
		});
	});

	it("pads with a leading space when glued to preceding text", () => {
		expect(insertMentions("see", 3, ["Note"])).toEqual({
			newText: "see @[[Note]] ",
			newCursorPos: 14,
		});
	});

	it("does not double existing whitespace around the caret", () => {
		const { newText, newCursorPos } = insertMentions("see  this", 4, [
			"Note",
		]);
		expect(newText).toBe("see @[[Note]] this");
		expect(newCursorPos).toBe("see @[[Note]]".length);
	});

	it("joins multiple notes with spaces", () => {
		expect(insertMentions("", 0, ["A", "B c"]).newText).toBe(
			"@[[A]] @[[B c]] ",
		);
	});

	it("clamps an out-of-range position to the end", () => {
		expect(insertMentions("hi", 99, ["N"]).newText).toBe("hi @[[N]] ");
	});

	it("is a no-op for an empty note list", () => {
		expect(insertMentions("hi", 1, [])).toEqual({
			newText: "hi",
			newCursorPos: 1,
		});
	});
});
