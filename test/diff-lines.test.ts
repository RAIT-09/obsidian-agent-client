import { describe, it, expect } from "vitest";
import { computeDiffLines } from "../src/utils/diff-lines";

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
