import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "./types";
import { Notice, setIcon } from "obsidian";
import { MessageRenderer } from "./MessageRenderer";
import { ObsidianIcon } from "./ObsidianIcon";
import { getLastAssistantMessage } from "../../shared/session-file-restoration";

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
	view: IChatViewHost;
	/** ACP client for terminal operations */
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (requestId: string, optionId: string) => Promise<void>;
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

	const svgRef = useRef<SVGSVGElement>(null);
	const isSpinning = !isSessionReady || isRestoringSession;
	const prevIsSpinningRef = useRef(isSpinning);
	const [spinState, setSpinState] = useState<'spinning' | 'stopping' | 'stopped'>(
		isSpinning ? 'spinning' : 'stopped'
	);

	useEffect(() => {
		let timeoutId: number;
		const wasSpinning = prevIsSpinningRef.current;
		prevIsSpinningRef.current = isSpinning;

		if (isSpinning) {
			setSpinState('spinning');
			if (svgRef.current) {
				svgRef.current.style.animation = '';
				svgRef.current.style.transition = '';
				svgRef.current.style.transform = '';
			}
		} else if (wasSpinning && !isSpinning) {
			// Just stopped spinning
			setSpinState('stopping');
			if (svgRef.current) {
				const computedStyle = window.getComputedStyle(svgRef.current);
				const matrix = computedStyle.getPropertyValue('transform');
				let currentAngle = 0;
				if (matrix && matrix !== 'none') {
					const values = matrix.split('(')[1].split(')')[0].split(',');
					const a = parseFloat(values[0]);
					const b = parseFloat(values[1]);
					currentAngle = Math.round(Math.atan2(b, a) * (180 / Math.PI));
					if (currentAngle < 0) currentAngle += 360;
				}

				svgRef.current.style.animation = 'none';
				svgRef.current.style.transition = 'none';
				svgRef.current.style.transform = `rotate(${currentAngle}deg)`;

				// Force reflow
				void svgRef.current.getBoundingClientRect();

				// Calculate target angle to ensure a smooth deceleration (at least 180 deg to go)
				let targetAngle = 360;
				if (currentAngle > 180) {
					targetAngle = 720;
				}
				const distance = targetAngle - currentAngle;
				const duration = Math.max(0.8, distance / 260); // Roughly match velocity

				svgRef.current.style.transition = `transform ${duration}s cubic-bezier(0.25, 1, 0.5, 1)`;
				svgRef.current.style.transform = `rotate(${targetAngle}deg)`;

				timeoutId = window.setTimeout(() => {
					setSpinState('stopped');
				}, duration * 1000);
			}
		}
		return () => {
			if (timeoutId) window.clearTimeout(timeoutId);
		};
	}, [isSpinning]);

	/**
	 * Check if the scroll position is near the bottom.
	 */
	const checkIfAtBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return true;

		const threshold = 20;
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
		<div ref={containerRef} className="obsius-chat-view-messages">
			{messages.length === 0 ? (
				<div className="obsius-chat-empty-state">
					<svg
						ref={svgRef}
						className={`obsius-empty-state-icon${spinState === 'spinning' ? " obsius-empty-state-icon--spinning" : ""}`}
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 100 100"
					>
						<defs>
							<mask id="obsius-empty-o-mask">
								<rect width="100" height="100" fill="black" />
								<g transform="rotate(18 50 50)">
									<ellipse cx="50" cy="50" rx="41" ry="34" fill="white" />
								</g>
								<g transform="rotate(-23 47 54)">
									<ellipse cx="47" cy="54" rx="18" ry="13" fill="black" />
								</g>
							</mask>
						</defs>
						<rect
							width="100"
							height="100"
							fill="currentColor"
							mask="url(#obsius-empty-o-mask)"
						/>
					</svg>
					<div className="obsius-empty-state-ready">
						{isSessionReady && !isRestoringSession
							? "We are ready."
							: "just a moment..."}
					</div>
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
						<div className="ac-loading">
							<span className="ac-loading__dot" />
							<span className="ac-loading__dot" />
							<span className="ac-loading__dot" />
						</div>
					)}
					{!isSending && messages.length > 0 && (
						<button
							className="obsius-copy-session-btn"
							title="Copy final output"
							onClick={() => {
								const text = getLastAssistantMessage(messages);
								if (text) {
									void navigator.clipboard.writeText(text);
									new Notice("Copied to clipboard");
								} else {
									new Notice("No assistant message found");
								}
							}}
						>
							<ObsidianIcon name="copy" size={14} />
						</button>
					)}
					{!isAtBottom && (
						<button
							className="obsius-scroll-to-bottom"
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
