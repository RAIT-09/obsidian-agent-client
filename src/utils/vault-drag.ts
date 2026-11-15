import { TFile } from "obsidian";
import type { App, Draggable } from "obsidian";

/**
 * Vault files carried by an Obsidian-internal drag, split by how the chat
 * input treats them.
 */
export interface VaultDragFiles {
	/** Markdown notes — inserted as `@[[note]]` mentions */
	notes: TFile[];
	/** Any other vault file (PDF, CSV, images, ...) — attached */
	files: TFile[];
	/** Entries that are not files (folders) and were skipped */
	skippedCount: number;
}

/**
 * Classify an internal drag payload. Returns null when it carries no vault
 * file (folder-only drags, unresolved links, tabs, bookmarks, ...), so the
 * caller can leave such drags to their default behavior.
 */
export function collectVaultDragFiles(
	draggable: Draggable | null | undefined,
): VaultDragFiles | null {
	if (!draggable) return null;

	let items: unknown[];
	switch (draggable.type) {
		case "file":
		case "link":
			items = [draggable.file];
			break;
		case "files":
			items = draggable.files ?? [];
			break;
		default:
			return null;
	}

	const notes: TFile[] = [];
	const files: TFile[] = [];
	let skippedCount = 0;
	for (const item of items) {
		if (!(item instanceof TFile)) {
			skippedCount++;
			continue;
		}
		if (item.extension === "md") {
			notes.push(item);
		} else {
			files.push(item);
		}
	}

	if (notes.length === 0 && files.length === 0) return null;
	return { notes, files, skippedCount };
}

/**
 * Read the vault files of the in-progress Obsidian-internal drag.
 *
 * Internal drags put only `obsidian://open?...` URLs in `dataTransfer` (no
 * `Files`), so the dragged TFiles come from the unofficial
 * `app.dragManager.draggable` (see src/types/obsidian-internals.d.ts).
 */
export function getVaultDragFiles(app: App): VaultDragFiles | null {
	return collectVaultDragFiles(app.dragManager?.draggable);
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
	// Documents / data
	pdf: "application/pdf",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	txt: "text/plain",
	json: "application/json",
	canvas: "application/json",
	html: "text/html",
	htm: "text/html",
	xml: "application/xml",
	yaml: "application/yaml",
	yml: "application/yaml",
	// Images
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	avif: "image/avif",
	// Audio / video
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	flac: "audio/flac",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
};

/**
 * MIME type for a vault file extension. Vault files have no browser-sniffed
 * `File.type`, so this stands in for it; unknown extensions fall back to
 * `application/octet-stream` like OS-dropped files do.
 */
export function mimeTypeFromExtension(extension: string): string {
	const key = extension.toLowerCase();
	return Object.prototype.hasOwnProperty.call(MIME_TYPES_BY_EXTENSION, key)
		? MIME_TYPES_BY_EXTENSION[key]
		: "application/octet-stream";
}
