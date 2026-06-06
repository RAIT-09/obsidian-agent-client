/**
 * Parser for the `agent-client` markdown code block.
 *
 * Pure function. No React, no Obsidian view APIs (parseYaml from obsidian
 * is the only Obsidian import, used as a YAML utility).
 *
 * Fence body is parsed as YAML and dispatched by a `type` discriminator:
 * - `chat` (default): embedded chat view
 * - `button`: quick-action button that opens a chat with a prompt
 */

import { parseYaml } from "obsidian";

export type AgentChatBlockConfig = {
	type: "chat";
	agent?: string;
	model?: string;
	/** Max height of the messages area, e.g. "400px". */
	height?: string;
	/** Restore the latest saved session for this note + agent. */
	persist?: boolean;
	/** Pin auto-mention context to the note hosting this block. */
	noteContext?: "hosting";
	/**
	 * Per-block avatar override.
	 * Accepts http(s) URL, data URL, or vault-relative path.
	 * Falls back to the configured agent's avatarImage, then the
	 * global floatingButtonImage.
	 */
	image?: string;
};

export type AgentButtonBlockConfig = {
	type: "button";
	text: string;
	/** Prompt sent to the opened chat. */
	prompt?: string;
	/** Name of a saved quick prompt to resolve at click time. */
	promptName?: string;
	agent?: string;
	/** Where to open the chat when clicked. */
	viewType?: "right-pane" | "floating" | "editor-tab" | "embedded";
	/** Send immediately on open. */
	autoSend?: boolean;
	/** Hide the button after it is clicked (until the note is re-rendered). */
	hideAfterClick?: boolean;
	/** Alignment of the rendered button block within the note. */
	align?: "left" | "center" | "right";
};

export type AgentBlockConfig = AgentChatBlockConfig | AgentButtonBlockConfig;

export type AgentBlockParseResult =
	| { ok: true; config: AgentBlockConfig }
	| { ok: false; error: string };

const VALID_TYPES = new Set<string>(["chat", "button"]);
const VALID_VIEW_TYPES = new Set<string>([
	"right-pane",
	"floating",
	"editor-tab",
	"embedded",
]);
const VALID_NOTE_CONTEXTS = new Set<string>(["hosting"]);
const VALID_ALIGNMENTS = new Set<string>(["left", "center", "right"]);

function normalizeViewType(
	value: string | undefined,
): AgentButtonBlockConfig["viewType"] | undefined {
	if (!value) return undefined;
	if (value === "right" || value === "right-tab") return "right-pane";
	if (value === "float" || value === "floating-chat") return "floating";
	if (value === "tab") return "editor-tab";
	if (value === "embed" || value === "embeddable") return "embedded";
	return VALID_VIEW_TYPES.has(value)
		? (value as AgentButtonBlockConfig["viewType"])
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function dedent(source: string): string {
	const normalized = source.replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

	if (minIndent === 0) return normalized.trim();

	return lines
		.map((line) => (line.trim().length > 0 ? line.slice(minIndent) : line))
		.join("\n")
		.trim();
}

function normalizeCssLength(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.replace(/^(-?\d+(?:\.\d+)?)\s+(px|em|rem|vh|vw|%)$/i, "$1$2");
}

/**
 * Parse the fence body. An empty body yields a default `chat` block.
 *
 * Returns a discriminated result. Callers should render an inline error
 * (createDiv/createSpan, never innerHTML) when ok is false.
 */
export function parseAgentBlock(source: string): AgentBlockParseResult {
	const trimmed = dedent(source);

	let raw: unknown;
	if (trimmed.length === 0) {
		raw = {};
	} else {
		try {
			raw = parseYaml(trimmed);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return { ok: false, error: `Invalid YAML: ${message}` };
		}
	}

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			error: "Block body must be a YAML mapping (key: value pairs).",
		};
	}

	const obj = raw as Record<string, unknown>;
	const typeValue = asString(obj.type) ?? "chat";

	if (!VALID_TYPES.has(typeValue)) {
		return {
			ok: false,
			error: `Unknown type: "${typeValue}". Expected "chat" or "button".`,
		};
	}

	if (typeValue === "chat") {
		const rawNoteContext = asString(obj.noteContext);
		const noteContext = rawNoteContext
			? VALID_NOTE_CONTEXTS.has(rawNoteContext)
				? (rawNoteContext as AgentChatBlockConfig["noteContext"])
				: undefined
			: undefined;
		if (rawNoteContext && !noteContext) {
			return {
				ok: false,
				error: `Unknown noteContext: "${rawNoteContext}". Expected "hosting".`,
			};
		}

		const config: AgentChatBlockConfig = {
			type: "chat",
			agent: asString(obj.agent),
			model: asString(obj.model),
			height: normalizeCssLength(asString(obj.height)),
			persist: asBoolean(obj.persist) ?? false,
			noteContext,
			image: asString(obj.image),
		};
		return { ok: true, config };
	}

	const text = asString(obj.text);
	if (!text) {
		return {
			ok: false,
			error: 'Button block requires a non-empty "text" field.',
		};
	}

	const prompt = asString(obj.prompt);
	const promptName = asString(obj.promptName);
	if (!prompt && !promptName) {
		return {
			ok: false,
			error: 'Button block requires a non-empty "prompt" or "promptName" field.',
		};
	}

	const rawViewType = asString(obj.viewType);
	const viewType = normalizeViewType(rawViewType);
	if (rawViewType && !viewType) {
		return {
			ok: false,
			error: `Unknown viewType: "${rawViewType}". Expected "right-pane", "floating", "editor-tab", or "embedded".`,
		};
	}

	const rawAlign = asString(obj.align);
	const align = rawAlign
		? VALID_ALIGNMENTS.has(rawAlign)
			? (rawAlign as AgentButtonBlockConfig["align"])
			: undefined
		: undefined;
	if (rawAlign && !align) {
		return {
			ok: false,
			error: `Unknown align: "${rawAlign}". Expected "left", "center", or "right".`,
		};
	}

	const config: AgentButtonBlockConfig = {
		type: "button",
		text,
		prompt,
		promptName,
		agent: asString(obj.agent),
		viewType: viewType ?? "right-pane",
		autoSend: asBoolean(obj.autoSend) ?? false,
		// Left undefined when unset so it can fall back to the referenced
		// quick prompt's hideAfterClick setting at click time.
		hideAfterClick: asBoolean(obj.hideAfterClick),
		align: align ?? "left",
	};
	return { ok: true, config };
}
