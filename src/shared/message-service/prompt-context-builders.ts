import type {
	IVaultAccess,
	NoteMetadata,
	EditorPosition,
} from "../../domain/ports/vault-access.port";
import type {
	PromptContent,
	ResourcePromptContent,
} from "../../domain/models/prompt-content";
import { convertWindowsPathToWsl } from "../wsl-utils";
import { buildFileUri } from "../path-utils";
import type { ChatContextReference } from "../chat-context-token";

function buildAbsolutePath(
	vaultPath: string,
	notePath: string,
	convertToWsl: boolean,
): string {
	let absolutePath = vaultPath ? `${vaultPath}/${notePath}` : notePath;
	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}
	return absolutePath;
}

function normalizeRange(selection: {
	from: EditorPosition;
	to: EditorPosition;
}): { from: EditorPosition; to: EditorPosition } {
	const fromBeforeTo =
		selection.from.line < selection.to.line ||
		(selection.from.line === selection.to.line &&
			selection.from.ch <= selection.to.ch);
	return fromBeforeTo
		? selection
		: {
				from: selection.to,
				to: selection.from,
		};
}

function extractSelectionByCharacterRange(
	content: string,
	selection: {
		from: EditorPosition;
		to: EditorPosition;
	},
): string {
	const normalized = normalizeRange(selection);
	const lines = content.split("\n");
	if (lines.length === 0) {
		return "";
	}

	const fromLine = Math.max(
		0,
		Math.min(normalized.from.line, lines.length - 1),
	);
	const toLine = Math.max(0, Math.min(normalized.to.line, lines.length - 1));

	const fromCh = Math.max(
		0,
		Math.min(normalized.from.ch, lines[fromLine].length),
	);
	const toCh = Math.max(0, Math.min(normalized.to.ch, lines[toLine].length));

	if (fromLine === toLine) {
		return lines[fromLine].slice(fromCh, toCh);
	}

	const result: string[] = [];
	result.push(lines[fromLine].slice(fromCh));

	for (let line = fromLine + 1; line < toLine; line++) {
		result.push(lines[line]);
	}

	result.push(lines[toLine].slice(0, toCh));
	return result.join("\n");
}

function truncateTextForContext(
	text: string,
	maxLength: number,
	label: string,
): { text: string; truncationNote: string } {
	if (text.length <= maxLength) {
		return {
			text,
			truncationNote: "",
		};
	}

	return {
		text: text.substring(0, maxLength),
		truncationNote: `\n\n[Note: ${label} was truncated. Original length: ${text.length} characters, showing first ${maxLength} characters]`,
	};
}

export async function buildManualContextPromptContent(
	contextReferences: ChatContextReference[],
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	maxNoteLength: number,
	maxSelectionLength: number,
): Promise<{
	embedded: PromptContent[];
	text: string[];
}> {
	const embedded: PromptContent[] = [];
	const text: string[] = [];

	for (const context of contextReferences) {
		const absolutePath = buildAbsolutePath(
			vaultPath,
			context.notePath,
			convertToWsl,
		);
		const uri = buildFileUri(absolutePath);

		if (context.type === "folder") {
			embedded.push({
				type: "text",
				text: `The user explicitly attached the folder path ${absolutePath} as context.`,
			});
			text.push(
				`<obsidian_explicit_context type="folder-path" ref="${absolutePath}">Folder path only (no file content attached).</obsidian_explicit_context>`,
			);
			continue;
		}

		try {
			const noteContent = await vaultAccess.readNote(context.notePath);
			if (context.type === "selection" && context.selection) {
				const selectedText = extractSelectionByCharacterRange(
					noteContent,
					context.selection,
				);
				const trimmed = truncateTextForContext(
					selectedText,
					maxSelectionLength,
					"The selection",
				);
				const from = context.selection.from;
				const to = context.selection.to;

				embedded.push({
					type: "resource",
					resource: {
						uri,
						mimeType: "text/markdown",
						text: trimmed.text + trimmed.truncationNote,
					},
					annotations: {
						audience: ["assistant"],
						priority: 1.0,
					},
				});
				embedded.push({
					type: "text",
					text: `The user explicitly attached a text selection from ${uri} at ${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}.`,
				});

				text.push(
					`<obsidian_explicit_context type="selection" ref="${absolutePath}" range="${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}">
${trimmed.text}${trimmed.truncationNote}
</obsidian_explicit_context>`,
				);
				continue;
			}

			const trimmed = truncateTextForContext(
				noteContent,
				maxNoteLength,
				"The file context",
			);
			embedded.push({
				type: "resource",
				resource: {
					uri,
					mimeType: "text/markdown",
					text: trimmed.text + trimmed.truncationNote,
				},
				annotations: {
					audience: ["assistant"],
					priority: 0.95,
				},
			});
			embedded.push({
				type: "text",
				text: `The user explicitly attached the full file ${uri} as context.`,
			});

			text.push(
				`<obsidian_explicit_context type="full-file" ref="${absolutePath}">
${trimmed.text}${trimmed.truncationNote}
</obsidian_explicit_context>`,
			);
		} catch (error) {
			if (context.type === "selection" && context.selection) {
				const from = context.selection.from;
				const to = context.selection.to;
				embedded.push({
					type: "text",
					text: `The user attached a selection from ${uri} at ${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}, but the file could not be read.`,
				});
				text.push(
					`<obsidian_explicit_context type="selection" ref="${absolutePath}" range="${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}">Selection could not be read.</obsidian_explicit_context>`,
				);
			} else {
				embedded.push({
					type: "text",
					text: `The user attached ${uri} as full-file context, but the file could not be read.`,
				});
				text.push(
					`<obsidian_explicit_context type="full-file" ref="${absolutePath}">File could not be read.</obsidian_explicit_context>`,
				);
			}

			console.error(
				`Failed to read explicit context from ${context.notePath}:`,
				error,
			);
		}
	}

	return { embedded, text };
}

export async function buildAutoMentionResource(
	activeNote: NoteMetadata,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	maxSelectionLength: number,
): Promise<PromptContent[]> {
	const absolutePath = buildAbsolutePath(
		vaultPath,
		activeNote.path,
		convertToWsl,
	);
	const uri = buildFileUri(absolutePath);
 if (activeNote.selection) {
		const fromLine = activeNote.selection.from.line + 1;
		const toLine = activeNote.selection.to.line + 1;

		try {
			const content = await vaultAccess.readNote(activeNote.path);
			const lines = content.split("\n");
			const selectedLines = lines.slice(
				activeNote.selection.from.line,
				activeNote.selection.to.line + 1,
			);
			let selectedText = selectedLines.join("\n");
			if (selectedText.length > maxSelectionLength) {
				selectedText =
					selectedText.substring(0, maxSelectionLength) +
					`\n\n[Note: Truncated from ${selectedLines.join("\n").length} to ${maxSelectionLength} characters]`;
			}

			return [
				{
					type: "resource",
					resource: {
						uri,
						mimeType: "text/markdown",
						text: selectedText,
					},
					annotations: {
						audience: ["assistant"],
						priority: 0.8,
						lastModified: new Date(activeNote.modified).toISOString(),
					},
				} as ResourcePromptContent,
				{
					type: "text",
					text: `The user has selected lines ${fromLine}-${toLine} in the above note. This is what they are currently focusing on.`,
				},
			];
		} catch (error) {
			console.error(`Failed to read selection from ${activeNote.path}:`, error);
			return [
				{
					type: "text",
					text: `The user has selected lines ${fromLine}-${toLine} in ${uri}. If relevant, use the Read tool to examine the specific lines.`,
				},
			];
		}
	}

	return [
		{
			type: "text",
			text: `The user has opened the note ${uri} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.`,
		},
	];
}

export async function buildAutoMentionTextContext(
	notePath: string,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	selection: { from: EditorPosition; to: EditorPosition } | undefined,
	maxSelectionLength: number,
): Promise<string> {
	const absolutePath = buildAbsolutePath(vaultPath, notePath, convertToWsl);

	if (selection) {
		const fromLine = selection.from.line + 1;
		const toLine = selection.to.line + 1;

		try {
			const content = await vaultAccess.readNote(notePath);
			const lines = content.split("\n");
			const selectedLines = lines.slice(
				selection.from.line,
				selection.to.line + 1,
			);
			let selectedText = selectedLines.join("\n");

			let truncationNote = "";
			if (selectedText.length > maxSelectionLength) {
				selectedText = selectedText.substring(0, maxSelectionLength);
				truncationNote = `\n\n[Note: The selection was truncated. Original length: ${selectedLines.join("\n").length} characters, showing first ${maxSelectionLength} characters]`;
			}

			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">
The user opened the note ${absolutePath} in Obsidian and selected the following text (lines ${fromLine}-${toLine}):

${selectedText}${truncationNote}

This is what the user is currently focusing on.
</obsidian_opened_note>`;
		} catch (error) {
			console.error(`Failed to read selection from ${notePath}:`, error);
			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">The user opened the note ${absolutePath} in Obsidian and is focusing on lines ${fromLine}-${toLine}. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the specific lines.</obsidian_opened_note>`;
		}
	}

	return `<obsidian_opened_note>The user opened the note ${absolutePath} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>`;
}
