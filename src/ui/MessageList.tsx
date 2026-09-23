import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../types/chat";
import type { AcpClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";
import { useVirtualizer } from "@tanstack/react-virtual";

// How long (ms) after a tab is re-shown we refuse to shrink measured item
// sizes. Right after re-show the items briefly re-measure small while their
// markdown re-lays-out; recording those shrinks collapses the virtualizer's
// total size, which clamps scrollTop to 0 and loses the position. Riding out
// this window keeps total stable so the scroll position is preserved. (#321)
const SHOW_SETTLE_MS = 500;

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
	/** Tool call ids whose bodies are expanded */
	expandedToolCalls: ReadonlySet<string>;
	/** Toggle a tool call body */
	onToggleToolCall: (toolCallId: string) => void;
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
	expandedToolCalls,
	onToggleToolCall,
	hasActivePermission,
}: MessageListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const isAtBottomRef = useRef(true);
	const prevIsSendingRef = useRef(false);
	// Last measured height per message id. Used to keep the virtualizer's total
	// size stable while the tab is hidden (display:none) so scrollTop isn't
	// clamped to 0 and the position survives a tab switch. (#321)
	const sizeCacheRef = useRef<Map<string, number>>(new Map());
	// Whether the view was last seen hidden (display:none), and the end of the
	// post-show "settle" window during which we refuse to shrink the size cache
	// (see SHOW_SETTLE_MS). Together these suppress the transient total-size
	// collapse that would otherwise clamp scrollTop to 0 on re-show. (#321)
	const wasHiddenRef = useRef(false);
	const settleUntilRef = useRef(0);

	// ============================================================
	// Virtualizer
	// ============================================================
	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => 80,
		overscan: 5,
		getItemKey: (index) => messages[index]?.id ?? String(index),
		measureElement: (element) => {
			const el = element as HTMLElement;
			const id = el.getAttribute("data-msg-id");
			const cached = id ? sizeCacheRef.current.get(id) : undefined;
			// Hidden (display:none): the item is detached from layout
			// (offsetParent === null) and would measure 0. Remember we were
			// hidden and return the last known size so the total size doesn't
			// collapse on the hidden side. (#321)
			if (el.offsetParent === null) {
				wasHiddenRef.current = true;
				return cached || 80;
			}
			// First measure after re-show: open the settle window. Opening it
			// here (rather than from a separate observer) makes this very call
			// guarded too, regardless of observer firing order. (#321)
			if (wasHiddenRef.current) {
				wasHiddenRef.current = false;
				settleUntilRef.current = performance.now() + SHOW_SETTLE_MS;
			}
			const measured = el.getBoundingClientRect().height;
			// Inside the settle window, never shrink: return the larger of the
			// fresh and cached heights and don't record it, so getTotalSize()
			// stays stable and scrollTop isn't clamped to 0 on re-show. Genuine
			// shrinks are accepted again once the window expires. (#321)
			if (
				cached !== undefined &&
				performance.now() < settleUntilRef.current
			) {
				return Math.max(measured, cached);
			}
			if (id && measured > 0) sizeCacheRef.current.set(id, measured);
			return measured || cached || 80;
		},
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

	// Reset scroll state and drop the per-message size cache when messages are
	// cleared (new chat / restore / fork / restart all funnel through an empty
	// array first). Prevents stale msgId→height entries from accumulating
	// across sessions in this long-lived view. (#321)
	useEffect(() => {
		if (messages.length === 0) {
			setIsAtBottom(true);
			isAtBottomRef.current = true;
			sizeCacheRef.current.clear();
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
			window.requestAnimationFrame(() => {
				virtualizer.scrollToIndex(messages.length - 1, {
					align: "end",
					behavior: "smooth",
				});
			});
			return;
		}

		if (isAtBottomRef.current) {
			// Use requestAnimationFrame to ensure virtualizer has measured
			window.requestAnimationFrame(() => {
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
							data-msg-id={message.id}
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
								expandedToolCalls={expandedToolCalls}
								onToggleToolCall={onToggleToolCall}
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
			{!isAtBottom && (
				<button
					className="agent-client-scroll-to-bottom"
					onClick={() => {
						virtualizer.scrollToIndex(messages.length - 1, {
							align: "end",
							behavior: "smooth",
						});
					}}
					ref={(el) => {
						if (el) setIcon(el, "chevron-down");
					}}
				/>
			)}
		</div>
	);
}
