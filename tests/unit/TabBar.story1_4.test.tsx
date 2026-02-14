import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, fireEvent } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import type { TabInfo } from "../../src/hooks/useTabManager";

/**
 * Tests for User Story 1.4: Close Tab with × Button - TabBar Component
 *
 * Acceptance Criteria:
 * - [x] Each tab displays × button on the right side
 * - [x] Clicking × calls onTabClose with the correct index
 * - [x] Clicking × does not trigger onTabClick (stopPropagation)
 * - [x] × button is not rendered when onTabClose is not provided
 */

function createTab(overrides?: Partial<TabInfo>): TabInfo {
	return {
		tabId: "view-1-tab-0",
		agentId: "claude-code-acp",
		agentLabel: "Claude Code",
		createdAt: new Date(2026, 1, 14, 14, 34, 0),
		...overrides,
	};
}

describe("TabBar - User Story 1.4: Close Tab × Button", () => {
	// ========================================================================
	// AC: Each tab displays × button on the right side
	// ========================================================================
	describe("AC: Each tab displays × close button", () => {
		it("should render a close button for each tab when onTabClose is provided", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
				createTab({ tabId: "view-1-tab-2" }),
			];

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
			expect(closeButtons).toHaveLength(3);
		});

		it("should render close button with × character", () => {
			const tabs = [createTab()];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const closeButton = container.querySelector(
				".agent-client-tab-close",
			);
			expect(closeButton?.textContent).toBe("×");
		});

		it("should render close button with accessible aria-label", () => {
			const tabs = [createTab()];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const closeButton = container.querySelector(
				".agent-client-tab-close",
			);
			expect(closeButton?.getAttribute("aria-label")).toBe("Close tab");
		});

		it("should render close button as a <button> element", () => {
			const tabs = [createTab()];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const closeButton = container.querySelector(
				".agent-client-tab-close",
			);
			expect(closeButton?.tagName).toBe("BUTTON");
		});
	});

	// ========================================================================
	// × button not rendered when onTabClose is not provided (backward compat)
	// ========================================================================
	describe("Backward compatibility: no close button without onTabClose", () => {
		it("should not render close buttons when onTabClose is not provided", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);
			expect(closeButtons).toHaveLength(0);
		});
	});

	// ========================================================================
	// AC: Clicking × calls onTabClose with the correct index
	// ========================================================================
	describe("AC: Clicking × calls onTabClose with correct index", () => {
		it("should call onTabClose with index 0 when clicking the first tab's close button", () => {
			const onTabClose = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={onTabClose}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);
			fireEvent.click(closeButtons[0]);

			expect(onTabClose).toHaveBeenCalledOnce();
			expect(onTabClose).toHaveBeenCalledWith(0);
		});

		it("should call onTabClose with index 1 when clicking the second tab's close button", () => {
			const onTabClose = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={onTabClose}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);
			fireEvent.click(closeButtons[1]);

			expect(onTabClose).toHaveBeenCalledOnce();
			expect(onTabClose).toHaveBeenCalledWith(1);
		});

		it("should call onTabClose with correct index for each tab in a 5-tab bar", () => {
			const onTabClose = vi.fn();
			const tabs = Array.from({ length: 5 }, (_, i) =>
				createTab({
					tabId: `view-1-tab-${i}`,
					createdAt: new Date(2026, 1, 14, 10 + i, 0, 0),
				}),
			);

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={onTabClose}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);

			fireEvent.click(closeButtons[3]);
			expect(onTabClose).toHaveBeenLastCalledWith(3);

			fireEvent.click(closeButtons[4]);
			expect(onTabClose).toHaveBeenLastCalledWith(4);

			expect(onTabClose).toHaveBeenCalledTimes(2);
		});
	});

	// ========================================================================
	// AC: Clicking × does NOT trigger onTabClick (stopPropagation)
	// ========================================================================
	describe("AC: Clicking × does not trigger onTabClick", () => {
		it("should not call onTabClick when clicking the close button", () => {
			const onTabClick = vi.fn();
			const onTabClose = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={onTabClick}
					onTabClose={onTabClose}
				/>,
			);

			const closeButtons = container.querySelectorAll(
				".agent-client-tab-close",
			);
			fireEvent.click(closeButtons[1]);

			// onTabClose should be called
			expect(onTabClose).toHaveBeenCalledOnce();
			// onTabClick should NOT be called (stopPropagation)
			expect(onTabClick).not.toHaveBeenCalled();
		});

		it("should still allow clicking the tab label after close button exists", () => {
			const onTabClick = vi.fn();
			const onTabClose = vi.fn();
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={onTabClick}
					onTabClose={onTabClose}
				/>,
			);

			// Click the tab itself (not the close button)
			const tabElements = container.querySelectorAll(".agent-client-tab");
			fireEvent.click(tabElements[1]);

			expect(onTabClick).toHaveBeenCalledOnce();
			expect(onTabClick).toHaveBeenCalledWith(1);
			// onTabClose should NOT be called
			expect(onTabClose).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Close button renders for both active and non-active tabs
	// ========================================================================
	describe("Close button renders for both active and non-active tabs", () => {
		it("should have a close button on the active tab", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const activeTab = container.querySelector(
				".agent-client-tab-active",
			);
			const closeButton = activeTab?.querySelector(
				".agent-client-tab-close",
			);
			expect(closeButton).not.toBeNull();
		});

		it("should have a close button on non-active tabs", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container } = render(
				<TabBar
					tabs={tabs}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					onTabClose={vi.fn()}
				/>,
			);

			const allTabs = container.querySelectorAll(".agent-client-tab");
			const nonActiveTab = allTabs[1]; // index 1 is not active
			const closeButton = nonActiveTab.querySelector(
				".agent-client-tab-close",
			);
			expect(closeButton).not.toBeNull();
		});
	});
});
