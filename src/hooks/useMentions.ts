import { useState, useCallback } from "react";
import type {
	NoteMetadata,
	IVaultAccess,
} from "../domain/ports/vault-access.port";
import {
	detectMention,
	replaceMention,
	type MentionContext,
} from "../shared/mention-utils";
import type AgentClientPlugin from "../plugin";

export interface UseMentionsReturn {
	/** Note suggestions matching the current mention query */
	suggestions: NoteMetadata[];
	/** Currently selected index in the dropdown */
	selectedIndex: number;
	/** Whether the dropdown is open */
	isOpen: boolean;
	/** Current mention context (query, position, etc.) */
	context: MentionContext | null;

	/**
	 * Update mention suggestions based on current input.
	 * Detects @-mentions and searches for matching notes.
	 */
	updateSuggestions: (input: string, cursorPosition: number) => Promise<void>;

	/**
	 * Select a note from the dropdown.
	 * @returns Updated input text with mention replaced (e.g., "@[[note name]]")
	 */
	selectSuggestion: (input: string, suggestion: NoteMetadata) => string;

	/** Navigate the dropdown selection */
	navigate: (direction: "up" | "down") => void;

	/** Close the dropdown */
	close: () => void;
}

/**
 * Hook for managing mention dropdown state and logic.
 *
 * Handles @-mention detection, note searching, and dropdown interaction.
 * Uses detectMention/replaceMention utilities for parsing.
 *
 * @param vaultAccess - Vault access port for note searching
 * @param plugin - Plugin instance for settings and configuration
 */
export function useMentions(
	vaultAccess: IVaultAccess,
	plugin: AgentClientPlugin,
): UseMentionsReturn {
	const [suggestions, setSuggestions] = useState<NoteMetadata[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [context, setContext] = useState<MentionContext | null>(null);

	const isOpen = suggestions.length > 0 && context !== null;

	const updateSuggestions = useCallback(
		async (input: string, cursorPosition: number) => {
			const ctx = detectMention(input, cursorPosition, plugin);

			if (!ctx) {
				setSuggestions([]);
				setSelectedIndex(0);
				setContext(null);

				return;
			}

			const results = await vaultAccess.searchNotes(ctx.query);
			setSuggestions(results);
			setSelectedIndex(0);
			setContext(ctx);
		},
		[vaultAccess, plugin],
	);

	const selectSuggestion = useCallback(
		(input: string, suggestion: NoteMetadata): string => {
			if (!context) {
				return input;
			}

			const { newText } = replaceMention(input, context, suggestion.name);

			setSuggestions([]);
			setSelectedIndex(0);
			setContext(null);

			return newText;
		},
		[context],
	);

	const navigate = useCallback(
		(direction: "up" | "down") => {
			if (!isOpen) return;

			const maxIndex = suggestions.length - 1;
			setSelectedIndex((prev) => {
				if (direction === "down") {
					return Math.min(prev + 1, maxIndex);
				} else {
					return Math.max(prev - 1, 0);
				}
			});
		},
		[isOpen, suggestions.length],
	);

	const close = useCallback(() => {
		setSuggestions([]);
		setSelectedIndex(0);
		setContext(null);
	}, []);

	return {
		suggestions,
		selectedIndex,
		isOpen,
		context,
		updateSuggestions,
		selectSuggestion,
		navigate,
		close,
	};
}
