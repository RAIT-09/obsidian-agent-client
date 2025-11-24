import { useState, useCallback } from "react";
import type {
	NoteMetadata,
	IVaultAccess,
} from "../core/domain/ports/vault-access.port";
import {
	detectMention,
	replaceMention,
	type MentionContext,
} from "../shared/mention-utils";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

export interface UseMentionsReturn {
	suggestions: NoteMetadata[];
	selectedIndex: number;
	isOpen: boolean;
	context: MentionContext | null;
	updateSuggestions: (input: string, cursorPosition: number) => Promise<void>;
	selectSuggestion: (input: string, suggestion: NoteMetadata) => string;
	navigate: (direction: "up" | "down") => void;
	close: () => void;
}

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
