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

	const activeTab = tabs[activeTabIndex];
	const activeTabId = activeTab.tabId;

	return {
		tabs,
		activeTabIndex,
		activeTabId,
		activeTab,
		createTab,
	};
}
