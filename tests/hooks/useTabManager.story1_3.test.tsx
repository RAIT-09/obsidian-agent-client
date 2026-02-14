import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../../src/hooks/useTabManager";
import type AgentClientPlugin from "../../src/plugin";

/**
 * Tests for User Story 1.3: Switch Between Tabs
 *
 * Tests the useTabManager hook's switchTab method:
 * - switchTab(index) changes activeTabIndex
 * - switchTab validates bounds (no-op for out-of-range)
 * - switchTab is no-op for already-active tab
 * - activeTab and activeTabId reflect the switched tab
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
// Tests
// ============================================================================

describe("useTabManager - User Story 1.3: Switch Between Tabs", () => {
	let mockPlugin: AgentClientPlugin;

	beforeEach(() => {
		mockPlugin = createMockPlugin();
	});

	// ========================================================================
	// AC: Clicking a tab makes it active (switches focus)
	// ========================================================================
	describe("AC: switchTab changes active tab", () => {
		it("should switch to the specified tab index", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Create a second tab
			act(() => {
				result.current.createTab();
			});

			// Currently on tab 1 (newly created)
			expect(result.current.activeTabIndex).toBe(1);

			// Switch back to tab 0
			act(() => {
				result.current.switchTab(0);
			});

			expect(result.current.activeTabIndex).toBe(0);
		});

		it("should update activeTabId when switching tabs", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Create a second tab
			act(() => {
				result.current.createTab();
			});

			const tab0Id = result.current.tabs[0].tabId;
			const tab1Id = result.current.tabs[1].tabId;

			// Currently on tab 1
			expect(result.current.activeTabId).toBe(tab1Id);

			// Switch to tab 0
			act(() => {
				result.current.switchTab(0);
			});

			expect(result.current.activeTabId).toBe(tab0Id);
		});

		it("should update activeTab object when switching tabs", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Create second tab
			act(() => {
				result.current.createTab();
			});

			// Switch to tab 0
			act(() => {
				result.current.switchTab(0);
			});

			expect(result.current.activeTab).toBe(result.current.tabs[0]);
			expect(result.current.activeTab.tabId).toBe("view-1-tab-0");
		});

		it("should allow switching between multiple tabs", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Create 3 more tabs (total 4)
			act(() => result.current.createTab());
			act(() => result.current.createTab());
			act(() => result.current.createTab());

			expect(result.current.activeTabIndex).toBe(3);

			// Switch to tab 1
			act(() => result.current.switchTab(1));
			expect(result.current.activeTabIndex).toBe(1);
			expect(result.current.activeTab.tabId).toBe("view-1-tab-1");

			// Switch to tab 2
			act(() => result.current.switchTab(2));
			expect(result.current.activeTabIndex).toBe(2);
			expect(result.current.activeTab.tabId).toBe("view-1-tab-2");

			// Switch back to tab 0
			act(() => result.current.switchTab(0));
			expect(result.current.activeTabIndex).toBe(0);
			expect(result.current.activeTab.tabId).toBe("view-1-tab-0");
		});
	});

	// ========================================================================
	// Boundary validation: no-op for invalid indices
	// ========================================================================
	describe("switchTab boundary validation", () => {
		it("should be a no-op for negative index", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => result.current.createTab());
			expect(result.current.activeTabIndex).toBe(1);

			act(() => result.current.switchTab(-1));
			expect(result.current.activeTabIndex).toBe(1);
		});

		it("should be a no-op for index equal to tabs length", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => result.current.createTab());
			// tabs.length is 2, so index 2 is out of bounds
			const prevIndex = result.current.activeTabIndex;

			act(() => result.current.switchTab(2));
			expect(result.current.activeTabIndex).toBe(prevIndex);
		});

		it("should be a no-op for index greater than tabs length", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => result.current.switchTab(100));
			expect(result.current.activeTabIndex).toBe(0);
		});

		it("should allow switching to the same tab (no error)", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.activeTabIndex).toBe(0);

			// Switch to already-active tab - should work (no error)
			act(() => result.current.switchTab(0));
			expect(result.current.activeTabIndex).toBe(0);
		});
	});

	// ========================================================================
	// AC: Tabs array is not modified by switchTab
	// ========================================================================
	describe("switchTab does not modify tabs array", () => {
		it("should not add or remove tabs when switching", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => result.current.createTab());
			act(() => result.current.createTab());

			expect(result.current.tabs).toHaveLength(3);

			act(() => result.current.switchTab(0));
			expect(result.current.tabs).toHaveLength(3);

			act(() => result.current.switchTab(2));
			expect(result.current.tabs).toHaveLength(3);
		});

		it("should preserve tab properties when switching", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => result.current.createTab("gemini-cli"));

			const tab0Snapshot = { ...result.current.tabs[0] };
			const tab1Snapshot = { ...result.current.tabs[1] };

			act(() => result.current.switchTab(0));

			expect(result.current.tabs[0].tabId).toBe(tab0Snapshot.tabId);
			expect(result.current.tabs[0].agentId).toBe(tab0Snapshot.agentId);
			expect(result.current.tabs[0].agentLabel).toBe(tab0Snapshot.agentLabel);
			expect(result.current.tabs[1].tabId).toBe(tab1Snapshot.tabId);
			expect(result.current.tabs[1].agentId).toBe(tab1Snapshot.agentId);
			expect(result.current.tabs[1].agentLabel).toBe(tab1Snapshot.agentLabel);
		});
	});

	// ========================================================================
	// switchTab combined with createTab
	// ========================================================================
	describe("switchTab combined with createTab", () => {
		it("should allow switching after creating tabs", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Create tab, switch back, create another, switch around
			act(() => result.current.createTab()); // index 1, active
			act(() => result.current.switchTab(0)); // switch to 0
			act(() => result.current.createTab()); // index 2, active

			expect(result.current.activeTabIndex).toBe(2);
			expect(result.current.tabs).toHaveLength(3);

			act(() => result.current.switchTab(1));
			expect(result.current.activeTabIndex).toBe(1);
		});
	});
});
