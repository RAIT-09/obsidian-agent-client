/**
 * Minimal view interface for chat components.
 *
 * This interface extracts the minimal set of methods that ChatMessages,
 * ChatInput, and other components need from a view. By depending on this
 * interface instead of ChatView directly, these components can work with
 * both sidebar ChatView and FloatingChatView.
 */

import type { App } from "obsidian";

/**
 * Minimal interface for components that need view-level DOM event registration.
 *
 * ChatMessages, ChatInput, SuggestionDropdown, and ErrorOverlay use this
 * for registering scroll and click-outside handlers.
 *
 * Note on `this: HTMLElement` in callback signatures:
 * - This matches Obsidian's Component.registerDomEvent signature for compatibility
 * - In practice, callbacks use arrow functions and don't reference `this`
 * - We maintain this signature to allow ChatView to implement IChatViewHost
 *   without type casting (ChatView extends Component which has this signature)
 */
export interface IChatViewHost {
	/** Obsidian App instance for API access */
	app: App;

	/**
	 * Register a DOM event listener that will be cleaned up when the view closes.
	 *
	 * In sidebar ChatView, this delegates to Obsidian's Component.registerDomEvent.
	 * In floating views, this adds the listener and tracks it for cleanup on unmount.
	 *
	 * Note: Only Window, Document, and HTMLElement are supported as targets.
	 * This matches the actual usage in components (document for click-outside,
	 * HTMLElement for scroll handlers).
	 */
	registerDomEvent<K extends keyof WindowEventMap>(
		el: Window,
		type: K,
		callback: (this: HTMLElement, ev: WindowEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerDomEvent<K extends keyof DocumentEventMap>(
		el: Document,
		type: K,
		callback: (this: HTMLElement, ev: DocumentEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
}
