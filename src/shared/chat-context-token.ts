import type { EditorPosition } from "../domain/ports/vault-access.port";

export interface ChatContextSelection {
	from: EditorPosition;
	to: EditorPosition;
}

export interface ChatContextReference {
	type: "selection" | "file" | "folder";
	notePath: string;
	noteName: string;
	selection?: ChatContextSelection;
}

interface SerializedChatContextReference {
	version: 1;
	type: "selection" | "file" | "folder";
	notePath: string;
	noteName: string;
	selection?: ChatContextSelection;
}

const CONTEXT_TOKEN_PREFIX = "@[obsius-context:";
const CONTEXT_TOKEN_REGEX = /@\[obsius-context:([A-Za-z0-9_-]+)\]/g;

function comparePosition(a: EditorPosition, b: EditorPosition): number {
	if (a.line !== b.line) {
		return a.line - b.line;
	}
	return a.ch - b.ch;
}

function normalizeSelection(
	selection: ChatContextSelection,
): ChatContextSelection {
	if (comparePosition(selection.from, selection.to) <= 0) {
		return selection;
	}
	return {
		from: selection.to,
		to: selection.from,
	};
}

export function normalizeChatContextReference(
	reference: ChatContextReference,
): ChatContextReference {
	if (reference.type === "selection" && reference.selection) {
		return {
			...reference,
			selection: normalizeSelection(reference.selection),
		};
	}
	return reference;
}

function toBase64Url(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const base64 = btoa(binary);
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string | null {
	const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const paddingNeeded = (4 - (base64.length % 4)) % 4;
	const padded = base64 + "=".repeat(paddingNeeded);

	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function isValidPosition(position: unknown): position is EditorPosition {
	if (
		!position ||
		typeof position !== "object" ||
		!("line" in position) ||
		!("ch" in position)
	) {
		return false;
	}

	const p = position as { line: unknown; ch: unknown };
	return (
		typeof p.line === "number" &&
		typeof p.ch === "number" &&
		Number.isInteger(p.line) &&
		Number.isInteger(p.ch) &&
		p.line >= 0 &&
		p.ch >= 0
	);
}

export function parseChatContextToken(
	token: string,
): ChatContextReference | null {
	const match = token.match(/^@\[obsius-context:([A-Za-z0-9_-]+)\]$/);
	if (!match) {
		return null;
	}

	const decoded = fromBase64Url(match[1]);
	if (!decoded) {
		return null;
	}

	try {
		const parsed = JSON.parse(decoded) as SerializedChatContextReference;
		if (
			parsed.version !== 1 ||
			(parsed.type !== "selection" &&
				parsed.type !== "file" &&
				parsed.type !== "folder") ||
			typeof parsed.notePath !== "string" ||
			typeof parsed.noteName !== "string"
		) {
			return null;
		}

		if (parsed.type === "selection") {
			if (
				!parsed.selection ||
				!isValidPosition(parsed.selection.from) ||
				!isValidPosition(parsed.selection.to)
			) {
				return null;
			}
			return normalizeChatContextReference({
				type: "selection",
				notePath: parsed.notePath,
				noteName: parsed.noteName,
				selection: {
					from: parsed.selection.from,
					to: parsed.selection.to,
				},
			});
		}

		return {
			type: parsed.type,
			notePath: parsed.notePath,
			noteName: parsed.noteName,
		};
	} catch {
		return null;
	}
}

export function createChatContextToken(
	reference: ChatContextReference,
): string {
	const normalized = normalizeChatContextReference(reference);
	const serialized: SerializedChatContextReference = {
		version: 1,
		type: normalized.type,
		notePath: normalized.notePath,
		noteName: normalized.noteName,
		selection: normalized.selection,
	};
	return `${CONTEXT_TOKEN_PREFIX}${toBase64Url(JSON.stringify(serialized))}]`;
}

export function getChatContextReferenceKey(
	reference: ChatContextReference,
): string {
	if (reference.type === "selection" && reference.selection) {
		return `${reference.type}:${reference.notePath}:${reference.selection.from.line}:${reference.selection.from.ch}-${reference.selection.to.line}:${reference.selection.to.ch}`;
	}
	return `${reference.type}:${reference.notePath}`;
}

export function appendChatContextToken(
	message: string,
	reference: ChatContextReference,
): string {
	const normalized = normalizeChatContextReference(reference);
	const token = createChatContextToken(normalized);

	const { contexts, messageWithoutContextTokens } =
		extractChatContextTokensFromMessage(message);
	const existingKeys = new Set(contexts.map(getChatContextReferenceKey));
	const key = getChatContextReferenceKey(normalized);
	if (existingKeys.has(key)) {
		const rebuiltTokens = contexts.map((ctx) => createChatContextToken(ctx));
		return buildMessageWithContextTokens(
			messageWithoutContextTokens,
			rebuiltTokens,
		);
	}

	const rebuiltTokens = [
		...contexts.map((ctx) => createChatContextToken(ctx)),
		token,
	];
	return buildMessageWithContextTokens(
		messageWithoutContextTokens,
		rebuiltTokens,
	);
}

export function buildMessageWithContextTokens(
	baseMessage: string,
	tokens: string[],
): string {
	const trimmedBase = baseMessage.trim();
	const normalizedTokens = tokens.map((token) => token.trim()).filter(Boolean);

	if (trimmedBase.length === 0 && normalizedTokens.length === 0) {
		return "";
	}

	if (trimmedBase.length === 0) {
		return `${normalizedTokens.join(" ")} `;
	}

	if (normalizedTokens.length === 0) {
		return trimmedBase;
	}

	return `${trimmedBase} ${normalizedTokens.join(" ")} `;
}

export function extractChatContextTokensFromMessage(message: string): {
	messageWithoutContextTokens: string;
	contexts: ChatContextReference[];
	tokens: string[];
} {
	const contexts: ChatContextReference[] = [];
	const tokens: string[] = [];
	const seenKeys = new Set<string>();

	CONTEXT_TOKEN_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CONTEXT_TOKEN_REGEX.exec(message)) !== null) {
		const token = match[0];
		const parsed = parseChatContextToken(token);
		if (!parsed) {
			continue;
		}

		const key = getChatContextReferenceKey(parsed);
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		contexts.push(parsed);
		tokens.push(token);
	}

	CONTEXT_TOKEN_REGEX.lastIndex = 0;
	const messageWithoutContextTokens = message
		.replace(CONTEXT_TOKEN_REGEX, "")
		.trim();

	return {
		messageWithoutContextTokens,
		contexts,
		tokens,
	};
}

export function removeChatContextTokensForPaths(
	message: string,
	paths: string[],
): string {
	const pathSet = new Set(paths);
	const { contexts, messageWithoutContextTokens } =
		extractChatContextTokensFromMessage(message);
	const remaining = contexts.filter((ctx) => !pathSet.has(ctx.notePath));
	if (remaining.length === contexts.length) return message;
	const tokens = remaining.map((ctx) => createChatContextToken(ctx));
	return buildMessageWithContextTokens(messageWithoutContextTokens, tokens);
}

export function formatChatContextBadgeLabel(
	reference: ChatContextReference,
): string {
	if (reference.type === "selection" && reference.selection) {
		const from = reference.selection.from;
		const to = reference.selection.to;
		return `${reference.noteName} ${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}`;
	}
	if (reference.type === "folder") {
		return `${reference.noteName}/`;
	}
	return reference.noteName;
}

export function formatChatContextTooltip(
	reference: ChatContextReference,
): string {
	if (reference.type === "selection" && reference.selection) {
		const from = reference.selection.from;
		const to = reference.selection.to;
		return `Selection ${from.line + 1}:${from.ch + 1}-${to.line + 1}:${to.ch + 1}\n${reference.notePath}`;
	}
	if (reference.type === "folder") {
		return `Folder path\n${reference.notePath}`;
	}
	return `Full file\n${reference.notePath}`;
}
