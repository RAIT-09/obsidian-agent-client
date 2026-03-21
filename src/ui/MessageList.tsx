import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../types/chat";
import type { ITerminalClient } from "../acp/acp-client";
import type AgentClientPlugin from "../plugin";
import type { IChatViewHost } from "./view-host";
import { setIcon } from "obsidian";
import { MessageBubble } from "./MessageBubble";

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
	terminalClient?: ITerminalClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
	/** Whether a permission request is currently pending */
	hasActivePermission: boolean;
}

/**
 * Messages container component for the chat view.
 *
 * Handles:
 * - Message list rendering
 * - Auto-scroll behavior
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
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	}, []);

	/**
	 * Scroll to the bottom of the container.
	 */
	const scrollToBottom = useCallback(() => {
		const container = containerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Reset scroll state when messages are cleared (new chat)
	useEffect(() => {
		if (messages.length === 0) {
			setIsAtBottom(true);
		}
	}, [messages.length]);

	// Auto-scroll when messages change
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			window.setTimeout(() => {
				scrollToBottom();
			}, 0);
		}
	}, [messages, isAtBottom, scrollToBottom]);

	// Set up scroll event listener
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

	return (
		<div ref={containerRef} className="agent-client-chat-view-messages">
			{messages.length === 0 ? (
				<div className="agent-client-chat-empty-state">
					{isRestoringSession
						? "Restoring session..."
						: !isSessionReady
							? `Connecting to ${agentLabel}...`
							: `Start a conversation with ${agentLabel}...`}
				</div>
			) : (
				<>
					{messages.map((message) => (
						<MessageBubble
							key={message.id}
							message={message}
							plugin={plugin}
							terminalClient={terminalClient}
							onApprovePermission={onApprovePermission}
						/>
					))}
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
					{!isAtBottom && (
						<button
							className="agent-client-scroll-to-bottom"
							onClick={() => {
								const container = containerRef.current;
								if (container) {
									container.scrollTo({
										top: container.scrollHeight,
										behavior: "smooth",
									});
								}
							}}
							ref={(el) => {
								if (el) setIcon(el, "chevron-down");
							}}
						/>
					)}
				</>
			)}
		</div>
	);
}
