import { describe, it, expect } from "vitest";
import {
	computeDiffLines,
	type DiffLine,
	type DiffWordPart,
} from "../src/utils/diff-lines";

/**
 * Rebuild a line's display text the way DiffRenderer's renderWordDiff does:
 * a removed line renders every part except "added" ones, an added line every
 * part except "removed" ones. Mirrors the component's filter rule.
 */
function renderedText(line: DiffLine): string {
	if (!line.wordDiff) return line.content;
	const skip = line.type === "removed" ? "added" : "removed";
	return line.wordDiff
		.filter((part: DiffWordPart) => part.type !== skip)
		.map((part) => part.value)
		.join("");
}

describe("no-newline marker lines", () => {
	// Texts without a trailing newline (the routine shape of snippet diffs)
	// make structuredPatch emit "\ No newline at end of file" between sides.
	it("are not rendered as diff rows", () => {
		const lines = computeDiffLines("old", "new");
		expect(lines.map((l) => l.content)).toEqual(["old", "new"]);
	});

	it("do not break word-diff adjacency for snippet diffs", () => {
		const lines = computeDiffLines("old", "new");
		expect(lines.find((l) => l.type === "removed")?.wordDiff).toBeDefined();
		expect(lines.find((l) => l.type === "added")?.wordDiff).toBeDefined();
	});
});

const RECONSTRUCTION_CASES: [string, string, string][] = [
	["spaces to tabs", "  return 1;", "\t\treturn 1;"],
	["indent halved plus arg change", "    foo(a);", "  foo(b);"],
	["checkbox fill", "- [ ] task one", "- [x] task one"],
	["cjk text", "日本語のテキストです", "日本語の文章です"],
	["trailing whitespace dropped", "trailing  ", "trailing"],
	["inner whitespace collapsed", "a,  b", "a, b"],
];

describe("word diff reconstructs each side verbatim", () => {
	for (const [name, oldLine, newLine] of RECONSTRUCTION_CASES) {
		it(name, () => {
			const lines = computeDiffLines(oldLine, newLine);
			const removed = lines.find((l) => l.type === "removed");
			const added = lines.find((l) => l.type === "added");
			expect(removed?.wordDiff).toBeDefined();
			expect(renderedText(removed!)).toBe(oldLine);
			expect(renderedText(added!)).toBe(newLine);
		});
	}
});

function joinLines(lines: string[]): string {
	return lines.join("\n");
}

describe("word diff pairing", () => {
	it("highlights a 1:1 replacement", () => {
		const lines = computeDiffLines(
			joinLines(["keep", "old line", "keep2"]),
			joinLines(["keep", "new line", "keep2"]),
		);
		expect(lines.find((l) => l.type === "removed")?.wordDiff).toBeDefined();
		expect(lines.find((l) => l.type === "added")?.wordDiff).toBeDefined();
	});

	it("shares one parts array between the pair", () => {
		const lines = computeDiffLines("a", "b");
		expect(lines.find((l) => l.type === "removed")?.wordDiff).toBe(
			lines.find((l) => l.type === "added")?.wordDiff,
		);
	});

	it("skips an N:N block entirely", () => {
		const lines = computeDiffLines(
			joinLines(["old 1", "old 2", "old 3"]),
			joinLines(["new 1", "new 2", "new 3"]),
		);
		expect(lines.every((l) => l.wordDiff === undefined)).toBe(true);
	});

	it("skips unbalanced blocks (2:1 and 1:2)", () => {
		const a = computeDiffLines(
			joinLines(["x", "old 1", "old 2", "y"]),
			joinLines(["x", "new", "y"]),
		);
		const b = computeDiffLines(
			joinLines(["x", "old", "y"]),
			joinLines(["x", "new 1", "new 2", "y"]),
		);
		expect([...a, ...b].every((l) => l.wordDiff === undefined)).toBe(true);
	});

	it("highlights each separate 1:1 block independently", () => {
		const lines = computeDiffLines(
			joinLines(["keep", "old a", "keep", "old b", "keep"]),
			joinLines(["keep", "new a", "keep", "new b", "keep"]),
		);
		expect(lines.filter((l) => l.wordDiff !== undefined)).toHaveLength(4);
	});

	it("puts no highlights on pure deletions or additions", () => {
		const del = computeDiffLines(
			joinLines(["keep", "gone", "keep2"]),
			joinLines(["keep", "keep2"]),
		);
		const add = computeDiffLines(
			joinLines(["keep", "keep2"]),
			joinLines(["keep", "born", "keep2"]),
		);
		expect([...del, ...add].every((l) => l.wordDiff === undefined)).toBe(
			true,
		);
	});

	it("renders a new file as added lines without highlights", () => {
		const lines = computeDiffLines(null, joinLines(["a", "b"]));
		expect(
			lines.every((l) => l.type === "added" && l.wordDiff === undefined),
		).toBe(true);
	});
});
