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
import {
	type IWikilinkResolver,
	type BasenameIndex,
} from "../utils/wikilink-resolver";
import { formatLinkedNotesPrelude } from "../utils/wikilink-formatter";
import type {
	IAgentWorkspace,
	WorkspaceSnapshot,
} from "./agent-workspace";

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

	/** Whether to enrich note content with wikilink metadata (default: false) */
	expandWikilinkContext?: boolean;

	/** Resolver for `[[wikilinks]]` inside note content; required when expandWikilinkContext=true */
	wikilinkResolver?: IWikilinkResolver | null;

	/**
	 * Agent Workspace integration. When provided, a `<obsidian_workspace>` seed
	 * (or `<obsidian_workspace_update>` delta) is prepended to the prompt.
	 * `snapshot=null` triggers a seed; otherwise the service computes a delta
	 * relative to the snapshot.
	 */
	agentWorkspace?: {
		service: IAgentWorkspace;
		snapshot: WorkspaceSnapshot | null;
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

	/**
	 * Agent Workspace snapshot to commit on successful send. Always defined
	 * when `input.agentWorkspace` was provided; otherwise omitted.
	 */
	pendingWorkspaceSnapshot?: WorkspaceSnapshot;
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
 * Per-prompt scan context: built once at the top of `preparePrompt`,
 * threaded into helpers so the basename index isn't rebuilt per mention.
 */
interface WikilinkScanContext {
	resolver: IWikilinkResolver;
	basenameIndex: BasenameIndex;
	vaultBasePath: string;
	convertToWsl: boolean;
}

/**
 * Build the wikilink scan context, or null when expansion is disabled
 * or the resolver port wasn't provided.
 */
function buildWikilinkContext(
	input: PreparePromptInput,
): WikilinkScanContext | null {
	if (!input.expandWikilinkContext || !input.wikilinkResolver) return null;
	return {
		resolver: input.wikilinkResolver,
		basenameIndex: input.wikilinkResolver.buildBasenameIndex(),
		vaultBasePath: input.vaultBasePath,
		convertToWsl: input.convertToWsl ?? false,
	};
}

/**
 * Prepend the `<obsidian_metadata>` prelude to note content when wikilinks
 * are present. No-op when ctx is null or the note has no resolvable links.
 */
function decorateWithLinkedNotes(
	rawContent: string,
	sourcePath: string,
	ctx: WikilinkScanContext | null,
): string {
	if (!ctx) return rawContent;
	const links = ctx.resolver.extractLinkedNoteMetadata(
		rawContent,
		sourcePath,
		ctx.basenameIndex,
	);
	const prelude = formatLinkedNotesPrelude(links, {
		vaultBasePath: ctx.vaultBasePath,
		convertToWsl: ctx.convertToWsl,
	});
	return prelude + rawContent;
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

	// Step 2: Build the Agent Workspace prelude (seed or delta) up-front so
	// both transport branches can prepend it to their first text block.
	const workspace = await buildAgentWorkspacePrelude(input);

	// Step 3: Build context based on agent capabilities
	const result = input.supportsEmbeddedContext
		? await preparePromptWithEmbeddedContext(
				input,
				vaultAccess,
				mentionedNotes,
				workspace.prelude,
			)
		: await preparePromptWithTextContext(
				input,
				vaultAccess,
				mentionedNotes,
				workspace.prelude,
			);

	if (workspace.pendingSnapshot) {
		result.pendingWorkspaceSnapshot = workspace.pendingSnapshot;
	}
	return result;
}

/**
 * Compute the Agent Workspace prelude string + the snapshot to commit on
 * successful send. Returns empty prelude when the integration is not enabled.
 */
async function buildAgentWorkspacePrelude(
	input: PreparePromptInput,
): Promise<{
	prelude: string;
	pendingSnapshot: WorkspaceSnapshot | undefined;
}> {
	if (!input.agentWorkspace) {
		return { prelude: "", pendingSnapshot: undefined };
	}
	try {
		const result = await input.agentWorkspace.service.buildPrelude(
			input.agentWorkspace.snapshot,
			{
				vaultBasePath: input.vaultBasePath,
				convertToWsl: input.convertToWsl ?? false,
				wikilinkResolver: input.wikilinkResolver ?? null,
				expandWikilinkContext:
					input.expandWikilinkContext ?? false,
			},
		);
		return {
			prelude: result.prelude,
			pendingSnapshot: result.pendingSnapshot,
		};
	} catch (error) {
		console.error("[message-sender] Workspace prelude failed:", error);
		return { prelude: "", pendingSnapshot: undefined };
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
	workspacePrelude: string,
): Promise<PreparePromptResult> {
	const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;
	const wikilinkCtx = buildWikilinkContext(input);
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

		const baseText = note.wasTruncated
			? note.content +
				`\n\n[Note: Truncated from ${note.originalLength} to ${maxNoteLen} characters]`
			: note.content;
		const text = decorateWithLinkedNotes(baseText, file.path, wikilinkCtx);

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
			wikilinkCtx,
		);
		autoMentionBlocks.push(...autoMentionResource);
	}

	const autoMentionPrefix = buildAutoMentionPrefix(
		input.activeNote,
		input.isAutoMentionDisabled,
	);

	const messageText = autoMentionPrefix + input.message;
	const includeTextBlock =
		messageText.length > 0 || workspacePrelude.length > 0;

	const agentContent: PromptContent[] = [
		...resourceBlocks,
		...autoMentionBlocks,
		...(includeTextBlock
			? [
					{
						type: "text" as const,
						text: workspacePrelude + messageText,
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
	workspacePrelude: string,
): Promise<PreparePromptResult> {
	const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;
	const wikilinkCtx = buildWikilinkContext(input);
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

		const decoratedBody = decorateWithLinkedNotes(
			note.content,
			file.path,
			wikilinkCtx,
		);

		contextBlocks.push(
			`<obsidian_mentioned_note ref="${note.absolutePath}">\n${decoratedBody}${truncationNote}\n</obsidian_mentioned_note>`,
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
			wikilinkCtx,
		);
		contextBlocks.push(autoMentionContextBlock);
	}

	const autoMentionPrefix = buildAutoMentionPrefix(
		input.activeNote,
		input.isAutoMentionDisabled,
	);

	// Build agent message text (workspace prelude + context blocks + auto-mention prefix + original message)
	const baseText =
		contextBlocks.length > 0
			? contextBlocks.join("\n") +
				"\n\n" +
				autoMentionPrefix +
				input.message
			: autoMentionPrefix + input.message;
	const agentMessageText = workspacePrelude + baseText;

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
	wikilinkCtx: WikilinkScanContext | null,
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

		const baseText = sel.wasTruncated
			? sel.text +
				`\n\n[Note: Truncated from ${sel.originalLength} to ${maxSelectionLength} characters]`
			: sel.text;
		const text = decorateWithLinkedNotes(
			baseText,
			activeNote.path,
			wikilinkCtx,
		);

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
	wikilinkCtx: WikilinkScanContext | null,
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

		const decoratedSelection = decorateWithLinkedNotes(
			sel.text,
			notePath,
			wikilinkCtx,
		);

		return `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">
The user opened the note ${absolutePath} in Obsidian and selected the following text (lines ${fromLine}-${toLine}):

${decoratedSelection}${truncationNote}

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
