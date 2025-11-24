import { useState, useCallback } from "react";
import type {
	NoteMetadata,
	IVaultAccess,
} from "../core/domain/ports/vault-access.port";

export interface UseAutoMentionReturn {
	/** Currently active note for auto-mention */
	activeNote: NoteMetadata | null;
	/** Whether auto-mention is temporarily disabled */
	isDisabled: boolean;

	/**
	 * Toggle auto-mention enabled/disabled state.
	 * @param disabled - If provided, set to this value. If omitted, toggle current state.
	 */
	toggle: (disabled?: boolean) => void;

	/**
	 * Update the active note from the vault.
	 * Should be called when the active file changes.
	 */
	updateActiveNote: () => Promise<void>;
}

/**
 * Hook for managing auto-mention state.
 *
 * Auto-mention automatically includes the currently active note in messages.
 * This hook tracks the active note and provides a way to temporarily disable
 * the feature (e.g., when using slash commands that require "/" at the start).
 *
 * @param vaultAccess - Vault access port for getting the active note
 */
export function useAutoMention(
	vaultAccess: IVaultAccess,
): UseAutoMentionReturn {
	const [activeNote, setActiveNote] = useState<NoteMetadata | null>(null);
	const [isDisabled, setIsDisabled] = useState(false);

	const toggle = useCallback((disabled?: boolean) => {
		if (disabled === undefined) {
			// Toggle current state
			setIsDisabled((prev) => !prev);
		} else {
			// Set to specific value
			setIsDisabled(disabled);
		}
	}, []);

	const updateActiveNote = useCallback(async () => {
		const note = await vaultAccess.getActiveNote();
		setActiveNote(note);
	}, [vaultAccess]);

	return {
		activeNote,
		isDisabled,
		toggle,
		updateActiveNote,
	};
}
