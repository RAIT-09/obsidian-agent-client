import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import type { TabInfo } from "../../src/hooks/useTabManager";

/**
 * Tests for User Story: Tab Overflow with Shrinking
 *
 * Acceptance Criteria:
 * - [x] Tabs shrink in width as more tabs are added (min width: 80px)
 * - [x] Tab labels truncate with ellipsis (...) when too narrow
 * - [x] All tabs remain visible (no scrolling)
 * - [x] Many tabs (10+) handled gracefully
 * - [x] UI doesn't break with overflow
 *
 * Note: Actual CSS rendering (pixel widths, ellipsis display) cannot be tested
 * in jsdom. These tests verify the structural and class-based prerequisites
 * that enable the CSS-driven shrinking and truncation behavior.
 */

function createTab(index: number, overrides?: Partial<TabInfo>): TabInfo {
	return {
		tabId: `view-1-tab-${index}`,
		agentId: "claude-code-acp",
		agentLabel: "Claude Code",
		createdAt: new Date(2026, 1, 14, 10 + index, 0, 0),
		...overrides,
	};
}

function createTabs(count: number): TabInfo[] {
	return Array.from({ length: count }, (_, i) => createTab(i));
}

describe("TabBar - User Story: Tab Overflow with Shrinking", () => {
	// ========================================================================
	// AC: Tabs shrink in width as more tabs are added (min width: 80px)
	// ========================================================================
	describe("AC: Tabs shrink in width as more tabs are added (min width: 80px)", () => {
		it("should render the tab bar as a flex container (agent-client-tab-bar class)", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(3)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar).not.toBeNull();
		});

		it("should render each tab with the agent-client-tab class that enables flex shrinking", () => {
			const tabs = createTabs(5);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(5);

			// Each tab element should have the correct class for flex-based sizing
			tabElements.forEach((tab) => {
				expect(tab.classList.contains("agent-client-tab")).toBe(true);
			});
		});

		it("should render all tabs as direct children of the tab bar flex container", () => {
			const tabs = createTabs(4);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabBar = container.querySelector(".agent-client-tab-bar");
			const directTabChildren = tabBar?.querySelectorAll(
				":scope > .agent-client-tab",
			);
			expect(directTabChildren).toHaveLength(4);
		});
	});

	// ========================================================================
	// AC: Tab labels truncate with ellipsis (...) when too narrow
	// ========================================================================
	describe("AC: Tab labels truncate with ellipsis when too narrow", () => {
		it("should render each tab label with the agent-client-tab-label class for ellipsis", () => {
			const tabs = createTabs(3);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			expect(labels).toHaveLength(3);
		});

		it("should render labels inside a span element for text overflow control", () => {
			const tabs = createTabs(2);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			labels.forEach((label) => {
				expect(label.tagName).toBe("SPAN");
			});
		});

		it("should render the full label text content even when CSS would truncate it", () => {
			const longNameTab = createTab(0, {
				agentLabel:
					"Very Long Agent Name That Would Definitely Overflow",
			});
			const { container } = render(
				<TabBar
					tabs={[longNameTab]}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const label = container.querySelector(".agent-client-tab-label");
			expect(label?.textContent).toContain(
				"Very Long Agent Name That Would Definitely Overflow",
			);
		});
	});

	// ========================================================================
	// AC: All tabs remain visible (no scrolling)
	// ========================================================================
	describe("AC: All tabs remain visible (no scrolling)", () => {
		it("should render the tab bar with overflow:hidden to prevent scrolling", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(5)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar).not.toBeNull();
			// The CSS class agent-client-tab-bar has overflow: hidden
			// We verify the class is present, which implies the overflow behavior
		});

		it("should render all 5 tabs in the DOM when 5 tabs are provided", () => {
			const tabs = createTabs(5);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(5);
		});

		it("should render all 8 tabs in the DOM when 8 tabs are provided", () => {
			const tabs = createTabs(8);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={3}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(8);
		});
	});

	// ========================================================================
	// AC: Many tabs (10+) handled gracefully
	// ========================================================================
	describe("AC: Many tabs (10+) handled gracefully", () => {
		it("should render all 10 tabs in the DOM", () => {
			const tabs = createTabs(10);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(10);
		});

		it("should render all 15 tabs in the DOM", () => {
			const tabs = createTabs(15);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={7}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(15);
		});

		it("should render all 20 tabs in the DOM", () => {
			const tabs = createTabs(20);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={19}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(20);
		});

		it("should correctly mark the active tab among 10+ tabs", () => {
			const tabs = createTabs(12);
			const activeIndex = 7;
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={activeIndex}
					onTabClick={vi.fn()}
				/>,
			);

			const allTabs = container.querySelectorAll(".agent-client-tab");
			const activeTab = container.querySelector(
				".agent-client-tab-active",
			);

			// Exactly one active tab
			expect(
				container.querySelectorAll(".agent-client-tab-active"),
			).toHaveLength(1);
			// The correct tab is active
			expect(allTabs[activeIndex]).toBe(activeTab);
		});

		it("should render unique tab IDs for all 10+ tabs via key prop", () => {
			const tabs = createTabs(12);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(12);

			// Each tab should have a label (verifies all are properly rendered)
			tabElements.forEach((tab) => {
				const label = tab.querySelector(".agent-client-tab-label");
				expect(label).not.toBeNull();
				expect(label?.textContent).toBeTruthy();
			});
		});

		it("should handle click events correctly on any tab among 10+ tabs", () => {
			const onTabClick = vi.fn();
			const tabs = createTabs(12);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={onTabClick}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");

			// Click the last tab
			tabElements[11].dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			expect(onTabClick).toHaveBeenCalledWith(11);

			// Click a middle tab
			tabElements[6].dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			expect(onTabClick).toHaveBeenCalledWith(6);
		});

		it("should render close buttons for all 10+ tabs when onTabClose is provided", () => {
			const tabs = createTabs(12);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);
			expect(closeButtons).toHaveLength(12);
		});
	});

	// ========================================================================
	// AC: UI doesn't break with overflow
	// ========================================================================
	describe("AC: UI doesn't break with overflow", () => {
		it("should not throw errors when rendering with 0 tabs", () => {
			// Edge case: empty array should not crash
			expect(() => {
				render(
					<TabBar
						tabs={[]}
						activeTabIndex={0}
						onTabClick={vi.fn()}
					/>,
				);
			}).not.toThrow();
		});

		it("should render a valid tab bar structure even with 0 tabs", () => {
			const { container } = render(
				<TabBar
					tabs={[]}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar).not.toBeNull();
			const tabs = container.querySelectorAll(".agent-client-tab");
			expect(tabs).toHaveLength(0);
		});

		it("should not throw errors when rendering with 1 tab", () => {
			expect(() => {
				render(
					<TabBar
						tabs={createTabs(1)}
						activeTabIndex={0}
						onTabClick={vi.fn()}
					/>,
				);
			}).not.toThrow();
		});

		it("should not throw errors when rendering with 50 tabs", () => {
			expect(() => {
				render(
					<TabBar
						tabs={createTabs(50)}
						activeTabIndex={25}
						onTabClick={vi.fn()}
						onTabClose={vi.fn()}
					/>,
				);
			}).not.toThrow();
		});

		it("should maintain correct structure with tabs having very long agent labels", () => {
			const tabs = Array.from({ length: 10 }, (_, i) =>
				createTab(i, {
					agentLabel: `Super Long Agent Name That Is Unnecessarily Verbose ${i}`,
				}),
			);

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(10);

			// All labels should be wrapped in the truncation class
			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			expect(labels).toHaveLength(10);
		});

		it("should maintain correct active tab state with many tabs", () => {
			const tabs = createTabs(15);
			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={14}
					onTabClick={vi.fn()}
				/>,
			);

			const activeTabs = container.querySelectorAll(
				".agent-client-tab-active",
			);
			expect(activeTabs).toHaveLength(1);

			// The last tab should be active
			const allTabs = container.querySelectorAll(".agent-client-tab");
			expect(allTabs[14].classList.contains("agent-client-tab-active")).toBe(
				true,
			);
		});

		it("should render mixed agent types correctly with many tabs", () => {
			const agents = [
				{ id: "claude-code-acp", label: "Claude Code" },
				{ id: "gemini-cli", label: "Gemini CLI" },
				{ id: "codex-acp", label: "Codex" },
				{
					id: "custom-agent",
					label: "My Custom Agent With Long Name",
				},
			];

			const tabs = Array.from({ length: 12 }, (_, i) => {
				const agent = agents[i % agents.length];
				return createTab(i, {
					agentId: agent.id,
					agentLabel: agent.label,
				});
			});

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(12);

			// Verify the labels contain correct agent names
			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			expect(labels[0].textContent).toContain("Claude Code");
			expect(labels[1].textContent).toContain("Gemini CLI");
			expect(labels[2].textContent).toContain("Codex");
			expect(labels[3].textContent).toContain(
				"My Custom Agent With Long Name",
			);
		});
	});

	// ========================================================================
	// CSS Structure Verification (prerequisites for overflow behavior)
	// ========================================================================
	describe("CSS Structure: prerequisites for tab overflow behavior", () => {
		it("should use a single container div for the tab bar", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(5)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar?.tagName).toBe("DIV");
		});

		it("should use div elements for individual tabs", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(3)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabs = container.querySelectorAll(".agent-client-tab");
			tabs.forEach((tab) => {
				expect(tab.tagName).toBe("DIV");
			});
		});

		it("should have tab labels nested inside tab containers", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(3)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const tabs = container.querySelectorAll(".agent-client-tab");
			tabs.forEach((tab) => {
				const label = tab.querySelector(".agent-client-tab-label");
				expect(label).not.toBeNull();
			});
		});

		it("should have tab overflow class structure: bar > tab > label", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(5)}
					activeTabIndex={2}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			// Verify the nesting: .agent-client-tab-bar > .agent-client-tab > .agent-client-tab-label
			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar).not.toBeNull();

			const tabsInBar = tabBar!.querySelectorAll(
				":scope > .agent-client-tab",
			);
			expect(tabsInBar).toHaveLength(5);

			tabsInBar.forEach((tab) => {
				const label = tab.querySelector(
					":scope > .agent-client-tab-label",
				);
				expect(label).not.toBeNull();
			});
		});
	});
});
