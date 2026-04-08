/**
 * Registry for managing all chat view containers.
 *
 * Provides unified access to views for:
 * - Focus tracking (replacing _lastActiveChatViewId + floating tracking)
 * - Broadcast commands (extending to all view types)
 * - Multi-view operations (focusNext, toAll, etc.)
 *
 * Design notes:
 * - Views register themselves on mount, unregister on close
 * - Focus is tracked via focusedViewId
 * - Registry does not own view lifecycle, only tracks references
 * - clear() is called during plugin unload for cleanup
 * - focusNext/Previous order is based on registration order, not workspace leaf order
 *   (this is acceptable as users don't have strong expectations about the order)
 */

import type { ChatInputState } from "../types/chat";
import { getLogger } from "../utils/logger";

// ============================================================================
// Port Types (from chat-view-container.port.ts)
// ============================================================================

/**
 * Type of chat view container.
 * Used for filtering and type-specific behavior.
 */
export type ChatViewType = "sidebar" | "floating";

/**
 * Interface that all chat view containers must implement.
 * Enables the plugin to manage views uniformly regardless of their implementation.
 */
export interface IChatViewContainer {
	// ============================================================
	// Identification
	// ============================================================

	/** Unique identifier for this view instance */
	readonly viewId: string;

	/** Type of this view (sidebar, floating, etc.) */
	readonly viewType: ChatViewType;

	/** Human-readable display name for this view (e.g. active agent label). */
	getDisplayName(): string;

	// ============================================================
	// Lifecycle
	// ============================================================

	/**
	 * Called when this view becomes the active/focused view.
	 * Triggered by ChatViewRegistry.setFocused().
	 */
	onActivate(): void;

	/**
	 * Called when this view loses active/focused status.
	 * Triggered by ChatViewRegistry.setFocused() or unregister().
	 */
	onDeactivate(): void;

	// ============================================================
	// Focus Management
	// ============================================================

	/**
	 * Programmatically focus this view's input.
	 * Should focus the chat input textarea.
	 * For floating views, this also expands the window if collapsed.
	 */
	focus(): void;

	/**
	 * Check if this view currently has focus.
	 * Returns true if any element within this view's container is focused.
	 */
	hasFocus(): boolean;

	/**
	 * Expand the view if it's in a collapsed state.
	 * For sidebar views, this is a no-op.
	 * For floating views, this expands the window.
	 *
	 * Note: This method is provided for explicit expand operations (e.g., from UI).
	 * When focus() is called, it internally handles expansion before focusing.
	 * ChatViewRegistry uses focus() which implicitly expands, so expand() is not
	 * directly called by the registry.
	 */
	expand(): void;

	/**
	 * Collapse the view if it's in an expanded state.
	 * For sidebar views, this is a no-op.
	 * For floating views, this hides the window without destroying the instance.
	 */
	collapse(): void;

	// ============================================================
	// Broadcast Commands
	// ============================================================

	/**
	 * Get current input state (text + images) for broadcast.
	 * Returns null if input state is not available.
	 */
	getInputState(): ChatInputState | null;

	/**
	 * Set input state (text + images) from broadcast.
	 * Used to copy prompt from one view to another.
	 */
	setInputState(state: ChatInputState): void;

	/**
	 * Check if this view is ready to send a message.
	 * Returns true if:
	 * - Session is ready
	 * - Not currently sending
	 * - Not loading session history
	 * - Has content (text or images)
	 */
	canSend(): boolean;

	/**
	 * Trigger send message with full support for images.
	 * @returns Promise<boolean> - true if message was sent, false otherwise
	 */
	sendMessage(): Promise<boolean>;

	/**
	 * Cancel current operation.
	 * Stops ongoing message generation.
	 */
	cancelOperation(): Promise<void>;

	// ============================================================
	// Container Access
	// ============================================================

	/**
	 * Get the DOM container element for this view.
	 * Used for focus detection and DOM queries.
	 */
	getContainerEl(): HTMLElement;
}

export class ChatViewRegistry {
	private views = new Map<string, IChatViewContainer>();
	private focusedViewId: string | null = null;
	private logger = getLogger();

	// ============================================================
	// Registration
	// ============================================================

	/**
	 * Register a view container.
	 * The first registered view automatically becomes focused.
	 */
	register(view: IChatViewContainer): void {
		this.logger.log(
			`[ChatViewRegistry] Registering view: ${view.viewId} (${view.viewType})`,
		);
		this.views.set(view.viewId, view);

		// First view becomes focused by default
		if (this.views.size === 1) {
			this.setFocused(view.viewId);
		}
	}

	/**
	 * Unregister a view container.
	 * If the focused view is unregistered, focus moves to another view.
	 */
	unregister(viewId: string): void {
		this.logger.log(`[ChatViewRegistry] Unregistering view: ${viewId}`);
		const view = this.views.get(viewId);
		if (view) {
			view.onDeactivate();
		}
		this.views.delete(viewId);

		// Move focus if this was the focused view
		if (this.focusedViewId === viewId) {
			const remaining = Array.from(this.views.keys());
			this.focusedViewId = remaining.length > 0 ? remaining[0] : null;
			if (this.focusedViewId) {
				this.views.get(this.focusedViewId)?.onActivate();
			}
		}
	}

	/**
	 * Clear all views from the registry.
	 * Called during plugin unload to clean up resources.
	 * Note: This does NOT call unmount() on views - that should be done separately.
	 */
	clear(): void {
		this.logger.log("[ChatViewRegistry] Clearing all views");
		for (const view of this.views.values()) {
			view.onDeactivate();
		}
		this.views.clear();
		this.focusedViewId = null;
	}

	// ============================================================
	// Focus Management
	// ============================================================

	/**
	 * Get the currently focused view.
	 */
	getFocused(): IChatViewContainer | null {
		return this.focusedViewId
			? (this.views.get(this.focusedViewId) ?? null)
			: null;
	}

	/**
	 * Get the focused view ID.
	 */
	getFocusedId(): string | null {
		return this.focusedViewId;
	}

	/**
	 * Set a view as focused.
	 */
	setFocused(viewId: string): void {
		if (this.focusedViewId === viewId) return;
		if (!this.views.has(viewId)) return;

		// Deactivate previous
		if (this.focusedViewId) {
			this.views.get(this.focusedViewId)?.onDeactivate();
		}

		// Activate new
		this.focusedViewId = viewId;
		this.views.get(viewId)?.onActivate();
		this.logger.log(`[ChatViewRegistry] Focus changed to: ${viewId}`);
	}

	/**
	 * Focus the next view in the list (cyclic).
	 * Order is based on registration order (Map insertion order).
	 */
	focusNext(): void {
		const ids = Array.from(this.views.keys());
		if (ids.length === 0) return;

		const currentIndex = this.focusedViewId
			? ids.indexOf(this.focusedViewId)
			: -1;
		const nextIndex = (currentIndex + 1) % ids.length;
		this.setFocused(ids[nextIndex]);
		this.views.get(ids[nextIndex])?.focus();
	}

	/**
	 * Focus the previous view in the list (cyclic).
	 * Order is based on registration order (Map insertion order).
	 */
	focusPrevious(): void {
		const ids = Array.from(this.views.keys());
		if (ids.length === 0) return;

		const currentIndex = this.focusedViewId
			? ids.indexOf(this.focusedViewId)
			: 0;
		const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
		this.setFocused(ids[prevIndex]);
		this.views.get(ids[prevIndex])?.focus();
	}

	// ============================================================
	// Broadcast Operations
	// ============================================================

	/**
	 * Execute action on the focused view only.
	 */
	toFocused<T>(action: (view: IChatViewContainer) => T): T | null {
		const focused = this.getFocused();
		return focused ? action(focused) : null;
	}

	/**
	 * Execute action on all views.
	 */
	toAll(action: (view: IChatViewContainer) => void): void {
		this.views.forEach(action);
	}

	/**
	 * Execute action on views of a specific type.
	 */
	toType(
		type: ChatViewType,
		action: (view: IChatViewContainer) => void,
	): void {
		this.views.forEach((view) => {
			if (view.viewType === type) action(view);
		});
	}

	// ============================================================
	// Query
	// ============================================================

	/**
	 * Get all registered views.
	 */
	getAll(): IChatViewContainer[] {
		return Array.from(this.views.values());
	}

	/**
	 * Get views of a specific type.
	 */
	getByType(type: ChatViewType): IChatViewContainer[] {
		return Array.from(this.views.values()).filter(
			(v) => v.viewType === type,
		);
	}

	/**
	 * Get a view by ID.
	 */
	get(viewId: string): IChatViewContainer | null {
		return this.views.get(viewId) ?? null;
	}

	/**
	 * Get count of registered views.
	 */
	get size(): number {
		return this.views.size;
	}
}
