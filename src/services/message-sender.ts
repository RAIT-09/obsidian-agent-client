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
import type {
	AuthenticationMethod,
	AutoMentionSnapshot,
} from "../types/session";
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
	WorkspaceXmlBlock,
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

	/**
	 * Last auto-mention payload signature shipped to the agent. The auto-mention
	 * Resource/XML block is suppressed when the current activeNote signature
	 * equals this snapshot (seed-then-delta gate). `null`/`undefined` triggers
	 * a fresh seed. See docs/design/auto-mention-context.md.
	 */
	autoMentionSnapshot?: AutoMentionSnapshot | null;
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

	/**
	 * Auto-mention snapshot to commit on successful send. Defined only when
	 * the auto-mention block was actually emitted this turn (signature
	 * differed from `input.autoMentionSnapshot`). When omitted, the hook
	 * leaves the existing per-session snapshot untouched.
	 */
	pendingAutoMentionSnapshot?: AutoMentionSnapshot;
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
	uri: string;
	lastModified: string;
	wasTruncated: boolean;
	originalLength: number;
}

/**
 * Read a note, truncate if needed, and resolve its `file://` URI.
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

		const uri = resolveFileUri(file.path, vaultBasePath, convertToWsl);

		const wasTruncated = content.length > maxNoteLength;
		const processedContent = wasTruncated
			? content.substring(0, maxNoteLength)
			: content;

		return {
			content: processedContent,
			uri,
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
 * Resolve a `file://` URI for a vault-relative path, applying optional WSL
 * conversion first. Single canonical reference for all emitted prompt
 * content — see CLAUDE.md "Prefer URI over absolute path" note.
 */
function resolveFileUri(
	relativePath: string,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const joined = vaultBasePath
		? `${vaultBasePath}/${relativePath}`
		: relativePath;
	const absolutePath = convertToWsl ? convertWindowsPathToWsl(joined) : joined;
	return buildFileUri(absolutePath);
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

	// Step 2: Build the Agent Workspace blocks (state + optional instructions)
	// up-front so both transport branches can place them appropriately.
	const workspace = await buildAgentWorkspaceBlocks(input);

	// Step 3: Wikilink scan context — single basename-index build per prompt,
	// reused by mentioned-note decoration and by the auto-mention slice.
	const wikilinkCtx = buildWikilinkContext(input);

	// Step 4: Auto-mention payload — single signature gate, single body
	// builder, two transport-shaped outputs. See D9 in
	// docs/design/auto-mention-context.md.
	const autoMention = await buildAutoMentionPayload(
		input,
		vaultAccess,
		wikilinkCtx,
	);

	// Step 5: Build context based on agent capabilities
	const result = input.supportsEmbeddedContext
		? await preparePromptWithEmbeddedContext(
				input,
				vaultAccess,
				mentionedNotes,
				workspace,
				autoMention,
				wikilinkCtx,
			)
		: await preparePromptWithTextContext(
				input,
				vaultAccess,
				mentionedNotes,
				workspace,
				autoMention,
				wikilinkCtx,
			);

	if (workspace.pendingSnapshot) {
		result.pendingWorkspaceSnapshot = workspace.pendingSnapshot;
	}
	if (autoMention.pendingSnapshot) {
		result.pendingAutoMentionSnapshot = autoMention.pendingSnapshot;
	}
	return result;
}

/**
 * Per-prompt agent-workspace payload threaded into both transport branches.
 * `state`/`instructions` are null when there's nothing to emit (delta with no
 * changes, instructions disabled, bootstrap failed, or feature off).
 */
interface WorkspacePayload {
	state: WorkspaceXmlBlock | null;
	instructions: WorkspaceXmlBlock | null;
	pendingSnapshot: WorkspaceSnapshot | undefined;
}

/**
 * Resolve workspace state + instructions from the service, or empty payload
 * when integration is disabled or fails. Errors are swallowed (with a log)
 * so the user's prompt always still goes through.
 */
async function buildAgentWorkspaceBlocks(
	input: PreparePromptInput,
): Promise<WorkspacePayload> {
	if (!input.agentWorkspace) {
		return { state: null, instructions: null, pendingSnapshot: undefined };
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
			state: result.state,
			instructions: result.instructions,
			pendingSnapshot: result.pendingSnapshot,
		};
	} catch (error) {
		console.error("[message-sender] Workspace prelude failed:", error);
		return { state: null, instructions: null, pendingSnapshot: undefined };
	}
}

/**
 * Concatenate workspace XML blocks for the text-fallback transport.
 * Returns empty string when both blocks are null.
 */
function concatWorkspaceXml(workspace: WorkspacePayload): string {
	const parts: string[] = [];
	if (workspace.state) parts.push(workspace.state.xml);
	if (workspace.instructions) parts.push(workspace.instructions.xml);
	if (parts.length === 0) return "";
	return parts.join("\n") + "\n";
}

/**
 * Wrap an XML block as a `type: "resource"` PromptContent for embedded-context
 * agents. `priority` differentiates state (broader background, lower) from
 * mentioned-note resources (1.0) and auto-mention (0.8). `audience: ["assistant"]`
 * marks this as runtime-injected briefing, not user-authored content.
 */
function buildWorkspaceResource(
	block: WorkspaceXmlBlock,
	priority: number,
): ResourcePromptContent {
	return {
		type: "resource",
		resource: {
			uri: block.uri,
			mimeType: "application/xml",
			text: block.xml,
		},
		annotations: {
			audience: ["assistant"],
			priority,
			lastModified: new Date().toISOString(),
		},
	};
}

const WORKSPACE_STATE_PRIORITY = 0.9;
const WORKSPACE_INSTRUCTIONS_PRIORITY = 0.7;

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
	workspace: WorkspacePayload,
	autoMention: AutoMentionPayload,
	wikilinkCtx: WikilinkScanContext | null,
): Promise<PreparePromptResult> {
	const maxNoteLen = input.maxNoteLength ?? DEFAULT_MAX_NOTE_LENGTH;

	// Workspace Resource blocks at the head of agentContent — broadest system
	// context first, before user-specific references. `audience: ["assistant"]`
	// keeps these out of the user-text channel.
	const workspaceResources: PromptContent[] = [];
	if (workspace.state) {
		workspaceResources.push(
			buildWorkspaceResource(workspace.state, WORKSPACE_STATE_PRIORITY),
		);
	}
	if (workspace.instructions) {
		workspaceResources.push(
			buildWorkspaceResource(
				workspace.instructions,
				WORKSPACE_INSTRUCTIONS_PRIORITY,
			),
		);
	}

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

	const autoMentionPrefix = buildAutoMentionPrefix(
		input.activeNote,
		input.isAutoMentionDisabled,
	);

	const messageText = autoMentionPrefix + input.message;

	const agentContent: PromptContent[] = [
		...workspaceResources,
		...resourceBlocks,
		...autoMention.embeddedBlocks,
		...(messageText.length > 0
			? [{ type: "text" as const, text: messageText }]
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
	workspace: WorkspacePayload,
	autoMention: AutoMentionPayload,
	wikilinkCtx: WikilinkScanContext | null,
): Promise<PreparePromptResult> {
	const workspacePrelude = concatWorkspaceXml(workspace);
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

		const decoratedBody = decorateWithLinkedNotes(
			note.content,
			file.path,
			wikilinkCtx,
		);

		contextBlocks.push(
			`<obsidian_mentioned_note ref="${note.uri}">\n${decoratedBody}${truncationNote}\n</obsidian_mentioned_note>`,
		);
	}

	// Auto-mention XML — only present when the signature gate let it through.
	if (autoMention.fallbackXml) {
		contextBlocks.push(autoMention.fallbackXml);
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

// ============================================================================
// Auto-mention payload — seed-then-delta gate
// ============================================================================

/**
 * Per-prompt auto-mention payload threaded into both transport branches.
 * Shaped so the embedded branch picks `embeddedBlocks` and the fallback
 * branch picks `fallbackXml`; identical body string across the two
 * (D8 symmetry contract).
 */
interface AutoMentionPayload {
	/** Single Resource block, or `[]` when suppressed. */
	embeddedBlocks: PromptContent[];
	/** `<obsidian_opened_note …>…</obsidian_opened_note>` string, or `""` when suppressed. */
	fallbackXml: string;
	/** Signature to commit on successful send; `undefined` when nothing was emitted. */
	pendingSnapshot: AutoMentionSnapshot | undefined;
}

const AUTO_MENTION_PRIORITY = 0.8;

/**
 * Compute the current auto-mention signature from `activeNote`.
 * Returns `null` when there is no active note (caller should treat as
 * "no payload to ship").
 */
function buildAutoMentionSignature(
	activeNote: NoteMetadata | null | undefined,
): AutoMentionSnapshot | null {
	if (!activeNote) return null;
	return {
		notePath: activeNote.path,
		selFrom: activeNote.selection ? activeNote.selection.from.line : null,
		selTo: activeNote.selection ? activeNote.selection.to.line : null,
		mtime: activeNote.modified,
	};
}

/**
 * Strict equality on all four signature fields. `null` selFrom/selTo
 * (no-selection) never equals a numeric selFrom/selTo.
 */
function autoMentionSignaturesEqual(
	a: AutoMentionSnapshot | null | undefined,
	b: AutoMentionSnapshot | null | undefined,
): boolean {
	if (!a || !b) return false;
	return (
		a.notePath === b.notePath &&
		a.selFrom === b.selFrom &&
		a.selTo === b.selTo &&
		a.mtime === b.mtime
	);
}

/**
 * Build the auto-mention body string. Byte-identical between the two
 * transports — only the wrapper (Resource vs `<obsidian_opened_note>`)
 * differs. See D8 in docs/design/auto-mention-context.md.
 */
async function buildAutoMentionBody(
	activeNote: NoteMetadata,
	uri: string,
	vaultAccess: IVaultAccess,
	maxSelectionLength: number,
	wikilinkCtx: WikilinkScanContext | null,
): Promise<string> {
	if (!activeNote.selection) {
		return `User has opened the note ${uri} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.`;
	}

	const fromLine = activeNote.selection.from.line + 1;
	const toLine = activeNote.selection.to.line + 1;

	const sel = await readSelection(
		activeNote.path,
		activeNote.selection,
		vaultAccess,
		maxSelectionLength,
	);
	if (!sel) {
		return `Lines ${fromLine}-${toLine} of this note are the user's current focus, but the slice could not be read. Use the Read tool to examine those lines.`;
	}

	const baseSlice = sel.wasTruncated
		? sel.text +
			`\n\n[Note: Truncated from ${sel.originalLength} to ${maxSelectionLength} characters]`
		: sel.text;
	const decorated = decorateWithLinkedNotes(
		baseSlice,
		activeNote.path,
		wikilinkCtx,
	);

	return `Lines ${fromLine}-${toLine} of this note are the user's current focus.\n\n${decorated}`;
}

/**
 * Compute the auto-mention payload for both transports, gated by the
 * signature snapshot. Returns empty blocks when:
 *  - no active note
 *  - auto-mention disabled
 *  - current signature equals `input.autoMentionSnapshot` (seed already shipped)
 *
 * Otherwise builds the body once and shapes it for both transports. The
 * caller picks the field matching the agent's capability.
 */
async function buildAutoMentionPayload(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	wikilinkCtx: WikilinkScanContext | null,
): Promise<AutoMentionPayload> {
	const empty: AutoMentionPayload = {
		embeddedBlocks: [],
		fallbackXml: "",
		pendingSnapshot: undefined,
	};

	if (!input.activeNote || input.isAutoMentionDisabled) {
		return empty;
	}

	const currentSig = buildAutoMentionSignature(input.activeNote);
	if (!currentSig) return empty;

	if (autoMentionSignaturesEqual(currentSig, input.autoMentionSnapshot)) {
		return empty;
	}

	const uri = resolveFileUri(
		input.activeNote.path,
		input.vaultBasePath,
		input.convertToWsl ?? false,
	);
	const body = await buildAutoMentionBody(
		input.activeNote,
		uri,
		vaultAccess,
		input.maxSelectionLength ?? DEFAULT_MAX_SELECTION_LENGTH,
		wikilinkCtx,
	);

	const embeddedBlock: ResourcePromptContent = {
		type: "resource",
		resource: { uri, mimeType: "text/markdown", text: body },
		annotations: {
			audience: ["assistant"],
			priority: AUTO_MENTION_PRIORITY,
			lastModified: new Date(input.activeNote.modified).toISOString(),
		},
	};

	const fallbackXml = input.activeNote.selection
		? `<obsidian_opened_note ref="${uri}" selection="lines ${input.activeNote.selection.from.line + 1}-${input.activeNote.selection.to.line + 1}">\n${body}\n</obsidian_opened_note>`
		: `<obsidian_opened_note ref="${uri}">${body}</obsidian_opened_note>`;

	return {
		embeddedBlocks: [embeddedBlock],
		fallbackXml,
		pendingSnapshot: currentSig,
	};
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
