import { TFile } from "obsidian";
import { Logger } from "./logger";
import type AgentClientPlugin from "../main";

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

	// Support both @filename and @[filename with spaces] formats
	let query = "";
	let endPos = cursorPosition;

	if (afterAt.startsWith("[")) {
		// @[filename] format - find closing bracket
		const closingBracket = afterAt.indexOf("]");
		if (closingBracket === -1) {
			// Still typing inside brackets
			query = afterAt.slice(1); // Remove opening [
			endPos = cursorPosition;
		} else {
			// Found closing bracket - check if cursor is after it
			const closingBracketPos = atIndex + 1 + closingBracket;
			if (cursorPosition > closingBracketPos) {
				// Cursor is after ], no longer a mention
				logger.log(
					"[DEBUG] Cursor is after closing ], stopping mention detection",
				);
				return null;
			}
			// Complete bracket format
			query = afterAt.slice(1, closingBracket); // Between [ and ]
			endPos = closingBracketPos + 1; // Include closing ]
		}
	} else {
		// @filename format (no spaces allowed)
		if (
			afterAt.includes(" ") ||
			afterAt.includes("\t") ||
			afterAt.includes("\n") ||
			afterAt.includes("]")
		) {
			logger.log("[DEBUG] Mention contains invalid characters");
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

	// Use @[filename] format if title contains spaces, otherwise @filename
	const replacement = noteTitle.includes(" ")
		? `@[${noteTitle}]`
		: `@${noteTitle}`;

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
	// Find all @mentions in the text (both @filename and @[filename] formats)
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	let convertedText = text;

	convertedText = convertedText.replace(
		mentionRegex,
		(match, bracketName, plainName) => {
			// Extract filename - either from [brackets] or plain text
			const noteTitle = bracketName || plainName;

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
		},
	);

	return convertedText;
}

// Extract @mentions from text for display purposes
export function extractMentions(
	text: string,
): Array<{ text: string; start: number; end: number }> {
	const mentions: Array<{ text: string; start: number; end: number }> = [];
	// Match both @filename and @[filename with spaces] formats
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Extract filename - either from [brackets] or plain text
		const noteTitle = match[1] || match[2];
		mentions.push({
			text: noteTitle, // Note title without @ and brackets
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	return mentions;
}
