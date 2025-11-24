/**
 * useMentions Hook
 *
 * Provides @-mention functionality for the chat input.
 */

import * as React from "react";
const { useCallback, useMemo } = React;
import { usePlugin } from "../contexts";
import { useChatContext } from "../contexts";
import { NoteMentionService } from "../adapters/obsidian/mention-service";
import {
	detectMention,
	replaceMention,
} from "../shared/mention-utils";
import type { NoteMetadata } from "../types";

/**
 * Hook for managing @-mention functionality.
 */
export function useMentions() {
	const plugin = usePlugin();
	const { state, dispatch } = useChatContext();

	// Create mention service
	const mentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	/**
	 * Update mention suggestions based on input text and cursor position.
	 */
	const updateMentionSuggestions = useCallback(
		(text: string, cursorPosition: number) => {
			const mentionContext = detectMention(text, cursorPosition, plugin);

			if (!mentionContext) {
				// No mention detected, close dropdown
				if (state.showMentionDropdown) {
					dispatch({
						type: "SET_MENTION_DROPDOWN",
						show: false,
					});
				}
				return;
			}

			// Search for notes matching the query
			const suggestions = mentionService.searchNotes(mentionContext.query);
			const noteMetadata: NoteMetadata[] = suggestions.map((file) => ({
				path: file.path,
				name: file.basename,
				extension: file.extension,
				created: file.stat.ctime,
				modified: file.stat.mtime,
			}));

			dispatch({
				type: "SET_MENTION_DROPDOWN",
				show: true,
				suggestions: noteMetadata,
				query: mentionContext.query,
			});
		},
		[plugin, mentionService, state.showMentionDropdown, dispatch],
	);

	/**
	 * Select a mention from the dropdown.
	 * Returns the new text with the mention inserted.
	 */
	const selectMention = useCallback(
		(inputText: string, suggestion: NoteMetadata): string => {
			const mentionContext = detectMention(
				inputText,
				inputText.length,
				plugin,
			);

			if (!mentionContext) {
				return inputText;
			}

			const result = replaceMention(
				inputText,
				mentionContext,
				suggestion.name,
			);

			// Close dropdown
			dispatch({
				type: "SET_MENTION_DROPDOWN",
				show: false,
			});

			return result.newText;
		},
		[plugin, dispatch],
	);

	/**
	 * Navigate the mention dropdown (up/down).
	 */
	const navigateMentionDropdown = useCallback(
		(direction: "up" | "down") => {
			const { mentionSuggestions, selectedMentionIndex } = state;
			const count = mentionSuggestions.length;
			if (count === 0) return;

			let newIndex: number;
			if (direction === "down") {
				newIndex = (selectedMentionIndex + 1) % count;
			} else {
				newIndex = (selectedMentionIndex - 1 + count) % count;
			}

			dispatch({ type: "SET_MENTION_INDEX", index: newIndex });
		},
		[state, dispatch],
	);

	/**
	 * Close the mention dropdown.
	 */
	const closeMentionDropdown = useCallback(() => {
		dispatch({
			type: "SET_MENTION_DROPDOWN",
			show: false,
		});
	}, [dispatch]);

	return {
		// State
		showMentionDropdown: state.showMentionDropdown,
		mentionSuggestions: state.mentionSuggestions,
		selectedMentionIndex: state.selectedMentionIndex,

		// Actions
		updateMentionSuggestions,
		selectMention,
		navigateMentionDropdown,
		closeMentionDropdown,
	};
}
