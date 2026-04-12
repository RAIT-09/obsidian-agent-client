import * as React from "react";
const { useRef, useEffect } = React;
import {
	Component,
	FileSystemAdapter,
	MarkdownRenderer as ObsidianMarkdownRenderer,
	Platform,
} from "obsidian";
import { convertWslPathToWindows } from "../../utils/platform";
import { isAbsolutePath } from "../../utils/paths";
import type AgentClientPlugin from "../../plugin";

interface MarkdownRendererProps {
	text: string;
	plugin: AgentClientPlugin;
}

const FENCED_CODE_BLOCK_REGEX = /(```[\s\S]*?```)/g;
const INLINE_CODE_REGEX = /(`[^`\n]+`)/g;
const DISPLAY_MATH_BLOCK_REGEX = /(\$\$[\s\S]*?\$\$)/g;
const PROTECTED_MATH_REGEX = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;

function pushDisplayMathBlock(target: string[], lines: string[]): void {
	if (target.length > 0 && target[target.length - 1] !== "") {
		target.push("");
	}

	target.push("$$", ...lines, "$$", "");
}

function looksLikeMathContent(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;

	return [
		/\\begin\{[a-z*]+\}/i,
		/\\end\{[a-z*]+\}/i,
		/\\[a-zA-Z]+/,
		/\^/,
		/_/,
		/&/,
		/\\\\/,
		/[=<>+\-*/]/,
	].some((pattern) => pattern.test(trimmed));
}

function stripOuterMathDelimiters(text: string): string {
	const trimmed = text.trim();
	const doubleMatch = trimmed.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
	if (doubleMatch && looksLikeMathContent(doubleMatch[1])) {
		return doubleMatch[1].trim();
	}

	const singleMatch = trimmed.match(/^\$\s*([\s\S]*?)\s*\$$/);
	if (singleMatch && looksLikeMathContent(singleMatch[1])) {
		return singleMatch[1].trim();
	}

	return trimmed;
}

function isMathLikeInlineFragment(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (/[一-龥]{2,}/.test(trimmed)) return false;
	if (!looksLikeMathContent(trimmed)) return false;
	if (/^(https?:\/\/|www\.)/i.test(trimmed)) return false;

	return /^[A-Za-z0-9\\{}()[\]^_=+\-*/.,\s]+$/.test(trimmed);
}

function isProbablyMathLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	if (
		trimmed === "$$" ||
		trimmed.startsWith("```") ||
		trimmed.startsWith(">") ||
		trimmed.startsWith("#") ||
		trimmed.startsWith("|") ||
		trimmed.includes("`")
	) {
		return false;
	}

	const candidate = trimmed
		.replace(/^[-*+]\s+/, "")
		.replace(/^\d+\.\s+/, "")
		.trim();
	if (candidate.includes("$")) return false;
	const unwrappedCandidate = stripOuterMathDelimiters(candidate);

	if (!unwrappedCandidate) return false;
	if (/[一-龥]{2,}/.test(unwrappedCandidate)) return false;
	if (/[:：；，。！？]$/.test(unwrappedCandidate)) return false;
	if (/^(https?:\/\/|www\.)/i.test(unwrappedCandidate)) return false;
	if (
		!/^[A-Za-z0-9\\{}()[\]^_=+\-*/.,\s&]+$/.test(unwrappedCandidate)
	) {
		return false;
	}

	if (/\\begin\{[a-z*]+\}/i.test(unwrappedCandidate)) return true;
	if (/\\end\{[a-z*]+\}/i.test(unwrappedCandidate)) return true;
	if (
		/[=<>]/.test(unwrappedCandidate) &&
		!/[,:;]/.test(unwrappedCandidate.replace(/\s+/g, ""))
	) {
		return true;
	}

	return isMathLikeInlineFragment(unwrappedCandidate);
}

function normalizeStandaloneBracketMath(text: string): string {
	const lines = text.split(/\r?\n/);
	const normalized: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const current = lines[i].trim();
		if (current !== "[" && current !== "\\[") {
			normalized.push(lines[i]);
			continue;
		}

		let closingIndex = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const candidate = lines[j].trim();
			if (candidate === "]" || candidate === "\\]") {
				closingIndex = j;
				break;
			}
		}

		if (closingIndex === -1) {
			normalized.push(lines[i]);
			continue;
		}

		const innerLines = lines.slice(i + 1, closingIndex);
		if (!looksLikeMathContent(innerLines.join("\n"))) {
			normalized.push(lines[i]);
			continue;
		}

		normalized.push("$$", ...innerLines, "$$");
		i = closingIndex;
	}

	return normalized.join("\n");
}

function normalizeMathDisplayLines(text: string): string {
	const lines = text.split(/\r?\n/);
	const normalized: string[] = [];
	let block: string[] = [];

	const flushBlock = () => {
		if (block.length === 0) return;

		const trimmedBlock = block.map((line) =>
			stripOuterMathDelimiters(line),
		);
		const containsEnvironment = trimmedBlock.some((line) =>
			/\\begin\{[a-z*]+\}|\\end\{[a-z*]+\}/i.test(line),
		);

		if (containsEnvironment) {
			pushDisplayMathBlock(normalized, trimmedBlock);
		} else {
			for (const line of trimmedBlock) {
				pushDisplayMathBlock(normalized, [line]);
			}
		}

		block = [];
	};

	for (const line of lines) {
		if (isProbablyMathLine(line)) {
			block.push(line);
			continue;
		}

		flushBlock();
		normalized.push(line);
	}

	flushBlock();
	return normalized.join("\n");
}

function normalizeInlineMathFragments(text: string): string {
	const codeSegments = text.split(INLINE_CODE_REGEX);

	return codeSegments
		.map((segment, index) => {
			// Preserve inline code verbatim.
			if (index % 2 === 1) return segment;

			return segment
				.split(PROTECTED_MATH_REGEX)
				.map((part, partIndex) => {
					if (partIndex % 2 === 1) return part;

					return part.replace(
						/(^|[^\w$\\])((?:\\[A-Za-z]+(?:\{[^}\n]*\})*|[A-Za-z][A-Za-z0-9]*)(?:[A-Za-z0-9\\{}()[\]^_=+\-*/.,\s]|\\[A-Za-z]+(?:\{[^}\n]*\})*)*)/g,
						(match, prefix: string, expression: string) => {
							if (!isMathLikeInlineFragment(expression)) {
								return match;
							}

							return `${prefix}$${expression}$`;
						},
					);
				})
				.join("");
		})
		.join("");
}

function normalizeMathMarkdown(text: string): string {
	const segments = text.split(FENCED_CODE_BLOCK_REGEX);

	return segments
		.map((segment, index) => {
			// Preserve fenced code blocks verbatim.
			if (index % 2 === 1) return segment;

			const normalizedDisplayMath = segment.replace(
				/\\\[\s*([\s\S]*?)\s*\\\]/g,
				(_match, inner: string) => `$$\n${inner.trim()}\n$$`,
			);

			const normalizedInlineMath = normalizedDisplayMath.replace(
				/\\\((.+?)\\\)/g,
				(_match, inner: string) => `$${inner}$`,
			);

			const normalizedBracketMath =
				normalizeStandaloneBracketMath(normalizedInlineMath);
			const normalizedDisplayLines = normalizedBracketMath
				.split(DISPLAY_MATH_BLOCK_REGEX)
				.map((part, partIndex) => {
					if (partIndex % 2 === 1) return part;
					return normalizeMathDisplayLines(part);
				})
				.join("");

			return normalizedDisplayLines
				.split(DISPLAY_MATH_BLOCK_REGEX)
				.map((part, partIndex) => {
					// Preserve explicit display math blocks verbatim.
					if (partIndex % 2 === 1) return part;
					return normalizeInlineMathFragments(part);
				})
				.join("");
		})
		.join("");
}

export function MarkdownRenderer({ text, plugin }: MarkdownRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty?.();
		el.classList.add("markdown-rendered");

		// Create a temporary component for the markdown renderer lifecycle
		const component = new Component();
		component.load();

		const normalizedText = normalizeMathMarkdown(text);

		// Render markdown
		void ObsidianMarkdownRenderer.render(
			plugin.app,
			normalizedText,
			el,
			"",
			component,
		);

		// Handle internal link clicks
		const vaultBasePath =
			plugin.app.vault.adapter instanceof FileSystemAdapter
				? plugin.app.vault.adapter.getBasePath()
				: null;

		// Prepare normalized vault base path for comparison (forward slashes)
		const isWslMode = Platform.isWin && plugin.settings.windowsWslMode;
		const normalizedVaultBase = vaultBasePath
			? vaultBasePath.replace(/\\/g, "/").replace(/\/+$/, "")
			: null;

		const handleInternalLinkClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const link = target.closest("a.internal-link");
			if (link) {
				e.preventDefault();
				const rawHref = link.getAttribute("data-href");
				if (rawHref) {
					let href = decodeURIComponent(rawHref);

					// WSL mode: convert /mnt/c/... paths to Windows format
					if (isWslMode && href.startsWith("/mnt/")) {
						href = convertWslPathToWindows(href);
					}

					// Normalize for comparison (forward slashes)
					const normalizedHref = href.replace(/\\/g, "/");

					if (
						normalizedVaultBase &&
						normalizedHref.startsWith(normalizedVaultBase + "/")
					) {
						// Absolute vault path → convert to relative
						const relativePath = normalizedHref.slice(
							normalizedVaultBase.length + 1,
						);
						void plugin.app.workspace.openLinkText(
							relativePath,
							"",
						);
					} else if (!isAbsolutePath(href)) {
						// Already relative or wiki-link style — pass through
						void plugin.app.workspace.openLinkText(href, "");
					}
					// Absolute path outside vault — ignore
				}
			}
		};
		el.addEventListener("click", handleInternalLinkClick);

		return () => {
			el.removeEventListener("click", handleInternalLinkClick);
			component.unload();
		};
	}, [text, plugin]);

	return (
		<div
			ref={containerRef}
			className="agent-client-markdown-text-renderer"
		/>
	);
}
