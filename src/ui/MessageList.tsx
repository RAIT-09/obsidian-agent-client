import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Props for MessageList component
 */
export interface MessageListProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: IChatViewHost;
	/** Terminal client for output polling */
	terminalClient?: AcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	/** Whether a permission request is currently pending */
	hasActivePermission: boolean;
}

/**
 * Messages container component with virtualized rendering.
 *
 * Uses @tanstack/react-virtual to only render messages visible in the viewport,
 * dramatically improving performance for long conversations.
 *
 * Handles:
 * - Virtualized message list rendering
 * - Auto-scroll behavior (follows new content when at bottom)
 * - Empty state display
 * - Loading indicator
 */
export function MessageList({
	messages,
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	plugin,
	view,
	terminalClient,
	onApprovePermission,
	hasActivePermission,
}: MessageListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const isAtBottomRef = useRef(true);
	const prevIsSendingRef = useRef(false);

	// ============================================================
	// Virtualizer
	// ============================================================
	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => 80,
		overscan: 5,
	});

	// Suppress scroll position correction when user has scrolled up.
	// By default, the virtualizer adjusts scrollTop when an item before
	// the scroll offset changes size (to keep visible content stable).
	// During streaming, this causes the viewport to creep down as the
	// last message grows. Our auto-scroll effect handles following new
	// content when isAtBottom, so corrections are only needed there.
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () =>
		isAtBottomRef.current;

	// ============================================================
	// Scroll management
	// ============================================================

	/**
	 * Check if the scroll position is near the bottom.
	 */
	const checkIfAtBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return true;

		const threshold = 35;
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		isAtBottomRef.current = isNearBottom;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	}, []);

	// Reset scroll state when messages are cleared (new chat)
	useEffect(() => {
		if (messages.length === 0) {
			setIsAtBottom(true);
			isAtBottomRef.current = true;
		}
	}, [messages.length]);

	// Track when user just sent a message (for smooth scroll)
	const scrollSmoothRef = useRef(false);
	useEffect(() => {
		if (isSending && !prevIsSendingRef.current) {
			// User just sent a message — next scroll should be smooth
			scrollSmoothRef.current = true;
		}
		prevIsSendingRef.current = isSending;
	}, [isSending]);

	// Auto-scroll to bottom when new messages arrive or content changes
	useEffect(() => {
		if (messages.length === 0) return;

		if (scrollSmoothRef.current) {
			// User sent a message — smooth scroll regardless of isAtBottom
			scrollSmoothRef.current = false;
			requestAnimationFrame(() => {
				virtualizer.scrollToIndex(messages.length - 1, {
					align: "end",
					behavior: "smooth",
				});
			});
			return;
		}

		if (isAtBottomRef.current) {
			// Use requestAnimationFrame to ensure virtualizer has measured
			requestAnimationFrame(() => {
				virtualizer.scrollToIndex(messages.length - 1, {
					align: "end",
				});
			});
		}
	}, [messages, virtualizer]);

	// Set up scroll event listener for isAtBottom detection
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleScroll = () => {
			checkIfAtBottom();
		};

		view.registerDomEvent(container, "scroll", handleScroll);

		// Initial check
		checkIfAtBottom();
	}, [view, checkIfAtBottom]);

	// Scroll to bottom when tab becomes visible (display:none → display:flex).
	// The tab panel sets display:none on inactive tabs, which collapses the
	// container to zero height. When the tab becomes active again, the
	// ResizeObserver fires and we scroll to the latest content.
	const wasHiddenRef = useRef(false);
	const savedScrollTopRef = useRef<number | null>(null);
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const height = entry.contentRect.height;
			if (height === 0) {
				// Tab becoming hidden — save scroll position
				savedScrollTopRef.current = container.scrollTop;
				wasHiddenRef.current = true;
			} else if (wasHiddenRef.current) {
				wasHiddenRef.current = false;
				if (messages.length > 0) {
					if (isAtBottomRef.current) {
						// Was at bottom — scroll to latest content
						virtualizer.scrollToIndex(messages.length - 1, {
							align: "end",
						});
					} else if (savedScrollTopRef.current !== null) {
						// Was manually scrolled up — restore position
						requestAnimationFrame(() => {
							container.scrollTop = savedScrollTopRef.current!;
						});
					}
				}
				savedScrollTopRef.current = null;
			}
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, [messages.length, virtualizer]);

	// ============================================================
	// Render
	// ============================================================

	// Empty state
	if (messages.length === 0) {
		return (
			<div ref={containerRef} className="agent-client-chat-view-messages">
				<div className="agent-client-chat-empty-state">
					{isRestoringSession
						? "Restoring session..."
						: !isSessionReady
							? `Connecting to ${agentLabel}...`
							: `Start a conversation with ${agentLabel}...`}
				</div>
			</div>
		);
	}

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div ref={containerRef} className="agent-client-chat-view-messages">
			{/* Virtualized message list */}
			<div
				className="agent-client-virtual-list-inner"
				style={{
					height: virtualizer.getTotalSize(),
					position: "relative",
				}}
			>
				{virtualItems.map((virtualItem) => {
					const message = messages[virtualItem.index];
					return (
						<div
							key={message.id}
							ref={virtualizer.measureElement}
							data-index={virtualItem.index}
							className="agent-client-virtual-item"
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${virtualItem.start}px)`,
							}}
						>
							<MessageBubble
								message={message}
								plugin={plugin}
								terminalClient={terminalClient}
								onApprovePermission={onApprovePermission}
							/>
						</div>
					);
				})}
			</div>

			{/* Loading indicator — outside virtualizer */}
			<div
				className={`agent-client-loading-indicator ${!isSending ? "agent-client-hidden" : ""}`}
			>
				<div className="agent-client-loading-dots">
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
					<div className="agent-client-loading-dot"></div>
				</div>
				{hasActivePermission && (
					<span className="agent-client-loading-status">
						Waiting for permission...
					</span>
				)}
			</div>

			{/* Scroll to bottom button */}
			{!isAtBottom && <ScrollToBottomButton virtualizer={virtualizer} messageCount={messages.length} />}
		</div>
	);
}

/**
 * Extracted scroll-to-bottom button with a stable ref for setIcon.
 * Avoids the inline callback ref cycling that swallows click events (same fix as I7).
 */
function ScrollToBottomButton({
	virtualizer,
	messageCount,
}: {
	virtualizer: ReturnType<typeof useVirtualizer>;
	messageCount: number;
}) {
	const btnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (btnRef.current) {
			setIcon(btnRef.current, "chevron-down");
		}
	}, []);

	return (
		<button
			ref={btnRef}
			className="agent-client-scroll-to-bottom"
			onClick={() => {
				virtualizer.scrollToIndex(messageCount - 1, {
					align: "end",
					behavior: "smooth",
				});
			}}
		/>
	);
}