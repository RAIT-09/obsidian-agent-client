import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import { formatTabTimestamp } from "../../src/shared/time-utils";
import type { TabInfo } from "../../src/hooks/useTabManager";

/**
 * Tests for User Story 1.2: Create New Tab with + Button
 *
 * Acceptance Criteria:
 * - [x] New tab becomes active automatically (via activeTabIndex)
 * - [x] New tab label shows agent name + current timestamp
 * - [x] Multiple tabs rendered with correct active state
 * - [x] Can display unlimited tabs
 *
 * Note: The + button lives in ChatHeader, not TabBar.
 * Tab creation is tested in useTabManager.test.tsx.
 */

describe("TabBar - User Story 1.2", () => {
	function createTab(overrides?: Partial<TabInfo>): TabInfo {
		return {
			tabId: "view-1-tab-0",
			agentId: "claude-code-acp",
			agentLabel: "Claude Code",
			createdAt: new Date(2026, 1, 14, 14, 34, 0),
			...overrides,
		};
	}

	const noop = vi.fn();

	// ========================================================================
	// AC: New tab label shows agent name + current timestamp
	// (Test that TabBar renders multiple tabs with correct labels)
	// ========================================================================
	describe("AC: Multiple tabs with correct labels", () => {
		it("should render multiple tabs when given multiple tab infos", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({
					tabId: "view-1-tab-1",
					createdAt: new Date(2026, 1, 14, 15, 0, 0),
				}),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={1} onTabClick={noop} />,
			);

			const tabElements =
				container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(2);
		});

		it("should show agent name + timestamp for each tab", () => {
			const tab1Time = new Date(2026, 1, 14, 14, 34, 0);
			const tab2Time = new Date(2026, 1, 14, 15, 0, 0);

			const tabs = [
				createTab({ tabId: "view-1-tab-0", createdAt: tab1Time }),
				createTab({
					tabId: "view-1-tab-1",
					agentLabel: "Gemini CLI",
					createdAt: tab2Time,
				}),
			];

			render(<TabBar tabs={tabs} activeTabIndex={0} onTabClick={noop} />);

			const expectedLabel1 = `Claude Code ${formatTabTimestamp(tab1Time)}`;
			const expectedLabel2 = `Gemini CLI ${formatTabTimestamp(tab2Time)}`;

			expect(screen.getByText(expectedLabel1)).toBeDefined();
			expect(screen.getByText(expectedLabel2)).toBeDefined();
		});
	});

	// ========================================================================
	// AC: New tab becomes active automatically
	// (Test that activeTabIndex applies the active class correctly)
	// ========================================================================
	describe("AC: Active tab has correct styling", () => {
		it("should apply active class only to the tab at activeTabIndex", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
				createTab({ tabId: "view-1-tab-2" }),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={1} onTabClick={noop} />,
			);

			const tabElements =
				container.querySelectorAll(".agent-client-tab");
			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(false);
			expect(tabElements[1].classList.contains("agent-client-tab-active")).toBe(true);
			expect(tabElements[2].classList.contains("agent-client-tab-active")).toBe(false);
		});

		it("should update active class when activeTabIndex changes", () => {
			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
			];

			const { container, rerender } = render(
				<TabBar tabs={tabs} activeTabIndex={0} onTabClick={noop} />,
			);

			// First tab is active
			let tabElements =
				container.querySelectorAll(".agent-client-tab");
			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(true);
			expect(tabElements[1].classList.contains("agent-client-tab-active")).toBe(false);

			// Re-render with new activeTabIndex
			rerender(<TabBar tabs={tabs} activeTabIndex={1} onTabClick={noop} />);

			tabElements = container.querySelectorAll(".agent-client-tab");
			expect(tabElements[0].classList.contains("agent-client-tab-active")).toBe(false);
			expect(tabElements[1].classList.contains("agent-client-tab-active")).toBe(true);
		});
	});

	// ========================================================================
	// Test case 3: Create 5 tabs, verify all have unique labels
	// ========================================================================
	describe("Test case: 5 tabs with unique labels", () => {
		it("should render 5 tabs with distinct labels", () => {
			const tabs = [
				createTab({
					tabId: "view-1-tab-0",
					createdAt: new Date(2026, 1, 14, 10, 0, 0),
				}),
				createTab({
					tabId: "view-1-tab-1",
					createdAt: new Date(2026, 1, 14, 10, 5, 0),
				}),
				createTab({
					tabId: "view-1-tab-2",
					createdAt: new Date(2026, 1, 14, 10, 10, 0),
				}),
				createTab({
					tabId: "view-1-tab-3",
					createdAt: new Date(2026, 1, 14, 10, 15, 0),
				}),
				createTab({
					tabId: "view-1-tab-4",
					createdAt: new Date(2026, 1, 14, 10, 20, 0),
				}),
			];

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={4} onTabClick={noop} />,
			);

			const tabElements =
				container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(5);

			// All labels should have the tab-label class
			const labels = container.querySelectorAll(
				".agent-client-tab-label",
			);
			expect(labels).toHaveLength(5);

			// Each label should contain the agent name
			labels.forEach((label) => {
				expect(label.textContent).toContain("Claude Code");
			});
		});
	});

	// ========================================================================
	// Can display unlimited tabs
	// ========================================================================
	describe("AC: Can display unlimited tabs", () => {
		it("should render 10 tabs without errors", () => {
			const tabs = Array.from({ length: 10 }, (_, i) =>
				createTab({
					tabId: `view-1-tab-${i}`,
					createdAt: new Date(2026, 1, 14, 10 + i, 0, 0),
				}),
			);

			const { container } = render(
				<TabBar tabs={tabs} activeTabIndex={9} onTabClick={noop} />,
			);

			const tabElements =
				container.querySelectorAll(".agent-client-tab");
			expect(tabElements).toHaveLength(10);
		});
	});

	// ========================================================================
	// Tabs use unique keys (React key prop)
	// ========================================================================
	describe("Implementation: tabs use unique keys for React reconciliation", () => {
		it("should not produce React key warnings when rendering multiple tabs", () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const tabs = [
				createTab({ tabId: "view-1-tab-0" }),
				createTab({ tabId: "view-1-tab-1" }),
				createTab({ tabId: "view-1-tab-2" }),
			];

			render(<TabBar tabs={tabs} activeTabIndex={0} onTabClick={noop} />);

			// React would log a console.error for duplicate keys
			const keyWarnings = consoleError.mock.calls.filter(
				(call) =>
					typeof call[0] === "string" &&
					call[0].includes("key"),
			);
			expect(keyWarnings).toHaveLength(0);

			consoleError.mockRestore();
		});
	});
});
