import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useRef, useEffect } from "react";
import type { ChatMessage, MessageContent } from "../../core/domain/models/chat-message";

/**
 * Height estimation for different message content types.
 * These are approximations that get refined after measurement.
 */
const HEIGHT_ESTIMATES = {
	// Base message padding/margin
	messageBase: 24,
	// Content type heights
	text: 60,
	textWithContext: 80,
	agentThought: 80,
	image: 200,
	toolCall: 120,
	plan: 100,
	permissionRequest: 150,
	terminal: 100,
	// Per-line text height
	lineHeight: 22,
	// Per plan entry
	planEntryHeight: 28,
	// Per tool call content item
	toolCallContentHeight: 40,
} as const;

/**
 * Estimate the height of a message content item.
 */
function estimateContentHeight(content: MessageContent): number {
	switch (content.type) {
		case "text":
			// Estimate based on text length
			const textLines = Math.ceil((content.text?.length || 0) / 80);
			return HEIGHT_ESTIMATES.text + textLines * HEIGHT_ESTIMATES.lineHeight;

		case "text_with_context":
			const contextLines = Math.ceil((content.text?.length || 0) / 80);
			return HEIGHT_ESTIMATES.textWithContext + contextLines * HEIGHT_ESTIMATES.lineHeight;

		case "agent_thought":
			const thoughtLines = Math.ceil((content.text?.length || 0) / 80);
			return HEIGHT_ESTIMATES.agentThought + thoughtLines * HEIGHT_ESTIMATES.lineHeight;

		case "image":
			return HEIGHT_ESTIMATES.image;

		case "tool_call":
			let toolHeight = HEIGHT_ESTIMATES.toolCall;
			// Add height for content items (diff, terminal, etc.)
			if (content.content && Array.isArray(content.content)) {
				toolHeight += content.content.length * HEIGHT_ESTIMATES.toolCallContentHeight;
			}
			// Add height for permission request
			if (content.permissionRequest?.isActive) {
				toolHeight += HEIGHT_ESTIMATES.permissionRequest;
			}
			return toolHeight;

		case "plan":
			const entryCount = content.entries?.length || 0;
			return HEIGHT_ESTIMATES.plan + entryCount * HEIGHT_ESTIMATES.planEntryHeight;

		case "permission_request":
			return HEIGHT_ESTIMATES.permissionRequest;

		case "terminal":
			return HEIGHT_ESTIMATES.terminal;

		default:
			return HEIGHT_ESTIMATES.text;
	}
}

/**
 * Estimate the total height of a message.
 */
function estimateMessageHeight(message: ChatMessage): number {
	let height = HEIGHT_ESTIMATES.messageBase;

	for (const content of message.content) {
		height += estimateContentHeight(content);
	}

	// Minimum height to prevent collapse
	return Math.max(height, 50);
}

export interface UseMessageVirtualizerOptions {
	messages: ChatMessage[];
	containerRef: React.RefObject<HTMLDivElement | null>;
	overscan?: number;
	enabled?: boolean;
}

export interface UseMessageVirtualizerResult {
	virtualItems: VirtualItem[];
	totalSize: number;
	scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
	scrollToOffset: (offset: number) => void;
	measureElement: (element: HTMLElement | null) => void;
	isScrolling: boolean;
}

/**
 * Custom hook for virtualizing the message list.
 * Handles dynamic row heights and scroll management.
 */
export function useMessageVirtualizer({
	messages,
	containerRef,
	overscan = 5,
	enabled = true,
}: UseMessageVirtualizerOptions): UseMessageVirtualizerResult {
	// Track scroll restoration
	const lastScrollOffset = useRef(0);
	const shouldRestoreScroll = useRef(false);

	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => containerRef.current,
		estimateSize: (index) => estimateMessageHeight(messages[index]),
		overscan,
		// Enable dynamic measurement
		measureElement: (element) => element?.getBoundingClientRect().height ?? 0,
		// Smooth scrolling for better UX
		scrollMargin: 0,
	});

	// Scroll to bottom when new messages arrive (if at bottom)
	const scrollToBottom = useCallback(() => {
		if (messages.length > 0) {
			virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
		}
	}, [messages.length, virtualizer]);

	// Track scrolling state for auto-scroll behavior
	const isScrolling = virtualizer.isScrolling;

	// Save scroll position before updates
	useEffect(() => {
		const container = containerRef.current;
		if (container) {
			lastScrollOffset.current = container.scrollTop;
		}
	}, [messages.length, containerRef]);

	return {
		virtualItems: virtualizer.getVirtualItems(),
		totalSize: virtualizer.getTotalSize(),
		scrollToIndex: virtualizer.scrollToIndex,
		scrollToOffset: virtualizer.scrollToOffset,
		measureElement: virtualizer.measureElement,
		isScrolling,
	};
}

export { estimateMessageHeight };
