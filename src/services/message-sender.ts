/**
 * Message Service
 *
 * Pure functions for prompt preparation and sending.
 * Extracted from SendMessageUseCase for better separation of concerns.
 *
 * Responsibilities:
 * - Process mentions (@[[note]] syntax)
 * - Add auto-mention for active note
 * - Convert mentions to file paths
 * - Send prompt to agent via AcpClient
 * - Handle authentication errors with retry logic
 */

import type { AcpClient } from "../acp/acp-client";
import type {
	IVaultAccess,
	NoteMetadata,
	EditorPosition,
} from "../services/vault-service";
import { AcpErrorCode, type AcpError } from "../types/errors";
import {
	extractErrorCode,
	toAcpError,
	isEmptyResponseError,
} from "../utils/error-utils";
import type { AuthenticationMethod } from "../types/session";
import type {
	PromptContent,
	ImagePromptContent,
	ResourcePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import {
	extractMentionedNotes,
	type IMentionService,
} from "../utils/mention-parser";
import { convertWindowsPathToWsl } from "../utils/platform";
import { buildFileUri } from "../utils/paths";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for preparing a prompt
 */
export interface PreparePromptInput {
	/** User's message text (may contain @mentions) */
	message: string;

	/** Attached images */
	images?: ImagePromptContent[];

	/** Attached file references (resource links) */
	resourceLinks?: ResourceLinkPromptContent[];

	/** Currently active note (for auto-mention feature) */
	activeNote?: NoteMetadata | null;

	/** Vault base path for converting mentions to absolute paths */
	vaultBasePath: string;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled?: boolean;

	/** Whether to convert paths to WSL format (Windows + WSL mode) */
	convertToWsl?: boolean;

	/** Whether agent supports embeddedContext capability */
	supportsEmbeddedContext?: boolean;

	/** Maximum characters per mentioned note (default: 10000) */
	maxNoteLength?: number;

	/** Maximum characters for selection (default: 10000) */
	maxSelectionLength?: number;

	/** Whether this is the first message in the session */
	isFirstMessage?: boolean;

	/** Prompt injection settings (undefined = disabled) */
	promptInjection?: {
		latex?: boolean;
	};
}

/**
 * Result of preparing a prompt
 */
export interface PreparePromptResult {
	/** Content for UI display (original text + images) */
	displayContent: PromptContent[];

	/** Content to send to agent (processed text + images) */
	agentContent: PromptContent[];

	/** Auto-mention context metadata (if auto-mention is active) */
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

/**
 * Input for sending a prepared prompt
 */
export interface SendPreparedPromptInput {
	/** Current session ID */
	sessionId: string;

	/** The prepared agent content (from preparePrompt) */
	agentContent: PromptContent[];

	/** The display content (for error reporting) */
	displayContent: PromptContent[];

	/** Available authentication methods */
	authMethods: AuthenticationMethod[];
}

/**
 * Result of sending a prompt
 */
export interface SendPromptResult {
	/** Whether the prompt was sent successfully */
	success: boolean;

	/** The display content */
	displayContent: PromptContent[];

	/** The agent content sent */
	agentContent: PromptContent[];

	/** Error information if sending failed */
	error?: AcpError;

	/** Whether authentication is required */
	requiresAuth?: boolean;

	/** Whether the prompt was successfully sent after retry */
	retriedSuccessfully?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_NOTE_LENGTH = 10000; // Default maximum characters per note
const DEFAULT_MAX_SELECTION_LENGTH = 10000; // Default maximum characters for selection
const LATEX_MATH_INSTRUCTION =
	"This client uses Obsidian Flavored Markdown. For math, use $...$ for inline and $$...$$ for display (not \\(...\\) or \\[...\\]).";

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Processed note data ready for formatting.
 */
interface ProcessedNote {
	content: string;
	absolutePath: string;
	uri: string;
	lastModified: string;
	wasTruncated: boolean;
	originalLength: number;
}

/**
 * Read a note, truncate if needed, and resolve its absolute path.
 */
async function processNote(
	file: { path: string; stat: { mtime: number } },
	vaultBasePath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	maxNoteLength: number,
): Promise<ProcessedNote | null> {
	try {
		const content = await vaultAccess.readNote(file.path);

		let absolutePath = vaultBasePath
			? `${vaultBasePath}/${file.path}`
			: file.path;

		if (convertToWsl) {
			absolutePath = convertWindowsPathToWsl(absolutePath);
		}

		const wasTruncated = content.length > maxNoteLength;
		const processedContent = wasTruncated
			? content.substring(0, maxNoteLength)
			: content;

		return {
			content: processedContent,
			absolutePath,
			uri: buildFileUri(absolutePath),
			lastModified: new Date(file.stat.mtime).toISOString(),
			wasTruncated,
			originalLength: content.length,
		};
	} catch (error) {
		console.error(`Failed to read note ${file.path}:`, error);
		return null;
	}
}

/**
 * Read selected text from a note and truncate if needed.
 */
async function readSelection(
	notePath: string,
	selection: { from: EditorPosition; to: EditorPosition },
	vaultAccess: IVaultAccess,
	maxSelectionLength: number,
): Promise<{
	text: string;
	wasTruncated: boolean;
	originalLength: number;
} | null> {
	try {
		const content = await vaultAccess.readNote(notePath);
		const lines = content.split("\n");
		const selectedLines = lines.slice(
			selection.from.line,
			selection.to.line + 1,
		);
		const fullText = selectedLines.join("\n");
		const wasTruncated = fullText.length > maxSelectionLength;

		return {
			text: wasTruncated
				? fullText.substring(0, maxSelectionLength)
				: fullText,
			wasTruncated,
			originalLength: fullText.length,
		};
	} catch (error) {
		console.error(`Failed to read selection from ${notePath}:`, error);
		return null;
	}
}

/**
 * Build auto-mention prefix string for session/load recovery.
 * Format: "@[[note name]]:from-to\n" or "@[[note name]]\n"
 */
function buildAutoMentionPrefix(
	activeNote: NoteMetadata | null | undefined,
	isDisabled: boolean | undefined,
): string {
	if (!activeNote || isDisabled) return "";
	if (activeNote.selection) {
		return `@[[${activeNote.name}]]:${activeNote.selection.from.line + 1}-${activeNote.selection.to.line + 1}\n`;
	}
	return `@[[${activeNote.name}]]\n`;
}

/**
 * Build system prompt instruction strings for Obsidian-flavored Markdown.
 * Returns an array of instruction strings to inject.
 * Empty array if not first message or no instructions enabled.
 */
function buildSystemInstructions(input: PreparePromptInput): string[] {
	if (!input.isFirstMessage) return [];
	if (!input.promptInjection) return [];

	const instructions: string[] = [];

	if (input.promptInjection.latex) {
		instructions.push(LATEX_MATH_INSTRUCTION);
	}

	return instructions;
}

function buildAgentMessageText(
	message: string,
	autoMentionPrefix: string,
	contextBlocks?: string[],
): string {
	const userMessage = autoMentionPrefix + message;

	return [
		...(contextBlocks && contextBlocks.length > 0
			? [contextBlocks.join("\n")]
			: []),
		...(userMessage ? [userMessage] : []),
	].join("\n\n");
}

/**
 * Build display content array (message + images + resource links).
 */
function buildDisplayContent(input: PreparePromptInput): PromptContent[] {
	return [
		...(input.message
			? [{ type: "text" as const, text: input.message }]
			: []),
		...(input.images || []),
		...(input.resourceLinks || []),
	];
}

/**
 * Build auto-mention context metadata for UI.
 */
function buildAutoMentionContext(
	activeNote: NoteMetadata | null | undefined,
	isDisabled: boolean | undefined,
): PreparePromptResult["autoMentionContext"] {
	if (!activeNote || isDisabled) return undefined;
	return {
		noteName: activeNote.name,
		notePath: activeNote.path,
		selection: activeNote.selection
			? {
					fromLine: activeNote.selection.from.line + 1,
					toLine: activeNote.selection.to.line + 1,
				}
			: undefined,
	};
}

/**
 * Resolve absolute path with optional WSL conversion.
 */
function resolveAbsolutePath(
	relativePath: string,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	let absolutePath = vaultBasePath
		? `${vaultBasePath}/${relativePath}`
		: relativePath;
	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}
	return absolutePath;
}

// ============================================================================
// Prompt Preparation Functions
// ============================================================================

/**
 * Prepare a prompt for sending to the agent.
 *
 * Processes the message by:
 * - Building context blocks for mentioned notes
 * - Adding auto-mention context for active note
 * - Creating agent content with context + user message + images + resource links
 *
 * When agent supports embeddedContext capability, mentioned notes are sent
 * as Resource content blocks. Otherwise, they are embedded as XML text.
 */
export async function preparePrompt(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
): Promise<PreparePromptResult> {
	// Step 1: Extract all mentioned notes from the message
	const mentionedNotes = extractMentionedNotes(input.message, mentionService);

	// Step 2: Build context based on agent capabilities
	if (input.supportsEmbeddedContext) {
		return preparePromptWithEmbeddedContext(
			input,
			vaultAccess,
			mentionedNotes,
		);
	} else {
		return preparePromptWithTextContext(input, vaultAccess, mentionedNotes);
	}
}

/**
 * Prepare prompt using embedded Resource format (for embeddedContext-capable agents).
 */
async function preparePromptWithEmbeddedContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
): Promise<PreparePromptResult> {
	const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;
	const resourceBlocks: ResourcePromptContent[] = [];

	// Build Resource blocks for each mentioned note
	for (const { file } of mentionedNotes) {
		if (!file) continue;

		const note = await processNote(
			file,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			maxNoteLen,
		);
		if (!note) continue;

		const text = note.wasTruncated
			? note.content +
				`\n\n[Note: Truncated from ${note.originalLength} to ${maxNoteLen} characters]`
			: note.content;

		resourceBlocks.push({
			type: "resource",
			resource: { uri: note.uri, mimeType: "text/markdown", text },
			annotations: {
				audience: ["assistant"],
				priority: 1.0,
				lastModified: note.lastModified,
			},
		});
	}

	// Build auto-mention Resource block
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

	const autoMentionPrefix = buildAutoMentionPrefix(
		input.activeNote,
		input.isAutoMentionDisabled,
	);

	// Build system prompt instructions (first message only)
	const systemInstructions = buildSystemInstructions(input);
	const systemBlocks: PromptContent[] = systemInstructions.map((text) => ({
		type: "text" as const,
		text,
	}));

	const agentContent: PromptContent[] = [
		...systemBlocks,
		...resourceBlocks,
		...autoMentionBlocks,
		...(input.message || autoMentionPrefix
			? [
					{
						type: "text" as const,
						text: autoMentionPrefix + input.message,
					},
				]
			: []),
		...(input.images || []),
		...(input.resourceLinks || []),
	];

	return {
		displayContent: buildDisplayContent(input),
		agentContent,
		autoMentionContext: buildAutoMentionContext(
			input.activeNote,
			input.isAutoMentionDisabled,
		),
	};
}

/**
 * Prepare prompt using XML text format (fallback for agents without embeddedContext).
 */
async function preparePromptWithTextContext(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionedNotes: Array<{
		noteTitle: string;
		file: { path: string; stat: { mtime: number } } | undefined;
	}>,
): Promise<PreparePromptResult> {
	const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;
	const contextBlocks: string[] = [];

	// Build XML context blocks for each mentioned note
	for (const { file } of mentionedNotes) {
		if (!file) continue;

		const note = await processNote(
			file,
			input.vaultBasePath,
			vaultAccess,
			input.convertToWsl ?? false,
			maxNoteLen,
		);
		if (!note) continue;

		const truncationNote = note.wasTruncated
			? `\n\n[Note: This note was truncated. Original length: ${note.originalLength} characters, showing first ${maxNoteLen} characters]`
			: "";

		contextBlocks.push(
			`<obsidian_mentioned_note ref="${note.absolutePath}">\n${note.content}${truncationNote}\n</obsidian_mentioned_note>`,
		);
	}

	// Build auto-mention XML context
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

	// Build system prompt instructions (first message only)
	const systemInstructions = buildSystemInstructions(input);
	for (const instruction of systemInstructions) {
		contextBlocks.push(
			`<obsidian_system_instruction>\n${instruction}\n</obsidian_system_instruction>`,
		);
	}

	const autoMentionPrefix = buildAutoMentionPrefix(
		input.activeNote,
		input.isAutoMentionDisabled,
	);

	const agentMessageText = buildAgentMessageText(
		input.message,
		autoMentionPrefix,
		contextBlocks,
	);

	const agentContent: PromptContent[] = [
		...(agentMessageText
			? [{ type: "text" as const, text: agentMessageText }]
			: []),
		...(input.images || []),
		...(input.resourceLinks || []),
	];

	return {
		displayContent: buildDisplayContent(input),
		agentContent,
		autoMentionContext: buildAutoMentionContext(
			input.activeNote,
			input.isAutoMentionDisabled,
		),
	};
}

/**
 * Build Resource content blocks for auto-mentioned note.
 */
async function buildAutoMentionResource(
	activeNote: NoteMetadata,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	maxSelectionLength: number,
): Promise<PromptContent[]> {
	const absolutePath = resolveAbsolutePath(
		activeNote.path,
		vaultPath,
		convertToWsl,
	);
	const uri = buildFileUri(absolutePath);

	if (activeNote.selection) {
		const fromLine = activeNote.selection.from.line + 1;
		const toLine = activeNote.selection.to.line + 1;

		const sel = await readSelection(
			activeNote.path,
			activeNote.selection,
			vaultAccess,
			maxSelectionLength,
		);
		if (!sel) {
			return [
				{
					type: "text",
					text: `The user has selected lines ${fromLine}-${toLine} in ${uri}. If relevant, use the Read tool to examine the specific lines.`,
				},
			];
		}

		const text = sel.wasTruncated
			? sel.text +
				`\n\n[Note: Truncated from ${sel.originalLength} to ${maxSelectionLength} characters]`
			: sel.text;

		return [
			{
				type: "resource",
				resource: { uri, mimeType: "text/markdown", text },
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
	}

	return [
		{
			type: "text",
			text: `The user has opened the note ${uri} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.`,
		},
	];
}

/**
 * Build XML text context from auto-mentioned note (fallback format).
 */
async function buildAutoMentionTextContext(
	notePath: string,
	vaultPath: string,
	vaultAccess: IVaultAccess,
	convertToWsl: boolean,
	selection: { from: EditorPosition; to: EditorPosition } | undefined,
	maxSelectionLength: number,
): Promise<string> {
	const absolutePath = resolveAbsolutePath(notePath, vaultPath, convertToWsl);

	if (selection) {
		const fromLine = selection.from.line + 1;
		const toLine = selection.to.line + 1;

		const sel = await readSelection(
			notePath,
			selection,
			vaultAccess,
			maxSelectionLength,
		);
		if (!sel) {
			return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">The user opened the note ${absolutePath} in Obsidian and is focusing on lines ${fromLine}-${toLine}. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the specific lines.</obsidian_opened_note>`;
		}

		const truncationNote = sel.wasTruncated
			? `\n\n[Note: The selection was truncated. Original length: ${sel.originalLength} characters, showing first ${maxSelectionLength} characters]`
			: "";

		return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">
The user opened the note ${absolutePath} in Obsidian and selected the following text (lines ${fromLine}-${toLine}):

${sel.text}${truncationNote}

This is what the user is currently focusing on.
</obsidian_opened_note>`;
	}

	return `<obsidian_opened_note>The user opened the note ${absolutePath} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>`;
}

// ============================================================================
// Prompt Sending Functions
// ============================================================================

/**
 * Send a prepared prompt to the agent.
 */
export async function sendPreparedPrompt(
	input: SendPreparedPromptInput,
	agentClient: AcpClient,
): Promise<SendPromptResult> {
	try {
		await agentClient.sendPrompt(input.sessionId, input.agentContent);

		return {
			success: true,
			displayContent: input.displayContent,
			agentContent: input.agentContent,
		};
	} catch (error) {
		return await handleSendError(
			error,
			input.sessionId,
			input.agentContent,
			input.displayContent,
			input.authMethods,
			agentClient,
		);
	}
}

// ============================================================================
// Error Handling Functions
// ============================================================================

/**
 * Handle errors that occur during prompt sending.
 *
 * Error handling strategy:
 * 1. "empty response text" errors are ignored (not real errors)
 * 2. -32000 (Authentication Required) triggers authentication retry
 * 3. All other errors are converted to AcpError and displayed directly
 */
async function handleSendError(
	error: unknown,
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethods: AuthenticationMethod[],
	agentClient: AcpClient,
): Promise<SendPromptResult> {
	// Check for "empty response text" error - ignore silently
	if (isEmptyResponseError(error)) {
		return {
			success: true,
			displayContent,
			agentContent,
		};
	}

	const errorCode = extractErrorCode(error);

	// Only attempt authentication retry for -32000 (Authentication Required)
	if (errorCode === AcpErrorCode.AUTHENTICATION_REQUIRED) {
		// Check if authentication methods are available
		if (authMethods && authMethods.length > 0) {
			// Try automatic authentication retry if only one method available
			if (authMethods.length === 1) {
				const retryResult = await retryWithAuthentication(
					sessionId,
					agentContent,
					displayContent,
					authMethods[0].id,
					agentClient,
				);

				if (retryResult) {
					return retryResult;
				}
			}

			// Multiple auth methods or retry failed - let user choose
			return {
				success: false,
				displayContent,
				agentContent,
				requiresAuth: true,
				error: toAcpError(error, sessionId),
			};
		}

		// No auth methods available - still show the error
		// This is not an error condition, agent just doesn't support auth
	}

	// For all other errors, convert to AcpError and display directly
	// The agent's error message is preserved and shown to the user
	return {
		success: false,
		displayContent,
		agentContent,
		error: toAcpError(error, sessionId),
	};
}

/**
 * Retry sending prompt after authentication.
 */
async function retryWithAuthentication(
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethodId: string,
	agentClient: AcpClient,
): Promise<SendPromptResult | null> {
	try {
		const authSuccess = await agentClient.authenticate(authMethodId);

		if (!authSuccess) {
			return null;
		}

		await agentClient.sendPrompt(sessionId, agentContent);

		return {
			success: true,
			displayContent,
			agentContent,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		// Convert retry error to AcpError
		return {
			success: false,
			displayContent,
			agentContent,
			error: toAcpError(retryError, sessionId),
		};
	}
}
