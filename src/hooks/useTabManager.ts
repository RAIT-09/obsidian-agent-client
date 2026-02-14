import { useState, useCallback, useRef } from "react";
import type AgentClientPlugin from "../plugin";

// ============================================================================
// Types
// ============================================================================

/**
 * Metadata for a single tab in the chat view.
 */
export interface TabInfo {
	/** Unique identifier for this tab (used as adapter key) */
	tabId: string;
	/** Agent ID for this tab's session */
	agentId: string;
	/** Display label for the agent */
	agentLabel: string;
	/** When this tab was created */
	createdAt: Date;
}

/**
 * Return type for useTabManager hook.
 */
export interface UseTabManagerReturn {
	/** All tabs in order */
	tabs: TabInfo[];
	/** Index of the currently active tab */
	activeTabIndex: number;
	/** TabId of the currently active tab */
	activeTabId: string;
	/** Info for the currently active tab */
	activeTab: TabInfo;
	/** Create a new tab with the given or default agent */
	createTab: (agentId?: string) => void;
	/** Switch to a tab by index */
	switchTab: (index: number) => void;
	/** Close a tab by index. Returns the closed tab's tabId, or null if close was blocked. */
	closeTab: (index: number) => string | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing tab lifecycle in the chat view.
 *
 * Each tab has its own tabId used as the adapter key in plugin._adapters.
 * This ensures each tab gets an independent agent process and session.
 *
 * @param viewId - The parent view's unique identifier
 * @param plugin - Plugin instance for settings and agent info
 * @param initialAgentId - Optional agent ID for the first tab (from workspace state)
 */
export function useTabManager(
	viewId: string,
	plugin: AgentClientPlugin,
	initialAgentId?: string,
): UseTabManagerReturn {
	// Counter for generating unique tab IDs
	const tabCounterRef = useRef(1);

	// Resolve the initial agent
	const resolveAgent = useCallback(
		(agentId?: string) => {
			const effectiveId = agentId || plugin.settings.defaultAgentId;
			const agents = plugin.getAvailableAgents();
			const agent = agents.find((a) => a.id === effectiveId);
			return {
				id: effectiveId,
				displayName: agent?.displayName || effectiveId,
			};
		},
		[plugin],
	);

	// Create initial tab
	const [tabs, setTabs] = useState<TabInfo[]>(() => {
		const agent = resolveAgent(initialAgentId);
		return [
			{
				tabId: `${viewId}-tab-0`,
				agentId: agent.id,
				agentLabel: agent.displayName,
				createdAt: new Date(),
			},
		];
	});

	const [activeTabIndex, setActiveTabIndex] = useState(0);

	/**
	 * Create a new tab with the specified or default agent.
	 * The new tab becomes active immediately.
	 */
	const createTab = useCallback(
		(agentId?: string) => {
			const agent = resolveAgent(agentId);
			const tabId = `${viewId}-tab-${tabCounterRef.current++}`;

			const newTab: TabInfo = {
				tabId,
				agentId: agent.id,
				agentLabel: agent.displayName,
				createdAt: new Date(),
			};

			setTabs((prev) => {
				const newTabs = [...prev, newTab];
				// Set active to the new tab (last index)
				setActiveTabIndex(newTabs.length - 1);
				return newTabs;
			});
		},
		[viewId, resolveAgent],
	);

	/**
	 * Switch to a tab by index.
	 * No-op if index is out of bounds or already active.
	 */
	const switchTab = useCallback(
		(index: number) => {
			if (index >= 0 && index < tabs.length) {
				setActiveTabIndex(index);
			}
		},
		[tabs.length],
	);

	/**
	 * Close a tab by index.
	 * Returns the closed tab's tabId for cleanup, or null if close was blocked.
	 *
	 * Active tab switching logic (when closing the active tab):
	 * - Prefer the left adjacent tab (index - 1)
	 * - If closing the first tab, switch to the new first tab (index 0)
	 *
	 * If closing a non-active tab, the active tab stays active (index adjusted if needed).
	 * Cannot close the last remaining tab (returns null).
	 */
	const closeTab = useCallback(
		(index: number): string | null => {
			if (index < 0 || index >= tabs.length) return null;
			if (tabs.length <= 1) return null; // Cannot close last tab

			const closedTab = tabs[index];
			const isClosingActive = index === activeTabIndex;

			setTabs((prev) => prev.filter((_, i) => i !== index));

			if (isClosingActive) {
				// Prefer left adjacent, fall back to 0
				const newIndex = index > 0 ? index - 1 : 0;
				setActiveTabIndex(newIndex);
			} else if (index < activeTabIndex) {
				// Closing a tab before the active one shifts the index down
				setActiveTabIndex((prev) => prev - 1);
			}
			// If closing after active tab, activeTabIndex stays the same

			return closedTab.tabId;
		},
		[tabs, activeTabIndex],
	);

	const activeTab = tabs[activeTabIndex];
	const activeTabId = activeTab.tabId;

	return {
		tabs,
		activeTabIndex,
		activeTabId,
		activeTab,
		createTab,
		switchTab,
		closeTab,
	};
}
