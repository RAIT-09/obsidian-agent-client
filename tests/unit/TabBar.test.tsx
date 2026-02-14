import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { TabBar } from "../../src/components/chat/TabBar";
import { formatTabTimestamp } from "../../src/shared/time-utils";
import type { TabInfo } from "../../src/hooks/useTabManager";

describe("TabBar", () => {
	const defaultTab: TabInfo = {
		tabId: "view-1-tab-0",
		agentId: "claude-code-acp",
		agentLabel: "Claude Code",
		createdAt: new Date(2026, 1, 14, 14, 34, 0), // Feb 14, 2026 2:34 PM
	};

	const defaultProps = {
		tabs: [defaultTab],
		activeTabIndex: 0,
		onTabClick: vi.fn(),
	};

	describe("AC: When plugin loads, ChatView displays exactly one tab", () => {
		it("should render a single tab element", () => {
			const { container } = render(<TabBar {...defaultProps} />);
			const tabs = container.querySelectorAll(".agent-client-tab");
			expect(tabs).toHaveLength(1);
		});

		it("should render the tab bar container", () => {
			const { container } = render(<TabBar {...defaultProps} />);
			const tabBar = container.querySelector(".agent-client-tab-bar");
			expect(tabBar).not.toBeNull();
		});

		it("should have the active class on the tab", () => {
			const { container } = render(<TabBar {...defaultProps} />);
			const tab = container.querySelector(".agent-client-tab");
			expect(tab?.classList.contains("agent-client-tab-active")).toBe(
				true,
			);
		});
	});

	describe("AC: Tab shows agent name + timestamp", () => {
		it("should display agent label and formatted timestamp in the tab label", () => {
			render(<TabBar {...defaultProps} />);
			const expectedTimestamp = formatTabTimestamp(
				defaultTab.createdAt,
			);
			const expectedLabel = `Claude Code ${expectedTimestamp}`;
			expect(screen.getByText(expectedLabel)).toBeDefined();
		});

		it("should render the label inside a span with the correct class", () => {
			const { container } = render(<TabBar {...defaultProps} />);
			const labelSpan = container.querySelector(
				".agent-client-tab-label",
			);
			expect(labelSpan).not.toBeNull();
			const expectedTimestamp = formatTabTimestamp(
				defaultTab.createdAt,
			);
			expect(labelSpan?.textContent).toBe(
				`Claude Code ${expectedTimestamp}`,
			);
		});

		it("should display different agent names correctly", () => {
			const geminiTab: TabInfo = {
				tabId: "view-1-tab-1",
				agentId: "gemini-cli",
				agentLabel: "Gemini CLI",
				createdAt: new Date(),
			};
			render(
				<TabBar
					tabs={[geminiTab]}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					/>,
			);
			const label = screen.getByText(/Gemini CLI/);
			expect(label).toBeDefined();
		});

		it("should display different timestamps correctly", () => {
			const morning = new Date(2026, 0, 1, 9, 5, 0);
			const morningTab: TabInfo = {
				tabId: "view-1-tab-0",
				agentId: "claude-code-acp",
				agentLabel: "Claude Code",
				createdAt: morning,
			};
			const { container } = render(
				<TabBar
					tabs={[morningTab]}
					activeTabIndex={0}
					onTabClick={vi.fn()}
					/>,
			);
			const labelSpan = container.querySelector(
				".agent-client-tab-label",
			);
			const expectedTimestamp = formatTabTimestamp(morning);
			expect(labelSpan?.textContent).toBe(
				`Claude Code ${expectedTimestamp}`,
			);
		});
	});
});
