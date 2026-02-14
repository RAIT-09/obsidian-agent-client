import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import type { TabInfo } from "../../src/hooks/useTabManager";

/**
 * Tests for User Story: Tab Overflow with Shrinking
 *
 * Verifies functional behavior with many tabs:
 * - All tabs render regardless of count
 * - Active tab state works at any position
 * - Click/close handlers fire correctly for any tab
 * - Edge cases (0 tabs, 50 tabs) don't crash
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

describe("TabBar - Tab Overflow with Shrinking", () => {
	describe("many tabs (10+) render correctly", () => {
		it("should render all 10 tabs", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(10)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);
			expect(
				container.querySelectorAll(".agent-client-tab"),
			).toHaveLength(10);
		});

		it("should render all 20 tabs", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(20)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);
			expect(
				container.querySelectorAll(".agent-client-tab"),
			).toHaveLength(20);
		});

		it("should mark the correct active tab among 12 tabs", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(12)}
					activeTabIndex={7}
					onTabClick={vi.fn()}
				/>,
			);

			const allTabs = container.querySelectorAll(".agent-client-tab");
			const activeTabs = container.querySelectorAll(
				".agent-client-tab-active",
			);
			expect(activeTabs).toHaveLength(1);
			expect(allTabs[7]).toBe(activeTabs[0]);
		});
	});

	describe("click and close handlers work with many tabs", () => {
		it("should fire click handler for any tab among 12", () => {
			const onTabClick = vi.fn();
			const { container } = render(
				<TabBar
					tabs={createTabs(12)}
					activeTabIndex={0}
					onTabClick={onTabClick}
				/>,
			);

			const tabs = container.querySelectorAll(".agent-client-tab");
			tabs[11].dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			expect(onTabClick).toHaveBeenCalledWith(11);

			tabs[6].dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
			expect(onTabClick).toHaveBeenCalledWith(6);
		});

		it("should render close buttons for all 12 tabs", () => {
			const { container } = render(
				<TabBar
					tabs={createTabs(12)}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			expect(
				container.querySelectorAll(".agent-client-tab-close"),
			).toHaveLength(12);
		});
	});

	describe("edge cases", () => {
		it("should not crash with 0 tabs", () => {
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

		it("should not crash with 50 tabs", () => {
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

		it("should render mixed agent types with many tabs", () => {
			const agents = [
				{ id: "claude-code-acp", label: "Claude Code" },
				{ id: "gemini-cli", label: "Gemini CLI" },
				{ id: "codex-acp", label: "Codex" },
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
				/>,
			);

			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			expect(labels[0].textContent).toContain("Claude Code");
			expect(labels[1].textContent).toContain("Gemini CLI");
			expect(labels[2].textContent).toContain("Codex");
		});
	});
});
