import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { ChatHeader } from "../../src/components/chat/ChatHeader";

describe("ChatHeader", () => {
	const defaultProps = {
		tabBar: <div data-testid="mock-tab-bar">Mock TabBar</div>,
		isUpdateAvailable: false,
		hasHistoryCapability: false,
		onNewChat: vi.fn(),
		onExportChat: vi.fn(),
		onToggleMenu: vi.fn(),
		menuButtonRef: { current: null } as React.RefObject<HTMLButtonElement | null>,
	};

	describe("AC: Tab bar renders in header", () => {
		it("should render the tabBar ReactNode in the header-main section", () => {
			const { container } = render(<ChatHeader {...defaultProps} />);
			const headerMain = container.querySelector(
				".agent-client-chat-view-header-main",
			);
			expect(headerMain).not.toBeNull();
			expect(screen.getByTestId("mock-tab-bar")).toBeDefined();
			// Verify it's inside the header-main
			expect(
				headerMain?.querySelector("[data-testid='mock-tab-bar']"),
			).not.toBeNull();
		});

		it("should not render the old agent label h3", () => {
			const { container } = render(<ChatHeader {...defaultProps} />);
			const h3 = container.querySelector(
				".agent-client-chat-view-header-title",
			);
			expect(h3).toBeNull();
		});
	});

	describe("AC: Existing chat functionality works as before", () => {
		it("should render action buttons", () => {
			const { container } = render(<ChatHeader {...defaultProps} />);
			const buttons = container.querySelectorAll(
				".agent-client-header-button",
			);
			// Without history: plus, save, more-vertical = 3 buttons
			expect(buttons.length).toBe(3);
		});

		it("should render 4 buttons when hasHistoryCapability is true", () => {
			const { container } = render(
				<ChatHeader
					{...defaultProps}
					hasHistoryCapability={true}
					onOpenHistory={vi.fn()}
				/>,
			);
			const buttons = container.querySelectorAll(
				".agent-client-header-button",
			);
			// With history: plus, history, save, more-vertical = 4 buttons
			expect(buttons.length).toBe(4);
		});

		it("should show update notification when isUpdateAvailable is true", () => {
			const { container } = render(
				<ChatHeader {...defaultProps} isUpdateAvailable={true} />,
			);
			const update = container.querySelector(
				".agent-client-chat-view-header-update",
			);
			expect(update).not.toBeNull();
		});

		it("should not show update notification when isUpdateAvailable is false", () => {
			const { container } = render(<ChatHeader {...defaultProps} />);
			const update = container.querySelector(
				".agent-client-chat-view-header-update",
			);
			expect(update).toBeNull();
		});

		it("should call onNewChat when plus button is clicked", () => {
			const onNewChat = vi.fn();
			const { container } = render(
				<ChatHeader {...defaultProps} onNewChat={onNewChat} />,
			);
			const buttons = container.querySelectorAll(
				".agent-client-header-button",
			);
			// First button is "plus" (New chat)
			buttons[0].click();
			expect(onNewChat).toHaveBeenCalledOnce();
		});
	});
});
