/**
 * Wikilink metadata formatter
 *
 * Pure function: takes a `LinkedNoteMetadata[]` (vault-relative) plus the
 * vault base path / WSL flag and produces the `<obsidian_metadata>` body
 * string that gets prepended to the note body in both transports.
 *
 * Design ref: docs/design/wikilink-context.md §4.1
 */

import type { LinkedNoteMetadata } from "./wikilink-resolver";
import { convertWindowsPathToWsl } from "./platform";
import { buildFileUri } from "./paths";

/** Hard cap on links per note (D9). Beyond this, emit `truncated="N"`. */
const MAX_LINKS_PER_NOTE = 50;

export interface FormatLinkedNotesOptions {
	vaultBasePath: string;
	convertToWsl: boolean;
	/** Override the cap (tests). Defaults to MAX_LINKS_PER_NOTE. */
	maxLinks?: number;
}

/**
 * Build the `<obsidian_metadata>` prelude for a note.
 *
 * Returns an empty string when there are no links — the caller should not
 * emit any wrapper in that case (D8: byte-identical to today's output for
 * link-free notes).
 */
export function formatLinkedNotesPrelude(
	links: LinkedNoteMetadata[],
	options: FormatLinkedNotesOptions,
): string {
	if (links.length === 0) return "";

	const cap = options.maxLinks ?? MAX_LINKS_PER_NOTE;
	const truncated = links.length > cap;
	const visibleLinks = truncated ? links.slice(0, cap) : links;

	const linkLines = visibleLinks.map((link) =>
		formatLink(link, options.vaultBasePath, options.convertToWsl),
	);

	const linksOpen = truncated
		? `<links truncated="${links.length - cap}">`
		: "<links>";

	return `<obsidian_metadata>\n  ${linksOpen}\n${linkLines.join("\n")}\n  </links>\n</obsidian_metadata>\n`;
}

function formatLink(
	link: LinkedNoteMetadata,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const attrs: string[] = [`text="${escapeAttr(link.linkText)}"`];
	if (link.displayText) {
		attrs.push(`displayText="${escapeAttr(link.displayText)}"`);
	}
	if (link.section) {
		attrs.push(`section="${escapeAttr(link.section)}"`);
	}

	if (link.candidates.length === 0) {
		attrs.push(`resolved="false"`);
		return `    <link ${attrs.join(" ")} />`;
	}

	if (link.candidates.length === 1) {
		const c = link.candidates[0];
		const absolutePath = resolveAbsolute(c.path, vaultBasePath, convertToWsl);
		attrs.push(`path="${escapeAttr(absolutePath)}"`);
		attrs.push(`uri="${escapeAttr(buildFileUri(absolutePath))}"`);
		attrs.push(`resolved="true"`);
		return `    <link ${attrs.join(" ")} />`;
	}

	attrs.push(`resolved="ambiguous"`);
	const candidateLines = link.candidates.map((c) => {
		const absolutePath = resolveAbsolute(c.path, vaultBasePath, convertToWsl);
		return `      <candidate path="${escapeAttr(absolutePath)}" uri="${escapeAttr(buildFileUri(absolutePath))}" />`;
	});
	return `    <link ${attrs.join(" ")}>\n${candidateLines.join("\n")}\n    </link>`;
}

function resolveAbsolute(
	relativePath: string,
	vaultBasePath: string,
	convertToWsl: boolean,
): string {
	const absolutePath = vaultBasePath
		? `${vaultBasePath}/${relativePath}`
		: relativePath;
	return convertToWsl ? convertWindowsPathToWsl(absolutePath) : absolutePath;
}

/** XML attribute-value escaping. Covers all five XML predefined entities. */
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
