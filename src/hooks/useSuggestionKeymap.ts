import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { Scope } from "obsidian";
import type { App } from "obsidian";

/** What the keys do to the open suggestion dropdown */
export interface SuggestionKeyActions {
	/** Move the selection */
	navigate(direction: "up" | "down"): void;
	/** Use the selected item */
	select(): void;
	/** Close the dropdown */
	close(): void;
}

/**
 * Give an open suggestion dropdown its keys the way Obsidian's own
 * suggestion popups do: while the input has focus, an Obsidian `Scope` is
 * pushed on the keymap. Obsidian's keymap sees key presses before the page
 * does, so this takes them ahead of Obsidian's hotkeys (on Windows/Linux,
 * Ctrl+P and Ctrl+N are the command palette and new note) and ahead of the
 * input's own handling (on macOS, Ctrl+P/N move the cursor).
 *
 * Keys: ArrowUp/ArrowDown and Ctrl+P/Ctrl+N move the selection, Enter and
 * Tab use it, Escape closes the dropdown. Arrows, Enter, Tab and Escape act
 * whatever modifiers are held. Navigation and Enter are left to the IME
 * while it is composing.
 *
 * @param app - Obsidian app, for the keymap
 * @param containerRef - Element containing the input; the scope is active
 *   while focus is inside it
 * @param actions - Actions for the open dropdown, or null when none is open
 */
export function useSuggestionKeymap(
	app: App,
	containerRef: RefObject<HTMLElement | null>,
	actions: SuggestionKeyActions | null,
): void {
	// Handlers read the latest actions, so the scope lives as long as the
	// dropdown is open rather than being rebuilt as the selection moves
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	const isOpen = actions !== null;

	// Layout effect: the scope is in place before the dropdown is painted,
	// so a quick Enter can't reach the input and send the message instead
	useLayoutEffect(() => {
		const containerEl = containerRef.current;
		if (!isOpen || !containerEl) return;

		const scope = new Scope(app.scope);

		// Returning false stops the event; returning nothing for a key
		// registered here lets it through to the input (and the IME)
		const navigate =
			(direction: "up" | "down") =>
			(evt: KeyboardEvent): false | undefined => {
				if (evt.isComposing) return;
				actionsRef.current?.navigate(direction);
				return false;
			};
		scope.register(null, "ArrowUp", navigate("up"));
		scope.register(null, "ArrowDown", navigate("down"));
		// Every platform, as in Obsidian's own suggestion lists
		scope.register(["Ctrl"], "P", navigate("up"));
		scope.register(["Ctrl"], "N", navigate("down"));
		scope.register(null, "Enter", (evt) => {
			if (evt.isComposing) return;
			actionsRef.current?.select();
			return false;
		});
		scope.register(null, "Tab", () => {
			actionsRef.current?.select();
			return false;
		});
		scope.register(null, "Escape", () => {
			actionsRef.current?.close();
			return false;
		});

		// Only while the input has focus, so keys elsewhere (a note, the
		// command palette) are left alone
		const push = () => app.keymap.pushScope(scope);
		const pop = () => app.keymap.popScope(scope);
		containerEl.addEventListener("focusin", push);
		containerEl.addEventListener("focusout", pop);
		if (containerEl.contains(containerEl.doc.activeElement)) {
			push();
		}

		return () => {
			containerEl.removeEventListener("focusin", push);
			containerEl.removeEventListener("focusout", pop);
			pop();
		};
	}, [app, containerRef, isOpen]);
}
