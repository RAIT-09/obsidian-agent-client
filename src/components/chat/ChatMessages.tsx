import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import { MessageRenderer } from "./MessageRenderer";

/**
 * Props for ChatMessages component
 */
export interface ChatMessagesProps {
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
	view: ChatView;
	/** ACP client for terminal operations */
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
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
export function ChatMessages({
	messages,
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	plugin,
	view,
	acpClient,
	onApprovePermission,
}: ChatMessagesProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	/**
	 * Check if the scroll position is near the bottom.
	 */
	const checkIfAtBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return true;

		const threshold = 50;
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
						<MessageRenderer
							key={message.id}
							message={message}
							plugin={plugin}
							acpClient={acpClient}
							onApprovePermission={onApprovePermission}
						/>
					))}
					{isSending && (
						<div className="agent-client-loading-indicator">
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
						</div>
					)}
				</>
			)}
		</div>
	);
}
