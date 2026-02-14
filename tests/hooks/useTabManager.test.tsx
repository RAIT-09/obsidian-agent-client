import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../../src/hooks/useTabManager";
import type AgentClientPlugin from "../../src/plugin";

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

describe("useTabManager", () => {
	let mockPlugin: AgentClientPlugin;

	beforeEach(() => {
		mockPlugin = createMockPlugin();
	});

	// ========================================================================
	// AC: When plugin loads, initial state is one tab
	// ========================================================================
	describe("Initial state", () => {
		it("should start with exactly one tab", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.tabs).toHaveLength(1);
		});

		it("should have activeTabIndex of 0", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.activeTabIndex).toBe(0);
		});

		it("should use default agent from settings when no initialAgentId provided", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.tabs[0].agentId).toBe("claude-code-acp");
			expect(result.current.tabs[0].agentLabel).toBe("Claude Code");
		});

		it("should use initialAgentId when provided", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin, "gemini-cli"),
			);

			expect(result.current.tabs[0].agentId).toBe("gemini-cli");
			expect(result.current.tabs[0].agentLabel).toBe("Gemini CLI");
		});

		it("should generate tabId using viewId prefix", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.tabs[0].tabId).toBe("view-1-tab-0");
		});

		it("should set activeTabId to the initial tab", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.activeTabId).toBe("view-1-tab-0");
		});

		it("should set activeTab to the initial tab object", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			expect(result.current.activeTab).toBe(result.current.tabs[0]);
		});

		it("should set createdAt to a recent date", () => {
			const before = new Date();
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);
			const after = new Date();

			const createdAt = result.current.tabs[0].createdAt;
			expect(createdAt.getTime()).toBeGreaterThanOrEqual(
				before.getTime(),
			);
			expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	// ========================================================================
	// AC: Clicking + creates new tab with default agent
	// AC: New tab becomes active automatically
	// AC: New tab label shows agent name + current timestamp
	// ========================================================================
	describe("AC: createTab creates new tab with default agent", () => {
		it("should add a new tab to the tabs array", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab();
			});

			expect(result.current.tabs).toHaveLength(2);
		});

		it("should use the default agent for the new tab", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab();
			});

			const newTab = result.current.tabs[1];
			expect(newTab.agentId).toBe("claude-code-acp");
			expect(newTab.agentLabel).toBe("Claude Code");
		});

		it("should use a specific agent when agentId is provided", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab("gemini-cli");
			});

			const newTab = result.current.tabs[1];
			expect(newTab.agentId).toBe("gemini-cli");
			expect(newTab.agentLabel).toBe("Gemini CLI");
		});

		it("should set the new tab as active automatically", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab();
			});

			expect(result.current.activeTabIndex).toBe(1);
			expect(result.current.activeTabId).toBe(
				result.current.tabs[1].tabId,
			);
			expect(result.current.activeTab).toBe(result.current.tabs[1]);
		});

		it("should set createdAt on the new tab to the current time", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			const before = new Date();
			act(() => {
				result.current.createTab();
			});
			const after = new Date();

			const createdAt = result.current.tabs[1].createdAt;
			expect(createdAt.getTime()).toBeGreaterThanOrEqual(
				before.getTime(),
			);
			expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	// ========================================================================
	// AC: New tab creates new session with unique sessionId
	// (tested via unique tabId, which is the adapter key / session key)
	// ========================================================================
	describe("AC: Each tab has a unique tabId (adapter key)", () => {
		it("should generate unique tabIds for each new tab", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab();
			});
			act(() => {
				result.current.createTab();
			});

			const tabIds = result.current.tabs.map((t) => t.tabId);
			const uniqueIds = new Set(tabIds);
			expect(uniqueIds.size).toBe(3);
		});

		it("should use incrementing tab counter in tabId", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			act(() => {
				result.current.createTab();
			});
			act(() => {
				result.current.createTab();
			});

			expect(result.current.tabs[0].tabId).toBe("view-1-tab-0");
			expect(result.current.tabs[1].tabId).toBe("view-1-tab-1");
			expect(result.current.tabs[2].tabId).toBe("view-1-tab-2");
		});
	});

	// ========================================================================
	// AC: Can create unlimited tabs (no limit for MVP)
	// Test case 3: Create 5 tabs, verify all have unique labels and sessions
	// ========================================================================
	describe("AC: Can create unlimited tabs", () => {
		it("should allow creating 5 tabs with unique tabIds", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			for (let i = 0; i < 4; i++) {
				act(() => {
					result.current.createTab();
				});
			}

			expect(result.current.tabs).toHaveLength(5);

			const tabIds = result.current.tabs.map((t) => t.tabId);
			const uniqueIds = new Set(tabIds);
			expect(uniqueIds.size).toBe(5);
		});

		it("should set the last created tab as active when creating many tabs", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			for (let i = 0; i < 4; i++) {
				act(() => {
					result.current.createTab();
				});
			}

			expect(result.current.activeTabIndex).toBe(4);
			expect(result.current.activeTab.tabId).toBe(
				result.current.tabs[4].tabId,
			);
		});

		it("should allow creating 10 tabs without errors", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			for (let i = 0; i < 9; i++) {
				act(() => {
					result.current.createTab();
				});
			}

			expect(result.current.tabs).toHaveLength(10);
			expect(result.current.activeTabIndex).toBe(9);
		});
	});

	// ========================================================================
	// AC: Previous tab's session/process remains running
	// (We verify this at the data level: old tabs remain in the tabs array
	//  and their tabIds are unchanged, so adapters remain in plugin._adapters)
	// ========================================================================
	describe("AC: Previous tabs remain in array after creating new tab", () => {
		it("should preserve the original tab when creating a new one", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			const originalTabId = result.current.tabs[0].tabId;
			const originalAgentId = result.current.tabs[0].agentId;

			act(() => {
				result.current.createTab();
			});

			// Original tab still exists at index 0
			expect(result.current.tabs[0].tabId).toBe(originalTabId);
			expect(result.current.tabs[0].agentId).toBe(originalAgentId);
		});

		it("should not mutate existing tabs when creating new ones", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin),
			);

			// Capture original tab references
			const tab0Snapshot = { ...result.current.tabs[0] };

			act(() => {
				result.current.createTab();
			});

			// Original tab's properties should be unchanged
			expect(result.current.tabs[0].tabId).toBe(tab0Snapshot.tabId);
			expect(result.current.tabs[0].agentId).toBe(
				tab0Snapshot.agentId,
			);
			expect(result.current.tabs[0].agentLabel).toBe(
				tab0Snapshot.agentLabel,
			);
			expect(result.current.tabs[0].createdAt).toBe(
				tab0Snapshot.createdAt,
			);
		});
	});

	// ========================================================================
	// Edge case: unknown agent ID falls back to displaying the ID itself
	// ========================================================================
	describe("Edge case: unknown agent ID", () => {
		it("should use the agent ID as displayName if agent is not in settings", () => {
			const { result } = renderHook(() =>
				useTabManager("view-1", mockPlugin, "unknown-agent"),
			);

			expect(result.current.tabs[0].agentId).toBe("unknown-agent");
			expect(result.current.tabs[0].agentLabel).toBe("unknown-agent");
		});
	});
});
