import { TFile } from "obsidian";
import { Logger } from "./logger";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";
import { convertWindowsPathToWsl } from "./wsl-utils";

// Interface for mention service to avoid circular dependency
export interface IMentionService {
	getAllFiles(): TFile[];
}

// Mention detection utilities
export interface MentionContext {
	start: number; // Start index of the @ symbol
	end: number; // Current cursor position
	query: string; // Text after @ symbol
}

// Detect @-mention at current cursor position
export function detectMention(
	text: string,
	cursorPosition: number,
	plugin: AgentClientPlugin,
): MentionContext | null {
	const logger = new Logger(plugin);
	logger.log("[DEBUG] detectMention called with:", { text, cursorPosition });

	if (cursorPosition < 0 || cursorPosition > text.length) {
		logger.log("[DEBUG] Invalid cursor position");
		return null;
	}

	// Get text up to cursor position
	const textUpToCursor = text.slice(0, cursorPosition);
	logger.log("[DEBUG] Text up to cursor:", textUpToCursor);

	// Find the last @ symbol
	const atIndex = textUpToCursor.lastIndexOf("@");
	logger.log("[DEBUG] @ index found:", atIndex);
	if (atIndex === -1) {
		logger.log("[DEBUG] No @ symbol found");
		return null;
	}

	// Get the token after @
	const afterAt = textUpToCursor.slice(atIndex + 1);
	logger.log("[DEBUG] Text after @:", afterAt);

	// Trigger on @ and allow typing query directly
	let query = "";
	let endPos = cursorPosition;

	// If already in @[[...]] format, handle it (allow spaces inside brackets)
	if (afterAt.startsWith("[[")) {
		const closingBrackets = afterAt.indexOf("]]");
		if (closingBrackets === -1) {
			// Still typing inside brackets
			query = afterAt.slice(2); // Remove opening [[
			endPos = cursorPosition;
		} else {
			// Found closing brackets - check if cursor is after them
			const closingBracketsPos = atIndex + 1 + closingBrackets + 1; // +1 for second ]
			if (cursorPosition > closingBracketsPos) {
				// Cursor is after ]], no longer a mention
				logger.log(
					"[DEBUG] Cursor is after closing ]], stopping mention detection",
				);
				return null;
			}
			// Complete bracket format
			query = afterAt.slice(2, closingBrackets); // Between [[ and ]]
			endPos = closingBracketsPos + 1; // Include closing ]]
		}
	} else {
		// Simple @query format - use everything after @
		// But end at whitespace (space, tab, newline)
		if (
			afterAt.includes(" ") ||
			afterAt.includes("\t") ||
			afterAt.includes("\n")
		) {
			logger.log("[DEBUG] Mention ended by whitespace (simple format)");
			return null;
		}
		query = afterAt;
		endPos = cursorPosition;
	}

	const mentionContext = {
		start: atIndex,
		end: endPos,
		query: query,
	};
	logger.log("[DEBUG] Mention context created:", mentionContext);
	return mentionContext;
}

// Replace mention in text with the selected note
export function replaceMention(
	text: string,
	mentionContext: MentionContext,
	noteTitle: string,
): { newText: string; newCursorPos: number } {
	const before = text.slice(0, mentionContext.start);
	const after = text.slice(mentionContext.end);

	// Always use @[[filename]] format
	const replacement = ` @[[${noteTitle}]] `;

	const newText = before + replacement + after;
	const newCursorPos = mentionContext.start + replacement.length;

	return { newText, newCursorPos };
}

// Build context from auto-mentioned note
export function buildAutoMentionContext(
	notePath: string,
	vaultPath: string,
	convertToWsl?: boolean,
	selection?: {
		from: { line: number; ch: number };
		to: { line: number; ch: number };
	},
): string {
	// Calculate absolute path by combining vault path with note path
	let absolutePath = vaultPath ? `${vaultPath}/${notePath}` : notePath;

	// Convert to WSL path format if requested (Windows + WSL mode)
	if (convertToWsl) {
		absolutePath = convertWindowsPathToWsl(absolutePath);
	}

	// Include selection range if available
	if (selection) {
		const fromLine = selection.from.line + 1; // Convert to 1-indexed
		const toLine = selection.to.line + 1;
		const context = `<obsidian_opened_note selection="lines ${fromLine}-${toLine}">The user opened the note ${absolutePath} in Obsidian and is focusing on lines ${fromLine}-${toLine}. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the specific lines.</obsidian_opened_note>`;
		return context;
	}

	const context = `<obsidian_opened_note>The user opened the note ${absolutePath} in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>`;

	return context;
}

// Extract all @mentions from text
export function extractMentionedNotes(
	text: string,
	noteMentionService: IMentionService,
): Array<{ noteTitle: string; file: TFile | undefined }> {
	const mentionRegex = /@\[\[([^\]]+)\]\]/g;
	const matches = Array.from(text.matchAll(mentionRegex));
	const result: Array<{ noteTitle: string; file: TFile | undefined }> = [];
	const seen = new Set<string>(); // Avoid duplicates

	for (const match of matches) {
		const noteTitle = match[1];
		if (seen.has(noteTitle)) {
			continue;
		}
		seen.add(noteTitle);

		// Find the file by basename
		const file = noteMentionService
			.getAllFiles()
			.find((f: TFile) => f.basename === noteTitle);

		result.push({ noteTitle, file });
	}

	return result;
}
