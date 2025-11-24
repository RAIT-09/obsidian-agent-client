/**
 * useMentionsDropdown Hook
 *
 * Standalone hook for managing @-mention dropdown functionality.
 * Does NOT depend on ChatContext.
 */

import { useState, useCallback } from "react";
import type { NoteMetadata, IVaultAccess } from "../types";
import type { MentionContext } from "../shared/mention-utils";
import { detectMention, replaceMention } from "../shared/mention-utils";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

// ============================================================================
// State
// ============================================================================

export interface MentionDropdownState {
	/** Whether the mention dropdown is currently shown */
	showDropdown: boolean;

	/** Note suggestions for dropdown */
	suggestions: NoteMetadata[];

	/** Currently selected index in dropdown */
	selectedIndex: number;

	/** Current mention context (query and position) */
	mentionContext: MentionContext | null;

	/** Whether auto-mention is temporarily disabled */
	isAutoMentionDisabled: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseMentionsDropdownOptions {
	/** Plugin instance for mention detection */
	plugin: AgentClientPlugin;

	/** Vault access for searching notes */
	vaultAccess: IVaultAccess;
}

export function useMentionsDropdown(options: UseMentionsDropdownOptions) {
	const { plugin, vaultAccess } = options;

	// State
	const [state, setState] = useState<MentionDropdownState>({
		showDropdown: false,
		suggestions: [],
		selectedIndex: 0,
		mentionContext: null,
		isAutoMentionDisabled: false,
	});

	/**
	 * Update mention suggestions based on current input.
	 */
	const updateSuggestions = useCallback(
		async (input: string, cursorPosition: number) => {
			// Detect mention context
			const context = detectMention(input, cursorPosition, plugin);

			if (!context) {
				// No mention context - close dropdown
				setState((prev) => ({
					...prev,
					showDropdown: false,
					suggestions: [],
					selectedIndex: 0,
					mentionContext: null,
				}));
				return;
			}

			// Search for matching notes
			const suggestions = await vaultAccess.searchNotes(context.query);

			// Update state with suggestions
			setState((prev) => ({
				...prev,
				showDropdown: true,
				suggestions,
				selectedIndex: 0,
				mentionContext: context,
			}));
		},
		[plugin, vaultAccess],
	);

	/**
	 * Select a mention from the suggestion list.
	 * Returns updated input text with mention replaced.
	 */
	const selectMention = useCallback(
		(input: string, suggestion: NoteMetadata): string => {
			if (!state.mentionContext) {
				return input;
			}

			// Replace mention with selected note name
			const { newText } = replaceMention(
				input,
				state.mentionContext,
				suggestion.name,
			);

			// Close dropdown
			setState((prev) => ({
				...prev,
				showDropdown: false,
				suggestions: [],
				selectedIndex: 0,
				mentionContext: null,
			}));

			return newText;
		},
		[state.mentionContext],
	);

	/**
	 * Close the mention dropdown.
	 */
	const closeDropdown = useCallback(() => {
		setState((prev) => ({
			...prev,
			showDropdown: false,
			suggestions: [],
			selectedIndex: 0,
			mentionContext: null,
		}));
	}, []);

	/**
	 * Navigate dropdown selection (up/down).
	 */
	const navigate = useCallback((direction: "up" | "down") => {
		setState((prev) => {
			if (!prev.showDropdown || prev.suggestions.length === 0) {
				return prev;
			}

			const maxIndex = prev.suggestions.length - 1;
			let newIndex = prev.selectedIndex;

			if (direction === "down") {
				newIndex = Math.min(newIndex + 1, maxIndex);
			} else {
				newIndex = Math.max(newIndex - 1, 0);
			}

			return { ...prev, selectedIndex: newIndex };
		});
	}, []);

	/**
	 * Toggle auto-mention mode temporarily.
	 */
	const toggleAutoMention = useCallback((disabled: boolean) => {
		setState((prev) => ({
			...prev,
			isAutoMentionDisabled: disabled,
		}));
	}, []);

	return {
		// State
		showDropdown: state.showDropdown,
		suggestions: state.suggestions,
		selectedIndex: state.selectedIndex,
		mentionContext: state.mentionContext,
		isAutoMentionDisabled: state.isAutoMentionDisabled,

		// Actions
		updateSuggestions,
		selectMention,
		closeDropdown,
		navigate,
		toggleAutoMention,
	};
}

export type UseMentionsDropdownReturn = ReturnType<typeof useMentionsDropdown>;
