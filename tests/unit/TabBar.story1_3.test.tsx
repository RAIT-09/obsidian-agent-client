import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, fireEvent } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import type { TabInfo } from "../../src/hooks/useTabManager";

/**
 * Tests for User Story 1.3: Switch Between Tabs - TabBar Click Handler
 *
 * Acceptance Criteria:
 * - Clicking a tab calls onTabClick with the correct index
 * - Active tab shows visual distinction (agent-client-tab-active class)
 * - Clicking already-active tab still fires callback
 */

describe("TabBar - User Story 1.3: Tab Click", () => {
	function createTab(overrides?: Partial<TabInfo>): TabInfo {
		return {
			tabId: "view-1-tab-0",
			agentId: "claude-code-acp",
			agentLabel: "Claude Code",
			createdAt: new Date(2026, 1, 14, 14, 34, 0),
			...overrides,
		};
	}

	// ========================================================================
	// AC: Clicking a tab makes it active (fires onTabClick)
	// ========================================================================
	describe("AC: Clicking a tab calls onTabClick with correct index", () => {
		it("should call onTabClick with index 0 when first tab is clicked", () => {
			const onTabClick = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={1} onTabClick={onTabClick} />,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			fireEvent.click(tabElements[0]);

			expect(onTabClick).toHaveBeenCalledOnce();
			expect(onTabClick).toHaveBeenCalledWith(0);
		});

		it("should call onTabClick with index 1 when second tab is clicked", () => {
			const onTabClick = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={onTabClick} />,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			fireEvent.click(tabElements[1]);

			expect(onTabClick).toHaveBeenCalledOnce();
			expect(onTabClick).toHaveBeenCalledWith(1);
		});

		it("should call onTabClick with correct index for any tab in a list of 5", () => {
			const onTabClick = vi.fn();
			const tabs = Array.from({ length: 5 }, (_, i) =>
				createTab({
					tabId: `view-1-tab-${i}`,
					createdAt: new Date(2026, 1, 14, 10 + i, 0, 0),
				}),
			);

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={onTabClick} />,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");

			// Click tab 3 (index 3)
			fireEvent.click(tabElements[3]);
			expect(onTabClick).toHaveBeenLastCalledWith(3);

			// Click tab 4 (index 4)
			fireEvent.click(tabElements[4]);
			expect(onTabClick).toHaveBeenLastCalledWith(4);

			expect(onTabClick).toHaveBeenCalledTimes(2);
		});

		it("should call onTabClick even when clicking the already-active tab", () => {
			const onTabClick = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={onTabClick} />,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");
			// Click already-active tab (index 0)
			fireEvent.click(tabElements[0]);

			expect(onTabClick).toHaveBeenCalledOnce();
			expect(onTabClick).toHaveBeenCalledWith(0);
		});
	});

	// ========================================================================
	// AC: Active tab shows visual distinction
	// ========================================================================
	describe("AC: Active tab shows visual distinction", () => {
		it("should apply active class to the tab at activeTabIndex", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
				createTab({ tabId: "view-1-tab-2" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={1} onTabClick={vi.fn()} />,
			);

			const tabElements = container.querySelectorAll(".agent-client-tab");

			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(false);
			expect(tabElements[1].classList.contains("agent-client-tab-active")).toBe(true);
			expect(tabElements[2].classList.contains("agent-client-tab-active")).toBe(false);
		});

		it("should re-render with correct active class when activeTabIndex changes (simulating switch)", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
				createTab({ tabId: "view-1-tab-2" }),
			];

			const { container, rerender } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={vi.fn()} />,
			);

			// Initially tab 0 is active
			let tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(true);
			expect(tabElements[2].classList.contains("agent-client-tab-active")).toBe(false);

			// Simulate switching to tab 2
			rerender(<TabBar tabs={tabs} activeTabIndex={2} onTabClick={vi.fn()} />);

			tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(false);
			expect(tabElements[2].classList.contains("agent-client-tab-active")).toBe(true);
		});
	});

	// ========================================================================
	// Click handler targets the tab div, not the label span
	// ========================================================================
	describe("Click handler on tab container", () => {
		it("should still fire onTabClick when clicking the label span inside the tab", () => {
			const onTabClick = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={onTabClick} />,
			);

			// Click the label span inside the second tab
			const labelSpans = container.querySelectorAll(".agent-client-tab-label");
			fireEvent.click(labelSpans[1]);

			// Event should bubble up to the tab div's onClick handler
			expect(onTabClick).toHaveBeenCalledOnce();
			expect(onTabClick).toHaveBeenCalledWith(1);
		});
	});
});
