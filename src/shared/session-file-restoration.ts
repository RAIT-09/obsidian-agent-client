import type { ChatMessage, ToolKind } from "../domain/models/chat-message";
import { toRelativePath } from "./path-utils";

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
	return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function getPathFromRawInput(rawInput: Record<string, unknown>): string | null {
	const rawPath =
		(rawInput.filePath as string) ||
		(rawInput.file_path as string) ||
		(rawInput.path as string) ||
		"";
	return rawPath || null;
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
	/** First oldText seen for this path — string for existing, null/undefined for new/unknown */
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
 * 2. `undefined` (caller must read from disk)
 *
 * Search tool locations are excluded (they can list dozens of results).
 */
export function discoverModifiedFiles(
	messages: ChatMessage[],
	vaultBasePath?: string,
): DiscoveredFile[] {
	const found = new Map<string, DiscoveredFile>();

	const add = (
		rawPath: string,
		oldText?: string | null,
		kind?: ToolKind,
	) => {
		const vaultPath = toVaultRelativePath(rawPath, vaultBasePath);
		if (!vaultPath) return;

		const existing = found.get(vaultPath);
		if (existing) {
			if (kind === "delete") existing.wasDeleted = true;
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
					add(item.path, item.oldText ?? null, kind);
				}
			}

			if (content.rawInput) {
				const rawPath =
					getPathFromRawInput(content.rawInput) ||
					content.locations?.[0]?.path;
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
