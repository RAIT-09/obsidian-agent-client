/**
 * Hook for managing tabbed sessions within a single ChatView.
 *
 * Each tab represents an independent agent session. The hook manages
 * the tab list, active tab, and tab metadata (label, state).
 * Tab creation/destruction of AcpClient instances is handled by the
 * parent ChatView via plugin.getOrCreateAcpClient(tabId).
 */

import { useState, useCallback, useMemo } from "react";
import type { TabInfo, TabState } from "../types/tab";

// ============================================================================
// Types
// ============================================================================

export interface UseTabManagerReturn {
	/** All tabs in order */
	tabs: TabInfo[];
	/** Currently active tab ID */
	activeTabId: string;
	/** Currently active tab info */
	activeTab: TabInfo;
	/** Add a new tab and switch to it */
	addTab: (agentId: string, label?: string) => string;
	/** Remove a tab by ID. Returns the new active tab ID. */
	removeTab: (tabId: string) => string | null;
	/** Remove all tabs except the given one */
	removeOtherTabs: (tabId: string) => void;
	/** Remove all tabs to the right of the given one */
	removeTabsToRight: (tabId: string) => void;
	/** Switch to a tab */
	setActiveTab: (tabId: string) => void;
	/** Update a tab's label */
	setTabLabel: (tabId: string, label: string) => void;
	/** Update a tab's visual state */
	setTabState: (tabId: string, state: TabState) => void;
	/** Reset a tab's label and state to defaults (used after error boundary retry) */
	resetTab: (tabId: string) => void;
	/** Reorder: move tab from one index to another */
	moveTab: (fromIndex: number, toIndex: number) => void;
	/** Switch to next tab (cyclic) */
	nextTab: () => void;
	/** Switch to previous tab (cyclic) */
	prevTab: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function generateTabId(): string {
	return `tab-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultLabel(agentId: string): string {
	return `${agentId} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function createTab(agentId: string, label?: string): TabInfo {
	return {
		tabId: generateTabId(),
		agentId,
		label: label || defaultLabel(agentId),
		state: "disconnected",
		createdAt: new Date(),
	};
}

function truncateLabel(text: string, max = 25): string {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Manages tab state for a single ChatView.
 *
 * @param initialAgentId - Agent ID for the first tab (created on mount)
 */
export function useTabManager(initialAgentId: string): UseTabManagerReturn {
	const [tabs, setTabs] = useState<TabInfo[]>(() => {
		const first = createTab(initialAgentId);
		return [first];
	});
	const [activeTabId, setActiveTabId] = useState<string>(
		() => tabs[0].tabId,
	);

	const addTab = useCallback(
		(agentId: string, label?: string): string => {
			const tab = createTab(agentId, label);
			setTabs((prev) => [...prev, tab]);
			setActiveTabId(tab.tabId);
			return tab.tabId;
		},
		[],
	);

	const removeTab = useCallback(
		(tabId: string): string | null => {
			let newActiveId: string | null = null;
			setTabs((prev) => {
				if (prev.length <= 1) return prev; // Don't remove last tab
				const idx = prev.findIndex((t) => t.tabId === tabId);
				if (idx === -1) return prev;
				const next = prev.filter((t) => t.tabId !== tabId);
				// If removing the active tab, activate the nearest neighbor
				if (tabId === activeTabId) {
					const newIdx = Math.min(idx, next.length - 1);
					newActiveId = next[newIdx].tabId;
					setActiveTabId(newActiveId);
				} else {
					newActiveId = activeTabId;
				}
				return next;
			});
			return newActiveId;
		},
		[activeTabId],
	);

	const removeOtherTabs = useCallback(
		(tabId: string) => {
			setTabs((prev) => prev.filter((t) => t.tabId === tabId));
			setActiveTabId(tabId);
		},
		[],
	);

	const removeTabsToRight = useCallback(
		(tabId: string) => {
			setTabs((prev) => {
				const idx = prev.findIndex((t) => t.tabId === tabId);
				if (idx === -1) return prev;
				return prev.slice(0, idx + 1);
			});
			// If active tab was to the right, switch to the kept tab
			setTabs((prev) => {
				if (!prev.find((t) => t.tabId === activeTabId)) {
					setActiveTabId(tabId);
				}
				return prev;
			});
		},
		[activeTabId],
	);

	const setTabLabel = useCallback(
		(tabId: string, label: string) => {
			setTabs((prev) =>
				prev.map((t) =>
					t.tabId === tabId
						? { ...t, label: truncateLabel(label) }
						: t,
				),
			);
		},
		[],
	);

	const setTabState = useCallback(
		(tabId: string, state: TabState) => {
			setTabs((prev) =>
				prev.map((t) =>
					t.tabId === tabId ? { ...t, state } : t,
				),
			);
		},
		[],
	);

	const resetTab = useCallback((tabId: string) => {
		setTabs((prev) =>
			prev.map((t) =>
				t.tabId === tabId
					? { ...t, label: defaultLabel(t.agentId), state: "disconnected" }
					: t,
			),
		);
	}, []);

	const moveTab = useCallback(
		(fromIndex: number, toIndex: number) => {
			setTabs((prev) => {
				if (
					fromIndex < 0 ||
					fromIndex >= prev.length ||
					toIndex < 0 ||
					toIndex >= prev.length
				)
					return prev;
				const next = [...prev];
				const [moved] = next.splice(fromIndex, 1);
				next.splice(toIndex, 0, moved);
				return next;
			});
		},
		[],
	);

	const nextTab = useCallback(() => {
		setTabs((prev) => {
			const idx = prev.findIndex((t) => t.tabId === activeTabId);
			const nextIdx = (idx + 1) % prev.length;
			setActiveTabId(prev[nextIdx].tabId);
			return prev;
		});
	}, [activeTabId]);

	const prevTab = useCallback(() => {
		setTabs((prev) => {
			const idx = prev.findIndex((t) => t.tabId === activeTabId);
			const prevIdx = (idx - 1 + prev.length) % prev.length;
			setActiveTabId(prev[prevIdx].tabId);
			return prev;
		});
	}, [activeTabId]);

	const activeTab = useMemo(
		() =>
			tabs.find((t) => t.tabId === activeTabId) ?? tabs[0],
		[tabs, activeTabId],
	);

	return useMemo(
		() => ({
			tabs,
			activeTabId,
			activeTab,
			addTab,
			removeTab,
			removeOtherTabs,
			removeTabsToRight,
			setActiveTab: setActiveTabId,
			setTabLabel,
			setTabState,
			resetTab,
			moveTab,
			nextTab,
			prevTab,
		}),
		[
			tabs,
			activeTabId,
			activeTab,
			addTab,
			removeTab,
			removeOtherTabs,
			removeTabsToRight,
			setTabLabel,
			setTabState,
			resetTab,
			moveTab,
			nextTab,
			prevTab,
		],
	);
}
