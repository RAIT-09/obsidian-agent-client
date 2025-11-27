import * as React from "react";
const { useRef, useEffect, useCallback, memo } = React;

import { useMessageVirtualizer } from "../../hooks/useMessageVirtualizer";
import { MessageRenderer } from "./MessageRenderer";

import type { ChatMessage } from "../../../core/domain/models/chat-message";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";

// Minimum messages before enabling virtualization
const VIRTUALIZATION_THRESHOLD = 30;

export interface VirtualMessageListProps {
	messages: ChatMessage[];
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	handlePermissionUseCase: HandlePermissionUseCase;
	containerRef: React.RefObject<HTMLDivElement | null>;
	isAtBottom: boolean;
	onScrollChange: (atBottom: boolean) => void;
	isSending: boolean;
}

/**
 * Virtualized wrapper for a single message.
 * Uses absolute positioning for virtual list layout.
 */
const VirtualMessageItem = memo(function VirtualMessageItem({
	message,
	plugin,
	acpClient,
	handlePermissionUseCase,
	style,
	measureRef,
}: {
	message: ChatMessage;
	plugin: AgentClientPlugin;
	acpClient?: IAcpClient;
	handlePermissionUseCase: HandlePermissionUseCase;
	style: React.CSSProperties;
	measureRef: (node: HTMLElement | null) => void;
}) {
	return (
		<div
			ref={measureRef}
			style={style}
			className="virtual-message-item"
			data-message-id={message.id}
		>
			<MessageRenderer
				message={message}
				plugin={plugin}
				acpClient={acpClient}
				handlePermissionUseCase={handlePermissionUseCase}
			/>
		</div>
	);
});

/**
 * Loading indicator component for when agent is processing.
 */
const LoadingIndicator = memo(function LoadingIndicator() {
	return (
		<div
			className="loading-indicator"
			role="status"
			aria-live="polite"
			aria-label="Agent is processing"
		>
			<span className="sr-only">Agent is processing your request...</span>
			<div className="loading-dots" aria-hidden="true">
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
				<div className="loading-dot"></div>
			</div>
		</div>
	);
});

/**
 * VirtualMessageList - Renders messages with virtual scrolling.
 *
 * For small message counts (< VIRTUALIZATION_THRESHOLD), renders normally.
 * For larger lists, uses virtualization for performance.
 */
export const VirtualMessageList = memo(function VirtualMessageList({
	messages,
	plugin,
	acpClient,
	handlePermissionUseCase,
	containerRef,
	isAtBottom,
	onScrollChange,
	isSending,
}: VirtualMessageListProps) {
	const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastScrollTop = useRef(0);

	// Determine if virtualization should be enabled
	const shouldVirtualize = messages.length >= VIRTUALIZATION_THRESHOLD;

	// Get virtualizer (always called to maintain hook consistency)
	const {
		virtualItems,
		totalSize,
		scrollToIndex,
		measureElement,
		isScrolling,
	} = useMessageVirtualizer({
		messages,
		containerRef,
		overscan: 5,
		enabled: shouldVirtualize,
	});

	// Handle scroll events for atBottom tracking
	const handleScroll = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		// Clear existing timeout
		if (scrollTimeoutRef.current) {
			clearTimeout(scrollTimeoutRef.current);
		}

		// Debounce scroll check
		scrollTimeoutRef.current = setTimeout(() => {
			const threshold = 50;
			const atBottom =
				container.scrollTop + container.clientHeight >=
				container.scrollHeight - threshold;

			if (atBottom !== isAtBottom) {
				onScrollChange(atBottom);
			}

			lastScrollTop.current = container.scrollTop;
		}, 16);
	}, [containerRef, isAtBottom, onScrollChange]);

	// Setup scroll listener
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.addEventListener("scroll", handleScroll, { passive: true });

		return () => {
			container.removeEventListener("scroll", handleScroll);
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
		};
	}, [containerRef, handleScroll]);

	// Auto-scroll to bottom when messages change and at bottom
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			const container = containerRef.current;
			if (container) {
				// Use requestAnimationFrame for smooth scroll
				requestAnimationFrame(() => {
					if (shouldVirtualize) {
						scrollToIndex(messages.length - 1, { align: "end" });
					} else {
						container.scrollTop = container.scrollHeight;
					}
				});
			}
		}
	}, [messages, isAtBottom, shouldVirtualize, scrollToIndex, containerRef]);

	// Render non-virtualized list for small message counts
	if (!shouldVirtualize) {
		return (
			<>
				{messages.map((message) => (
					<MessageRenderer
						key={message.id}
						message={message}
						plugin={plugin}
						acpClient={acpClient}
						handlePermissionUseCase={handlePermissionUseCase}
					/>
				))}
				{isSending && <LoadingIndicator />}
			</>
		);
	}

	// Render virtualized list
	return (
		<div
			className="virtual-list-container"
			style={{
				height: totalSize,
				width: "100%",
				position: "relative",
			}}
		>
			{virtualItems.map((virtualItem) => {
				const message = messages[virtualItem.index];
				return (
					<VirtualMessageItem
						key={message.id}
						message={message}
						plugin={plugin}
						acpClient={acpClient}
						handlePermissionUseCase={handlePermissionUseCase}
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							width: "100%",
							transform: `translateY(${virtualItem.start}px)`,
						}}
						measureRef={measureElement}
					/>
				);
			})}
			{isSending && (
				<div
					style={{
						position: "absolute",
						top: totalSize,
						left: 0,
						width: "100%",
					}}
				>
					<LoadingIndicator />
				</div>
			)}
		</div>
	);
});

export default VirtualMessageList;
