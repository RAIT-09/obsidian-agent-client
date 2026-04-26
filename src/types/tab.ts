/**
 * Types for internal tabbed multi-session support.
 *
 * Each tab represents an independent agent session within a single
 * ChatView leaf. Tabs are the multiplexing unit — one Obsidian leaf,
 * N agent sessions.
 */

/**
 * Visual state of a tab, derived from SessionState + permission status.
 * Used by TabBar to render the correct icon shape/color/animation.
 *
 * Colorblind-safe: states are distinguished by shape first, color second,
 * animation third. No red/green contrast dependency.
 */
export type TabState =
	| "ready" // ● blue — idle, waiting for input
	| "busy" // ◐ blue, spinning — agent processing
	| "permission" // △ orange, pulsing — awaiting user approval
	| "error" // ✕ red — session error
	| "disconnected"; // ○ gray — session closed

/**
 * Metadata for a single tab in the tab bar.
 */
export interface TabInfo {
	/** Unique identifier for this tab */
	tabId: string;
	/** Agent ID running in this tab */
	agentId: string;
	/** Short label displayed on the tab (≤25 chars) */
	label: string;
	/** Current visual state for the tab icon */
	state: TabState;
	/** Timestamp when this tab was created */
	createdAt: Date;
}
