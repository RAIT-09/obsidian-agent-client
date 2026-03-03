import type { ChatMessage, ToolKind } from "../../../domain/models/chat-message";
import { toRelativePath } from "../../../shared/path-utils";

export interface FileChange {
	path: string;
	vaultPath: string | null;
	isNewFile: boolean;
	isDeleted: boolean;
	canRevert: boolean;
	originalText: string | null;
	finalText: string;
}

export interface SessionChangeSet {
	changes: FileChange[];
}

function normalizeForComparison(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/^\/+/, "");
}

function getPathFromRawInput(rawInput: Record<string, unknown>): string | null {
	const rawPath =
		(rawInput.filePath as string) ||
		(rawInput.file_path as string) ||
		(rawInput.path as string) ||
		"";
	return rawPath || null;
}

function getCommandFromRawInput(rawInput: Record<string, unknown>): string {
	const command =
		typeof rawInput.command === "string" ? rawInput.command.trim() : "";
	if (!command) return "";

	const args = rawInput.args;
	if (Array.isArray(args) && args.every((arg) => typeof arg === "string")) {
		if (/\s/.test(command)) return command;
		return `${command} ${args.join(" ")}`.trim();
	}
	return command;
}

function tokenizeShellCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (const ch of command) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}

		if (quote === "'") {
			if (ch === "'") {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}

		if (quote === '"') {
			if (ch === '"') {
				quote = null;
			} else if (ch === "\\") {
				escaped = true;
			} else {
				current += ch;
			}
			continue;
		}

		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}

		if (ch === "\\") {
			escaped = true;
			continue;
		}

		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += ch;
	}

	if (current) tokens.push(current);
	return tokens;
}

interface ParsedCommandPath {
	path: string;
	isDelete: boolean;
}

function parseExecuteCommandPaths(command: string): ParsedCommandPath[] {
	if (!command.trim()) return [];
	if (/[;&|]/.test(command)) return [];

	const tokens = tokenizeShellCommand(command);
	if (tokens.length === 0) return [];

	const executable = tokens[0].split("/").pop()?.toLowerCase() || "";
	const args = tokens
		.slice(1)
		.filter((token) => token && !token.startsWith("-"));

	if (executable === "rm") {
		return args.map((path) => ({ path, isDelete: true }));
	}

	if (executable === "mv") {
		if (args.length < 2) return [];
		const destination = args[args.length - 1];
		const sources = args.slice(0, -1);
		return [
			...sources.map((path) => ({ path, isDelete: true })),
			{ path: destination, isDelete: false },
		];
	}

	if (executable === "cp") {
		if (args.length < 2) return [];
		return [{ path: args[args.length - 1], isDelete: false }];
	}

	return [];
}

export function toVaultRelativePath(
	path: string,
	vaultBasePath?: string,
): string | null {
	if (!path) return null;

	const normalized = normalizeForComparison(path);
	const isAbsoluteUnix = normalized.startsWith("/");
	const isAbsoluteWindows = /^[A-Za-z]:\//.test(normalized);
	const isAbsolute = isAbsoluteUnix || isAbsoluteWindows;

	if (!isAbsolute) {
		return normalizeVaultPath(path);
	}

	if (!vaultBasePath) return null;

	const normalizedBase = normalizeForComparison(vaultBasePath);
	const relative = toRelativePath(normalized, normalizedBase);
	if (relative === normalized) {
		return null;
	}

	return normalizeVaultPath(relative);
}

export interface DiscoveredFile {
	vaultPath: string;
	rawPath: string;
	/** First oldText seen for this path — string for existing, null for explicit new-file, undefined for unknown */
	firstOldText: string | null | undefined;
	/** True when any tool call with `kind === "delete"` targeted this path */
	wasDeleted: boolean;
}

/**
 * Scan ALL tool calls for every file path mentioned in the conversation — via
 * diff content, rawInput file-path keys, or tool call locations. The
 * SnapshotManager captures originals on first sighting and later compares with
 * disk to detect actual changes.
 *
 * Priority for `firstOldText`:
 * 1. Diff `oldText` (most reliable — no timing issues)
 * 2. `undefined` (unknown — caller may fall back to disk snapshot)
 *
 * Search tool locations are excluded (they can list dozens of results).
 */
export function discoverModifiedFiles(
	messages: ChatMessage[],
	vaultBasePath?: string,
): DiscoveredFile[] {
	const found = new Map<string, DiscoveredFile>();

	const add = (rawPath: string, oldText?: string | null, kind?: ToolKind) => {
		const vaultPath = toVaultRelativePath(rawPath, vaultBasePath);
		if (!vaultPath) return;

		const existing = found.get(vaultPath);
		if (existing) {
			if (kind === "delete") existing.wasDeleted = true;
			if (existing.firstOldText === undefined && oldText !== undefined) {
				existing.firstOldText = oldText;
			}
			return;
		}

		found.set(vaultPath, {
			vaultPath,
			rawPath,
			firstOldText: oldText,
			wasDeleted: kind === "delete",
		});
	};

	for (const msg of messages) {
		for (const content of msg.content) {
			if (content.type !== "tool_call") continue;
			const kind = content.kind;

			if (content.content) {
				for (const item of content.content) {
					if (item.type !== "diff") continue;
					add(item.path, item.oldText, kind);
				}
			}

			if (content.rawInput) {
				const command = getCommandFromRawInput(content.rawInput);
				if (kind === "execute" && command) {
					for (const parsed of parseExecuteCommandPaths(command)) {
						add(parsed.path, undefined, parsed.isDelete ? "delete" : kind);
					}
				}

				const rawPath =
					getPathFromRawInput(content.rawInput) || content.locations?.[0]?.path;
				if (rawPath) add(rawPath, undefined, kind);
			}

			if (content.locations && kind !== "search") {
				for (const loc of content.locations) {
					add(loc.path, undefined, kind);
				}
			}
		}
	}

	return [...found.values()];
}

export function getLastAssistantMessage(
	messages: ChatMessage[],
): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const content of msg.content) {
			if (content.type === "text" && content.text.trim()) {
				return content.text;
			}
		}
	}
	return null;
}
