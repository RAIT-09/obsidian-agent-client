import type { EditorPosition } from "../domain/ports/vault-access.port";

export interface DisplaySelectionRange {
	fromLine: number;
	fromColumn: number;
	toLine: number;
	toColumn: number;
}

export function toDisplaySelectionRange(selection: {
	from: EditorPosition;
	to: EditorPosition;
}): DisplaySelectionRange {
	return {
		fromLine: selection.from.line + 1,
		fromColumn: selection.from.ch + 1,
		toLine: selection.to.line + 1,
		toColumn: selection.to.ch + 1,
	};
}

export function formatSelectionRangeLabel(
	range: DisplaySelectionRange,
): string {
	if (range.fromLine === range.toLine) {
		return `L${range.fromLine}:C${range.fromColumn}-C${range.toColumn}`;
	}

	return `L${range.fromLine}:C${range.fromColumn}-L${range.toLine}:C${range.toColumn}`;
}

export function formatAutoMentionPrefix(
	noteName: string,
	range?: DisplaySelectionRange,
): string {
	const base = `@[[${noteName}]]`;
	return range ? `${base} ${formatSelectionRangeLabel(range)}\n` : `${base}\n`;
}

export function extractSelectionText(
	content: string,
	selection: {
		from: EditorPosition;
		to: EditorPosition;
	},
): string {
	const lines = content.split("\n");

	if (selection.from.line === selection.to.line) {
		return (
			lines[selection.from.line]?.slice(
				selection.from.ch,
				selection.to.ch,
			) ?? ""
		);
	}

	const selectedParts: string[] = [];

	for (
		let lineIndex = selection.from.line;
		lineIndex <= selection.to.line;
		lineIndex++
	) {
		const line = lines[lineIndex] ?? "";

		if (lineIndex === selection.from.line) {
			selectedParts.push(line.slice(selection.from.ch));
			continue;
		}

		if (lineIndex === selection.to.line) {
			selectedParts.push(line.slice(0, selection.to.ch));
			continue;
		}

		selectedParts.push(line);
	}

	return selectedParts.join("\n");
}
