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
	/** Whether this tab is currently active (visible) */
	isActive?: boolean;
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
	isActive = true,
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

	// Suppress scroll position correction on hidden tabs and when user
	// has scrolled up. Without the isActive check, the virtualizer
	// adjusts its internal offset during measurement of collapsed
	// containers, corrupting the saved position.
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () =>
		isActive && isAtBottomRef.current;

	// ============================================================
	// Scroll management
	// ============================================================

	/**
	 * Check if the scroll position is near the bottom.
	 * Skips when the container is collapsed (display:none) to avoid
	 * corrupting isAtBottomRef — a zero-height container always
	 * satisfies the "near bottom" check (0 + 0 >= 0 - threshold).
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

	// Ref for virtualizer — avoids putting the virtualizer object
	// (new every render) in effect dependency arrays.
	const virtualizerRef = useRef(virtualizer);
	virtualizerRef.current = virtualizer;

	const prevIsActiveRef = useRef(isActive);
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		view.registerDomEvent(container, "scroll", checkIfAtBottom);
		checkIfAtBottom();
	}, [view, checkIfAtBottom]);

	// Scroll to bottom when the panel becomes visible again (e.g. user
	// clicked away to another Obsidian pane and came back). The tab-switch
	// logic (wasInactive) doesn't cover this because isActive tracks which
	// tab is selected, not whether the leaf is on-screen. (I25)
	const wasVisibleRef = useRef(true);
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				const visible = entry.isIntersecting;
				if (visible && !wasVisibleRef.current && isActive && messages.length > 0) {
					requestAnimationFrame(() => {
						virtualizerRef.current.scrollToIndex(
							messages.length - 1,
							{ align: "end" },
						);
					});
				}
				wasVisibleRef.current = visible;
			},
			{ threshold: 0.1 },
		);
		observer.observe(container);
		return () => observer.disconnect();
	}, [isActive, messages.length]);

	// Scroll to bottom on new messages and on tab switch.
	// Streaming scroll is handled by shouldAdjustScrollPositionOnItemSizeChange.
	useEffect(() => {
		const wasInactive = !prevIsActiveRef.current;
		prevIsActiveRef.current = isActive;

		if (!isActive || messages.length === 0) return;

		if (wasInactive) {
			// Tab became active — always go to bottom
			requestAnimationFrame(() => {
				virtualizerRef.current.scrollToIndex(
					messages.length - 1,
					{ align: "end" },
				);
			});
			return;
		}

		// New message: auto-scroll if pinned to bottom
		if (scrollSmoothRef.current) {
			scrollSmoothRef.current = false;
			requestAnimationFrame(() => {
				virtualizerRef.current.scrollToIndex(
					messages.length - 1,
					{ align: "end", behavior: "smooth" },
				);
			});
			return;
		}

		if (isAtBottomRef.current) {
			requestAnimationFrame(() => {
				virtualizerRef.current.scrollToIndex(
					messages.length - 1,
					{ align: "end" },
				);
			});
		}
	}, [messages, messages.length, isActive]);

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