import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../../src/hooks/useTabManager";
import type AgentClientPlugin from "../../src/plugin";

/**
 * Tests for User Story 1.4: Close Tab with × Button
 *
 * Acceptance Criteria:
 * - [x] Clicking × closes that tab (removes from tab bar)
 * - [x] No confirmation dialog shown
 * - [x] If closing active tab, switch to adjacent tab (prefer left)
 * - [x] If closing non-active tab, active tab stays active
 * - [x] Tab indices adjust correctly after closing
 * - Cannot close last remaining tab (returns null)
 *
 * Test Cases from Backlog:
 * 1. 3 tabs open, close middle tab → Verify 2 tabs remain, correct tab is active
 * 4. Close active tab → Verify switches to previous tab
 * 5. Close non-active tab → Verify active tab stays active
 */

// ============================================================================
// Mock Plugin Factory
// ============================================================================

function createMockPlugin(
	overrides?: Partial<{
		defaultAgentId: string;
		agents: Array<{ id: string; displayName: string }>;
	}>,
) {
	const defaultAgents = [
		{ id: "claude-code-acp", displayName: "Claude Code" },
		{ id: "codex-acp", displayName: "Codex" },
		{ id: "gemini-cli", displayName: "Gemini CLI" },
	];

	const agents = overrides?.agents ?? defaultAgents;
	const defaultAgentId = overrides?.defaultAgentId ?? "claude-code-acp";

	return {
		settings: {
			defaultAgentId,
		},
		getAvailableAgents: vi.fn().mockReturnValue(agents),
	} as unknown as AgentClientPlugin;
}

// ============================================================================
// Helper: create hook with N tabs, specific active tab
// ============================================================================

function createTabManager(
	tabCount: number,
	activeIndex?: number,
	plugin?: AgentClientPlugin,
) {
	const mockPlugin = plugin ?? createMockPlugin();
	const { result } = renderHook(() =>
		useTabManager("view-1", mockPlugin),
	);

	// Create additional tabs beyond the initial one
	for (let i = 1; i < tabCount; i++) {
		act(() => {
			result.current.createTab();
		});
	}

	// Switch to requested active index (createTab sets last created as active)
	if (activeIndex !== undefined && activeIndex !== tabCount - 1) {
		act(() => {
			result.current.switchTab(activeIndex);
		});
	}

	return result;
}

// ============================================================================
// Tests
// ============================================================================

describe("useTabManager - User Story 1.4: Close Tab", () => {
	let mockPlugin: AgentClientPlugin;

	beforeEach(() => {
		mockPlugin = createMockPlugin();
	});

	// ========================================================================
	// AC: Clicking × closes that tab (removes from tab bar)
	// ========================================================================
	describe("AC: closeTab removes the tab from the tabs array", () => {
		it("should remove the tab at the given index", () => {
			const result = createTabManager(3, 0, mockPlugin);

			const closedTabId = result.current.tabs[1].tabId;

			act(() => {
				result.current.closeTab(1);
			});

			expect(result.current.tabs).toHaveLength(2);
			// The closed tab should no longer be in the array
			expect(
				result.current.tabs.find((t) => t.tabId === closedTabId),
			).toBeUndefined();
		});

		it("should return the closed tab's tabId for cleanup", () => {
			const result = createTabManager(3, 0, mockPlugin);

			const expectedTabId = result.current.tabs[1].tabId;

			let returnedTabId: string | null = null;
			act(() => {
				returnedTabId = result.current.closeTab(1);
			});

			expect(returnedTabId).toBe(expectedTabId);
		});

		it("should not show a confirmation dialog (closeTab is synchronous, no-op on blocked)", () => {
			// closeTab returns immediately without any confirmation.
			// This test verifies that closeTab either succeeds (returns tabId)
			// or is blocked (returns null) — no intermediate state.
			const result = createTabManager(2, 0, mockPlugin);

			let returnedTabId: string | null = null;
			act(() => {
				returnedTabId = result.current.closeTab(1);
			});

			// closeTab completes synchronously — either succeeds or returns null
			expect(returnedTabId).not.toBeNull();
		});
	});

	// ========================================================================
	// AC: If closing active tab, switch to adjacent tab (prefer left)
	// Test Case 4: Close active tab → Verify switches to previous tab
	// ========================================================================
	describe("AC: Closing active tab switches to left adjacent tab", () => {
		it("should switch to the left adjacent tab (index - 1) when closing the active tab", () => {
			const result = createTabManager(3, 1, mockPlugin);
			// tabs: [0, 1(active), 2]

			const tab0Id = result.current.tabs[0].tabId;

			act(() => {
				result.current.closeTab(1);
			});

			// Should switch to left adjacent: index 0
			expect(result.current.activeTabIndex).toBe(0);
			expect(result.current.activeTabId).toBe(tab0Id);
		});

		it("should switch to the new first tab (index 0) when closing the first active tab", () => {
			const result = createTabManager(3, 0, mockPlugin);
			// tabs: [0(active), 1, 2]

			const tab1Id = result.current.tabs[1].tabId;

			act(() => {
				result.current.closeTab(0);
			});

			// Since there's no left adjacent, should go to the new index 0
			expect(result.current.activeTabIndex).toBe(0);
			expect(result.current.activeTabId).toBe(tab1Id);
		});

		it("should switch to the left adjacent when closing the last tab (rightmost active)", () => {
			const result = createTabManager(3, 2, mockPlugin);
			// tabs: [0, 1, 2(active)]

			const tab1Id = result.current.tabs[1].tabId;

			act(() => {
				result.current.closeTab(2);
			});

			// Should switch to left adjacent: the new last tab (index 1)
			expect(result.current.activeTabIndex).toBe(1);
			expect(result.current.activeTabId).toBe(tab1Id);
		});
	});

	// ========================================================================
	// AC: If closing non-active tab, active tab stays active
	// Test Case 5: Close non-active tab → Verify active tab stays active
	// ========================================================================
	describe("AC: Closing non-active tab keeps active tab unchanged", () => {
		it("should keep the active tab when closing a tab after it", () => {
			const result = createTabManager(3, 0, mockPlugin);
			// tabs: [0(active), 1, 2]

			const activeTabId = result.current.activeTabId;

			act(() => {
				result.current.closeTab(2);
			});

			expect(result.current.activeTabIndex).toBe(0);
			expect(result.current.activeTabId).toBe(activeTabId);
			expect(result.current.tabs).toHaveLength(2);
		});

		it("should adjust activeTabIndex when closing a tab before the active tab", () => {
			const result = createTabManager(3, 2, mockPlugin);
			// tabs: [0, 1, 2(active)]

			const activeTabId = result.current.activeTabId;

			act(() => {
				result.current.closeTab(0);
			});

			// Active tab was at index 2, closing index 0 shifts it to index 1
			expect(result.current.activeTabIndex).toBe(1);
			// But the same tab should still be active (by tabId)
			expect(result.current.activeTabId).toBe(activeTabId);
			expect(result.current.tabs).toHaveLength(2);
		});

		it("should keep active tab when closing a non-active middle tab", () => {
			const result = createTabManager(4, 3, mockPlugin);
			// tabs: [0, 1, 2, 3(active)]

			const activeTabId = result.current.activeTabId;

			act(() => {
				result.current.closeTab(1);
			});

			// Active tab was at index 3, closing index 1 shifts it to index 2
			expect(result.current.activeTabIndex).toBe(2);
			expect(result.current.activeTabId).toBe(activeTabId);
			expect(result.current.tabs).toHaveLength(3);
		});
	});

	// ========================================================================
	// AC: Tab indices adjust correctly after closing
	// ========================================================================
	describe("AC: Tab indices adjust correctly after closing", () => {
		it("should have correct tabs array after closing middle of 3", () => {
			const result = createTabManager(3, 0, mockPlugin);

			const tab0Id = result.current.tabs[0].tabId;
			const tab2Id = result.current.tabs[2].tabId;

			act(() => {
				result.current.closeTab(1);
			});

			expect(result.current.tabs).toHaveLength(2);
			expect(result.current.tabs[0].tabId).toBe(tab0Id);
			expect(result.current.tabs[1].tabId).toBe(tab2Id);
		});

		it("should allow closing multiple tabs sequentially", () => {
			const result = createTabManager(4, 0, mockPlugin);
			// tabs: [0(active), 1, 2, 3]

			const tab0Id = result.current.tabs[0].tabId;
			const tab3Id = result.current.tabs[3].tabId;

			// Close tab 1
			act(() => {
				result.current.closeTab(1);
			});
			// tabs: [0(active), 2, 3]
			expect(result.current.tabs).toHaveLength(3);

			// Close tab at new index 1 (was originally tab 2)
			act(() => {
				result.current.closeTab(1);
			});
			// tabs: [0(active), 3]
			expect(result.current.tabs).toHaveLength(2);
			expect(result.current.tabs[0].tabId).toBe(tab0Id);
			expect(result.current.tabs[1].tabId).toBe(tab3Id);
		});
	});

	// ========================================================================
	// Test Case 1: 3 tabs open, close middle tab → 2 tabs remain, correct active
	// ========================================================================
	describe("Test Case 1: Close middle tab of 3", () => {
		it("should leave 2 tabs with the correct active tab when closing middle tab (active)", () => {
			const result = createTabManager(3, 1, mockPlugin);
			// tabs: [0, 1(active), 2] → close active middle tab

			const tab0Id = result.current.tabs[0].tabId;

			act(() => {
				result.current.closeTab(1);
			});

			expect(result.current.tabs).toHaveLength(2);
			// Should switch to left adjacent (index 0)
			expect(result.current.activeTabIndex).toBe(0);
			expect(result.current.activeTabId).toBe(tab0Id);
		});

		it("should leave 2 tabs with the same active tab when closing non-active middle tab", () => {
			const result = createTabManager(3, 0, mockPlugin);
			// tabs: [0(active), 1, 2] → close non-active middle tab

			const activeTabId = result.current.activeTabId;

			act(() => {
				result.current.closeTab(1);
			});

			expect(result.current.tabs).toHaveLength(2);
			expect(result.current.activeTabId).toBe(activeTabId);
			expect(result.current.activeTabIndex).toBe(0);
		});
	});

	// ========================================================================
	// Edge cases: cannot close last tab, out-of-bounds
	// ========================================================================
	describe("Edge cases: blocked close operations", () => {
		it("should return null and not remove the tab when only 1 tab remains", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			let returnedTabId: string | null = "not-null";
			act(() => {
				returnedTabId = result.current.closeTab(0);
			});

			expect(returnedTabId).toBeNull();
			expect(result.current.tabs).toHaveLength(1);
		});

		it("should return null for negative index", () => {
			const result = createTabManager(2, 0, mockPlugin);

			let returnedTabId: string | null = "not-null";
			act(() => {
				returnedTabId = result.current.closeTab(-1);
			});

			expect(returnedTabId).toBeNull();
			expect(result.current.tabs).toHaveLength(2);
		});

		it("should return null for out-of-bounds index", () => {
			const result = createTabManager(2, 0, mockPlugin);

			let returnedTabId: string | null = "not-null";
			act(() => {
				returnedTabId = result.current.closeTab(5);
			});

			expect(returnedTabId).toBeNull();
			expect(result.current.tabs).toHaveLength(2);
		});
	});

	// ========================================================================
	// Remaining tabs preserve their data (no mutation)
	// ========================================================================
	describe("Remaining tabs preserve their data after close", () => {
		it("should preserve agentId, agentLabel, and createdAt of remaining tabs", () => {
			const result = createTabManager(3, 0, mockPlugin);

			const tab0Snapshot = { ...result.current.tabs[0] };
			const tab2Snapshot = { ...result.current.tabs[2] };

			act(() => {
				result.current.closeTab(1);
			});

			// Tab 0 (index 0) should be unchanged
			expect(result.current.tabs[0].tabId).toBe(tab0Snapshot.tabId);
			expect(result.current.tabs[0].agentId).toBe(tab0Snapshot.agentId);
			expect(result.current.tabs[0].agentLabel).toBe(
				tab0Snapshot.agentLabel,
			);
			expect(result.current.tabs[0].createdAt).toBe(
				tab0Snapshot.createdAt,
			);

			// Tab 2 (now at index 1) should be unchanged
			expect(result.current.tabs[1].tabId).toBe(tab2Snapshot.tabId);
			expect(result.current.tabs[1].agentId).toBe(tab2Snapshot.agentId);
			expect(result.current.tabs[1].agentLabel).toBe(
				tab2Snapshot.agentLabel,
			);
			expect(result.current.tabs[1].createdAt).toBe(
				tab2Snapshot.createdAt,
			);
		});
	});

	// ========================================================================
	// Close then create: tabId counter continues incrementing
	// ========================================================================
	describe("Close then create: tabId counter continues", () => {
		it("should not reuse closed tab's tabId when creating a new tab", () => {
			const result = createTabManager(2, 0, mockPlugin);
			// tabs: [tab-0(active), tab-1]

			const closedTabId = result.current.tabs[1].tabId;

			act(() => {
				result.current.closeTab(1);
			});

			act(() => {
				result.current.createTab();
			});

			const newTabId = result.current.tabs[1].tabId;
			expect(newTabId).not.toBe(closedTabId);
		});
	});
});
