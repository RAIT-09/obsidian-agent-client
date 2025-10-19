import { TFile } from "obsidian";
import { Logger } from "./logger";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

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

	// Check if there's a space, tab, or newline - these end the mention
	if (
		afterAt.includes(" ") ||
		afterAt.includes("\t") ||
		afterAt.includes("\n")
	) {
		logger.log("[DEBUG] Mention ended by whitespace");
		return null;
	}

	// If already in @[[...]] format, handle it
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

// Convert @mentions to relative paths for agent
export function convertMentionsToPath(
	text: string,
	noteMentionService: IMentionService,
	vaultPath: string,
): string {
	// Find all @mentions in the text (@[[filename]] format only)
	const mentionRegex = /@\[\[([^\]]+)\]\]/g;
	let convertedText = text;

	convertedText = convertedText.replace(mentionRegex, (match, noteTitle) => {
		// Extract filename from [[brackets]]

		// Find the file by basename
		const file = noteMentionService
			.getAllFiles()
			.find((f: TFile) => f.basename === noteTitle);
		if (file) {
			// Calculate absolute path by combining vault path with file path
			const absolutePath = vaultPath
				? `${vaultPath}/${file.path}`
				: file.path;
			// TODO: Fix logger usage in utility functions
			// logger.log(
			// 	`[DEBUG] Converting @${noteTitle} to absolute path: ${absolutePath}`,
			// );
			return absolutePath;
		}
		// If file not found, keep original @mention
		return match;
	});

	return convertedText;
}

// Extract @mentions from text for display purposes
export function extractMentions(
	text: string,
): Array<{ text: string; start: number; end: number }> {
	const mentions: Array<{ text: string; start: number; end: number }> = [];
	// Match @[[filename]] format only
	const mentionRegex = /@\[\[([^\]]+)\]\]/g;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Extract filename from [[brackets]]
		const noteTitle = match[1];
		mentions.push({
			text: noteTitle, // Note title without @ and brackets
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	return mentions;
}
