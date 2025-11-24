/**
 * useSlashCommands Hook
 *
 * Provides slash command functionality for the chat input.
 */

import * as React from "react";
const { useCallback } = React;
import { useChatContext } from "../contexts";
import type { SlashCommand } from "../types";

/**
 * Hook for managing slash command functionality.
 */
export function useSlashCommands() {
	const { state, dispatch } = useChatContext();

	/**
	 * Update slash command suggestions based on input text.
	 */
	const updateSlashCommandSuggestions = useCallback(
		(text: string, cursorPosition: number) => {
			const availableCommands = state.session.availableCommands || [];

			// Only show slash commands if input starts with /
			if (!text.startsWith("/") || cursorPosition === 0) {
				if (state.showSlashCommandDropdown) {
					dispatch({
						type: "SET_SLASH_COMMAND_DROPDOWN",
						show: false,
					});
				}
				return;
			}

			// Extract the command query (text after /)
			const spaceIndex = text.indexOf(" ");
			const queryEnd = spaceIndex === -1 ? text.length : spaceIndex;

			// Only show dropdown if cursor is in the command name portion
			if (cursorPosition > queryEnd) {
				if (state.showSlashCommandDropdown) {
					dispatch({
						type: "SET_SLASH_COMMAND_DROPDOWN",
						show: false,
					});
				}
				return;
			}

			const query = text.slice(1, queryEnd).toLowerCase();

			// Filter commands by query
			const suggestions = availableCommands.filter((cmd) =>
				cmd.name.toLowerCase().startsWith(query),
			);

			if (suggestions.length === 0) {
				dispatch({
					type: "SET_SLASH_COMMAND_DROPDOWN",
					show: false,
				});
				return;
			}

			dispatch({
				type: "SET_SLASH_COMMAND_DROPDOWN",
				show: true,
				suggestions,
				query,
			});
		},
		[state.session.availableCommands, state.showSlashCommandDropdown, dispatch],
	);

	/**
	 * Select a slash command from the dropdown.
	 * Returns the new text with the command inserted.
	 */
	const selectSlashCommand = useCallback(
		(inputText: string, command: SlashCommand): string => {
			// Replace the current text with the command
			const newText = `/${command.name} `;

			// Close dropdown
			dispatch({
				type: "SET_SLASH_COMMAND_DROPDOWN",
				show: false,
			});

			return newText;
		},
		[dispatch],
	);

	/**
	 * Navigate the slash command dropdown (up/down).
	 */
	const navigateSlashCommandDropdown = useCallback(
		(direction: "up" | "down") => {
			const { slashCommandSuggestions, selectedSlashCommandIndex } = state;
			const count = slashCommandSuggestions.length;
			if (count === 0) return;

			let newIndex: number;
			if (direction === "down") {
				newIndex = (selectedSlashCommandIndex + 1) % count;
			} else {
				newIndex = (selectedSlashCommandIndex - 1 + count) % count;
			}

			dispatch({ type: "SET_SLASH_COMMAND_INDEX", index: newIndex });
		},
		[state, dispatch],
	);

	/**
	 * Close the slash command dropdown.
	 */
	const closeSlashCommandDropdown = useCallback(() => {
		dispatch({
			type: "SET_SLASH_COMMAND_DROPDOWN",
			show: false,
		});
	}, [dispatch]);

	return {
		// State
		showSlashCommandDropdown: state.showSlashCommandDropdown,
		slashCommandSuggestions: state.slashCommandSuggestions,
		selectedSlashCommandIndex: state.selectedSlashCommandIndex,
		availableCommands: state.session.availableCommands || [],

		// Actions
		updateSlashCommandSuggestions,
		selectSlashCommand,
		navigateSlashCommandDropdown,
		closeSlashCommandDropdown,
	};
}
