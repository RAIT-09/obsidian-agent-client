/**
 * Wikilink resolver
 *
 * Pure utilities for extracting `[[wikilinks]]` from note content and resolving
 * them to vault files. Skips `![[embeds]]` (per design D6).
 *
 * The resolver returns vault-relative metadata; the formatter is responsible
 * for converting `path` to absolute path / `file://` URI.
 */

import { TFile, type App } from "obsidian";

export interface LinkedNoteCandidate {
	/** Vault-relative path (e.g., "folder/Note.md") */
	path: string;
	/** File basename without extension (e.g., "Note") */
	basename: string;
}

export interface LinkedNoteMetadata {
	/** Target portion of the wikilink (`[[Foo]]` → "Foo", `[[Foo#Bar]]` → "Foo") */
	linkText: string;
	/** Alias (`[[Foo|bar]]` → "bar"); undefined when same as linkText */
	displayText?: string;
	/** Section anchor (`[[Foo#Bar]]` → "Bar"); undefined when no anchor */
	section?: string;
	/** Resolved file matches; empty = unresolved, single = resolved, multiple = ambiguous */
	candidates: LinkedNoteCandidate[];
}

/**
 * Index of vault files keyed by basename. Multiple files can share a basename
 * (collision), which is what surfaces ambiguity in `extractLinkedNoteMetadata`.
 *
 * Build once per `preparePrompt` and reuse across multiple notes (perf).
 */
export type BasenameIndex = Map<string, TFile[]>;

/**
 * VaultService-implemented port. Lets `preparePrompt` request resolver work
 * without taking an `App` dependency itself.
 */
export interface IWikilinkResolver {
	buildBasenameIndex(): BasenameIndex;
	extractLinkedNoteMetadata(
		content: string,
		sourcePath: string,
		basenameIndex: BasenameIndex,
	): LinkedNoteMetadata[];
}

/** Build a basename → files index from the vault's markdown files. */
export function buildBasenameIndex(app: App): BasenameIndex {
	const index: BasenameIndex = new Map();
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const entries = index.get(file.basename) ?? [];
		entries.push(file);
		index.set(file.basename, entries);
	}
	return index;
}

/**
 * Resolve a single wikilink target string to candidate files.
 *
 * Combines two sources:
 *   1. `metadataCache.getFirstLinkpathDest(target, sourcePath)` — Obsidian's
 *      own resolver, which respects relative paths and same-folder priority.
 *   2. Basename collisions from the prebuilt index (only when target has no
 *      extension), so ambiguous links surface multiple candidates.
 *
 * Map dedupes by file path; result preserves insertion order.
 */
function resolveWikiLinkTargets(
	rawTarget: string,
	sourcePath: string,
	basenameIndex: BasenameIndex,
	app: App,
): TFile[] {
	const target = rawTarget.trim();
	if (!target) return [];

	const results = new Map<string, TFile>();

	const resolved = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	if (resolved instanceof TFile) {
		results.set(resolved.path, resolved);
	}

	if (!/\.[^./]+$/.test(target)) {
		const basename = target.split("/").pop() ?? target;
		const duplicates = basenameIndex.get(basename) ?? [];
		for (const file of duplicates) {
			results.set(file.path, file);
		}
	}

	return Array.from(results.values());
}

/**
 * Extract structured metadata for every `[[wikilink]]` in `content`.
 *
 * Skips `![[embeds]]` and in-document anchors (`[[#Heading]]`).
 * Dedupes by composite key `target|alias|section` so the same link written
 * multiple times produces one entry.
 */
export function extractLinkedNoteMetadata(
	content: string,
	sourcePath: string,
	basenameIndex: BasenameIndex,
	app: App,
): LinkedNoteMetadata[] {
	if (!content) return [];

	const linkPattern = /\[\[([^\]]+)\]\]/g;
	const matches = new Map<string, LinkedNoteMetadata>();

	let match: RegExpExecArray | null;
	while ((match = linkPattern.exec(content)) !== null) {
		// Skip embeds: `![[Foo]]`
		if (match.index > 0 && content[match.index - 1] === "!") continue;

		const inner = match[1]?.trim();
		if (!inner) continue;

		const [targetPart, displayPart] = inner.split("|");
		const [targetWithoutSection, sectionPart] = targetPart.split("#");
		const linkText = targetWithoutSection?.trim();
		if (!linkText) continue; // in-document anchor (`[[#Heading]]`) or whitespace-only

		const aliasTrimmed = displayPart?.trim();
		const sectionTrimmed = sectionPart?.trim();

		const key = `${linkText}|${aliasTrimmed ?? ""}|${sectionTrimmed ?? ""}`;
		if (matches.has(key)) continue;

		const candidateFiles = resolveWikiLinkTargets(
			linkText,
			sourcePath,
			basenameIndex,
			app,
		);

		matches.set(key, {
			linkText,
			displayText:
				aliasTrimmed && aliasTrimmed !== linkText
					? aliasTrimmed
					: undefined,
			section: sectionTrimmed || undefined,
			candidates: candidateFiles.map((file) => ({
				path: file.path,
				basename: file.basename,
			})),
		});
	}

	return Array.from(matches.values());
}
