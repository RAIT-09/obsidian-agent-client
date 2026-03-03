import type {
	IVaultAccess,
} from "../../../domain/ports/vault-access.port";
import type {
	PromptContent,
} from "../../../domain/models/prompt-content";
import { extractMentionedNotes, type IMentionService } from "../../../shared/mention-utils";
import {
	extractChatContextTokensFromMessage,
	type ChatContextReference,
} from "../../../shared/chat-context-token";
import { extractSlashCommandTokens } from "../../../shared/slash-command-token";
import { convertWindowsPathToWsl } from "../../../shared/wsl-utils";
import { buildFileUri } from "../../../shared/path-utils";
import {
	DEFAULT_MAX_NOTE_LENGTH,
	DEFAULT_MAX_SELECTION_LENGTH,
	type PreparePromptInput,
	type PreparePromptResult,
} from "./types";
import {
	getImageMimeTypeForExtension,
	getPathExtension,
} from "../../../shared/mentionable-files";
import {
	buildManualContextPromptContent,
	buildAutoMentionResource,
	buildAutoMentionTextContext,
} from "./prompt-context-builders";

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	return btoa(binary);
}
export async function preparePrompt(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
): Promise<PreparePromptResult> {
	const { messageWithSlashAsText } = extractSlashCommandTokens(input.message);
	const { messageWithoutContextTokens, contexts } =
		extractChatContextTokensFromMessage(messageWithSlashAsText);
	const mentionedNotes = extractMentionedNotes(
		messageWithoutContextTokens,
		mentionService,
	);
	if (input.supportsEmbeddedContext) {
		return preparePromptWithEmbeddedContext(
			input,
			vaultAccess,
			mentionedNotes,
			contexts,
			messageWithoutContextTokens,
		);
	}
	return preparePromptWithTextContext(
		input,
		vaultAccess,
		mentionedNotes,
		contexts,
		messageWithoutContextTokens,
	);
}

async function preparePromptWithEmbeddedContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
	contextReferences: ChatContextReference[],
	userMessage: string,
): Promise<PreparePromptResult> {
	const resourceBlocks: PromptContent[] = [];
	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}
		try {
			const extension = getPathExtension(file.path);
			const imageMimeType = getImageMimeTypeForExtension(extension);
			if (imageMimeType) {
				if (input.supportsImage) {
					const fileBytes = await vaultAccess.readBinaryFile(file.path);
					resourceBlocks.push({
						type: "image",
						data: bytesToBase64(fileBytes),
						mimeType: imageMimeType,
					});
				} else {
					resourceBlocks.push({
						type: "text",
						text: `The user referenced image file ${file.path}, but this agent does not support image prompt content.`,
					});
				}
				continue;
			}

			const content = await vaultAccess.readNote(file.path);
			const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;

			let processedContent = content;
			if (content.length > maxNoteLen) {
				processedContent =
					content.substring(0, maxNoteLen) +
					`\n\n[Note: Truncated from ${content.length} to ${maxNoteLen} characters]`;
			}
			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;
			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			resourceBlocks.push({
				type: "resource",
				resource: {
					uri: buildFileUri(absolutePath),
					mimeType: "text/markdown",
					text: processedContent,
				},
				annotations: {
					audience: ["assistant"],
					priority: 1.0,
					lastModified: new Date(file.stat.mtime).toISOString(),
				},
			});
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	const contextBlocks = await buildManualContextPromptContent(
		contextReferences,
		input.vaultBasePath,
		vaultAccess,
		input.convertToWsl ?? false,
		input.supportsImage ?? false,
		input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH,
		input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
	);

	const autoMentionBlocks: PromptContent[] = [];
	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoMentionResource = await buildAutoMentionResource(
			input.activeNote,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
		);
		autoMentionBlocks.push(...autoMentionResource);
	}

	const displayContent: PromptContent[] = [
		...(userMessage ? [{ type: "text" as const, text: userMessage }] : []),
		...(input.images || []),
	];

	const autoMentionPrefix =
		input.activeNote && !input.isAutoMentionDisabled
			? input.activeNote.selection
				? `@[[${input.activeNote.name}]]:${input.activeNote.selection.from.line + 1}-${input.activeNote.selection.to.line + 1}\n`
				: `@[[${input.activeNote.name}]]\n`
			: "";

	const agentContent: PromptContent[] = [
		...resourceBlocks,
		...contextBlocks.embedded,
		...autoMentionBlocks,
		...(userMessage || autoMentionPrefix
			? [{ type: "text" as const, text: autoMentionPrefix + userMessage }]
			: []),
		...(input.images || []),
	];

	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine: input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayContent,
		agentContent,
		autoMentionContext,
	};
}

async function preparePromptWithTextContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
	contextReferences: ChatContextReference[],
	userMessage: string,
): Promise<PreparePromptResult> {
	const contextBlocks: string[] = [];
	const imageBlocks: PromptContent[] = [];

	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}

		try {
			const extension = getPathExtension(file.path);
			const imageMimeType = getImageMimeTypeForExtension(extension);
			if (imageMimeType) {
				if (input.supportsImage) {
					const fileBytes = await vaultAccess.readBinaryFile(file.path);
					imageBlocks.push({
						type: "image",
						data: bytesToBase64(fileBytes),
						mimeType: imageMimeType,
					});
				} else {
					contextBlocks.push(
						`<obsidian_mentioned_image ref="${file.path}">The user referenced this image, but the current agent does not support image prompt content.</obsidian_mentioned_image>`,
					);
				}
				continue;
			}

			const content = await vaultAccess.readNote(file.path);
			const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;

			let processedContent = content;
			let truncationNote = "";
			if (content.length > maxNoteLen) {
				processedContent = content.substring(0, maxNoteLen);
				truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${maxNoteLen} characters]`;
			}

			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;
			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			const contextBlock = `<obsidian_mentioned_note ref="${absolutePath}">\n${processedContent}${truncationNote}\n</obsidian_mentioned_note>`;
			contextBlocks.push(contextBlock);
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	const manualContextBlocks = await buildManualContextPromptContent(
		contextReferences,
		input.vaultBasePath,
		vaultAccess,
		input.convertToWsl ?? false,
		input.supportsImage ?? false,
		input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH,
		input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
	);
	contextBlocks.push(...manualContextBlocks.text);
	const manualContextImageBlocks = manualContextBlocks.embedded.filter(
		(block) => block.type === "image",
	);

	if (input.activeNote && !input.isAutoMentionDisabled) {
		const autoMentionContextBlock = await buildAutoMentionTextContext(
			input.activeNote.path,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			input.activeNote.selection,
			input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
		);
		contextBlocks.push(autoMentionContextBlock);
	}

	const autoMentionPrefix =
		input.activeNote && !input.isAutoMentionDisabled
			? input.activeNote.selection
				? `@[[${input.activeNote.name}]]:${input.activeNote.selection.from.line + 1}-${input.activeNote.selection.to.line + 1}\n`
				: `@[[${input.activeNote.name}]]\n`
			: "";

	const agentMessageText =
		contextBlocks.length > 0
			? contextBlocks.join("\n") + "\n\n" + autoMentionPrefix + userMessage
			: autoMentionPrefix + userMessage;

	const displayContent: PromptContent[] = [
		...(userMessage ? [{ type: "text" as const, text: userMessage }] : []),
		...(input.images || []),
	];
	const agentContent: PromptContent[] = [
		...imageBlocks,
		...manualContextImageBlocks,
		...(agentMessageText
			? [{ type: "text" as const, text: agentMessageText }]
			: []),
		...(input.images || []),
	];

	const autoMentionContext =
		input.activeNote && !input.isAutoMentionDisabled
			? {
					noteName: input.activeNote.name,
					notePath: input.activeNote.path,
					selection: input.activeNote.selection
						? {
								fromLine: input.activeNote.selection.from.line + 1,
								toLine: input.activeNote.selection.to.line + 1,
							}
						: undefined,
				}
			: undefined;

	return {
		displayContent,
		agentContent,
		autoMentionContext,
	};
}
