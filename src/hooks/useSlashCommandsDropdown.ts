/**
 * useSlashCommandsDropdown Hook
 *
 * Standalone hook for managing /command dropdown functionality.
 * Does NOT depend on ChatContext.
 */

import { useState, useCallback } from "react";
import type { SlashCommand } from "../types";

// ============================================================================
// State
// ============================================================================

export interface SlashCommandDropdownState {
	/** Whether the dropdown is currently shown */
	showDropdown: boolean;

	/** Command suggestions filtered by query */
	suggestions: SlashCommand[];

	/** Currently selected index in dropdown */
	selectedIndex: number;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseSlashCommandsDropdownOptions {
	/** Available commands from the agent */
	availableCommands: SlashCommand[];

	/** Callback when auto-mention should be toggled */
	onAutoMentionToggle?: (disabled: boolean) => void;
}

export function useSlashCommandsDropdown(
	options: UseSlashCommandsDropdownOptions,
) {
	const { availableCommands, onAutoMentionToggle } = options;

	// State
	const [state, setState] = useState<SlashCommandDropdownState>({
		showDropdown: false,
		suggestions: [],
		selectedIndex: 0,
	});

	// Track if dropdown was showing (for auto-mention re-enable logic)
	const [wasShowing, setWasShowing] = useState(false);

	/**
	 * Update slash command suggestions based on user input.
	 * Slash commands only trigger at the very beginning of input.
	 */
	const updateSuggestions = useCallback(
		(input: string, cursorPosition: number) => {
			// Slash commands only trigger at the very beginning of input
			if (!input.startsWith("/")) {
				// Only re-enable auto-mention if it was disabled by slash command
				if (wasShowing) {
					onAutoMentionToggle?.(false);
					setWasShowing(false);
				}

				setState((prev) => ({
					...prev,
					showDropdown: false,
					suggestions: [],
					selectedIndex: 0,
				}));
				return;
			}

			// Extract query after '/'
			const textUpToCursor = input.slice(0, cursorPosition);
			const afterSlash = textUpToCursor.slice(1); // Remove leading '/'

			// If there's a space, the command is complete
			if (afterSlash.includes(" ")) {
				setState((prev) => ({
					...prev,
					showDropdown: false,
					suggestions: [],
					selectedIndex: 0,
				}));
				// Keep auto-mention disabled (slash command is still active)
				onAutoMentionToggle?.(true);
				return;
			}

			const query = afterSlash.toLowerCase();

			// Filter available commands
			const suggestions = availableCommands.filter((cmd) =>
				cmd.name.toLowerCase().includes(query),
			);

			const showDropdown = suggestions.length > 0;

			setState((prev) => ({
				...prev,
				showDropdown,
				suggestions,
				selectedIndex: 0,
			}));

			// Track that we're showing dropdown
			if (showDropdown) {
				setWasShowing(true);
			}

			// Disable auto-mention when slash command is detected
			onAutoMentionToggle?.(true);
		},
		[availableCommands, wasShowing, onAutoMentionToggle],
	);

	/**
	 * Select a slash command from the dropdown.
	 * Returns the updated input text with command only (hint is shown as overlay).
	 */
	const selectCommand = useCallback((command: SlashCommand): string => {
		const commandText = `/${command.name} `;

		// Close dropdown
		setState((prev) => ({
			...prev,
			showDropdown: false,
			suggestions: [],
			selectedIndex: 0,
		}));

		return commandText;
	}, []);

	/**
	 * Close the dropdown.
	 */
	const closeDropdown = useCallback(() => {
		setState((prev) => ({
			...prev,
			showDropdown: false,
			suggestions: [],
			selectedIndex: 0,
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

	return {
		// State
		showDropdown: state.showDropdown,
		suggestions: state.suggestions,
		selectedIndex: state.selectedIndex,

		// Actions
		updateSuggestions,
		selectCommand,
		closeDropdown,
		navigate,
	};
}

export type UseSlashCommandsDropdownReturn = ReturnType<
	typeof useSlashCommandsDropdown
>;
