/** Pure helpers for resolving Obsidian file-explorer drag payloads. */

import type { AttachedFile } from "../types/chat";

interface PathLike {
	path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toPathLike(value: unknown): PathLike | null {
	if (!isRecord(value) || typeof value.path !== "string") return null;
	const path = value.path.trim();
	return path ? { path } : null;
}

function uniquePaths(paths: string[]): string[] {
	return [...new Set(paths.map((path) => path.replace(/^\/+/, "")))].filter(
		Boolean,
	);
}

function attachmentIdentityKeys(file: AttachedFile): string[] {
	const keys: string[] = [];
	if (file.vaultPath) keys.push(`vault:${file.vaultPath}`);
	if (file.path) keys.push(`path:${file.path}`);
	return keys.length > 0 ? keys : [`id:${file.id}`];
}

/** Remove candidate attachments matching any stable identity already present. */
export function deduplicateAttachments(
	existing: AttachedFile[],
	candidates: AttachedFile[],
): AttachedFile[] {
	const existingKeys = new Set(existing.flatMap(attachmentIdentityKeys));
	return candidates.filter((file) => {
		const keys = attachmentIdentityKeys(file);
		if (keys.some((key) => existingKeys.has(key))) return false;
		keys.forEach((key) => existingKeys.add(key));
		return true;
	});
}

/** Extract vault-relative paths from Obsidian's current internal drag item. */
export function extractVaultPathsFromInternalDrag(
	draggable: unknown,
): string[] {
	if (!isRecord(draggable)) return [];

	if (draggable.type === "file" || draggable.type === "link") {
		const file = toPathLike(draggable.file);
		return file ? [file.path] : [];
	}

	if (draggable.type === "files" && Array.isArray(draggable.files)) {
		return uniquePaths(
			draggable.files
				.map(toPathLike)
				.filter((file): file is PathLike => file !== null)
				.map((file) => file.path),
		);
	}

	return [];
}

/** Resolve current-vault `obsidian://open` links from a drag payload. */
export function extractVaultPathsFromObsidianUris(
	value: string,
	activeVaultName: string,
): string[] {
	const paths: string[] = [];
	const candidates = value
		.split(/[\r\n\t ]+/)
		.map((candidate) => candidate.trim())
		.filter(Boolean);

	for (const candidate of candidates) {
		if (!candidate.startsWith("obsidian://open?")) continue;
		try {
			const url = new URL(candidate);
			const vault = url.searchParams.get("vault");
			const file = url.searchParams.get("file");
			if (vault !== activeVaultName || !file) continue;
			paths.push(file);
		} catch {
			// Ignore malformed drag data.
		}
	}

	return uniquePaths(paths);
}
