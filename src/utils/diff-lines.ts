import * as Diff from "diff";

/** One fragment of a word-level diff, tagged with how it changed. */
export interface DiffWordPart {
	type: "added" | "removed" | "context";
	value: string;
}

/**
 * Represents a single line in a diff view
 * @property type - The type of change: added, removed, or unchanged context
 * @property oldLineNumber - Line number in the old file (undefined for added lines)
 * @property newLineNumber - Line number in the new file (undefined for removed lines)
 * @property content - The text content of the line
 * @property wordDiff - Optional word-level diff for lines that were modified
 */
export interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: DiffWordPart[];
}

/** Whether the diff represents a brand-new file (no old content). */
export function isNewFileDiff(oldText: string | null | undefined): boolean {
	return oldText === null || oldText === undefined || oldText === "";
}

// Helper function to map diff parts to our internal format
function mapDiffParts(parts: Diff.Change[]): DiffWordPart[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

// Number of context lines to show around changes
const CONTEXT_LINES = 3;

/**
 * Turn an old/new text pair into displayable diff lines.
 *
 * Produces unified-diff lines with line numbers, hunk headers when there
 * is more than one hunk, and word-level highlight parts attached to
 * one-line replacements (in larger blocks no pairing is reliable, so
 * those get line-level coloring only). A brand-new file renders every
 * line as added.
 */
export function computeDiffLines(
	oldText: string | null | undefined,
	newText: string,
): DiffLine[] {
	if (isNewFileDiff(oldText)) {
		// New file - all lines are added
		const lines = newText.split("\n");
		// split() leaves an empty item after a terminal newline; not a real line.
		if (lines[lines.length - 1] === "") lines.pop();
		return lines.map(
			(line, idx): DiffLine => ({
				type: "added",
				newLineNumber: idx + 1,
				content: line,
			}),
		);
	}

	// Use structuredPatch to get a proper unified diff
	// At this point, oldText is guaranteed to be a non-empty string (checked by isNewFileDiff)
	const patch = Diff.structuredPatch(
		"old",
		"new",
		oldText || "",
		newText,
		"",
		"",
		{ context: CONTEXT_LINES },
	);

	const result: DiffLine[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;

	// Process hunks
	for (const hunk of patch.hunks) {
		// Add hunk header only if there are multiple hunks
		// (helps users see gaps between different sections of changes)
		if (patch.hunks.length > 1) {
			result.push({
				type: "context",
				content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
			});
		}

		oldLineNum = hunk.oldStart;
		newLineNum = hunk.newStart;

		for (const line of hunk.lines) {
			const marker = line[0];
			// jsdiff metadata, not file content ("\ No newline at end of file").
			if (marker === "\\") continue;
			const content = line.substring(1);

			if (marker === "+") {
				result.push({
					type: "added",
					newLineNumber: newLineNum++,
					content,
				});
			} else if (marker === "-") {
				result.push({
					type: "removed",
					oldLineNumber: oldLineNum++,
					content,
				});
			} else {
				// Context line (unchanged)
				result.push({
					type: "context",
					oldLineNumber: oldLineNum++,
					newLineNumber: newLineNum++,
					content,
				});
			}
		}
	}

	// Word-level highlights only for 1:1 replacements: in an N:M block the
	// adjacent pairing is arbitrary and usually relates unrelated lines.
	let i = 0;
	while (i < result.length) {
		if (result[i].type !== "removed") {
			i++;
			continue;
		}
		const removedStart = i;
		while (i < result.length && result[i].type === "removed") i++;
		const addedStart = i;
		while (i < result.length && result[i].type === "added") i++;
		if (addedStart - removedStart === 1 && i - addedStart === 1) {
			const removed = result[removedStart];
			const added = result[addedStart];
			// Whitespace-sensitive: parts must reconstruct each side verbatim,
			// or the deleted line renders with the added line's whitespace.
			const wordDiff = mapDiffParts(
				Diff.diffWordsWithSpace(removed.content, added.content),
			);
			removed.wordDiff = wordDiff;
			added.wordDiff = wordDiff;
		}
	}

	return result;
}
