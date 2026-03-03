import * as React from "react";
const { useRef, useState, useEffect, useCallback, useId, useMemo } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "./types";
import { Notice, setIcon } from "obsidian";
import { MessageRenderer } from "./MessageRenderer";
import { ObsidianIcon } from "./ObsidianIcon";
import { getLastAssistantMessage } from "../../application/services/session-restore";

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
	/** Agent client for terminal operations */
	agentClient?: IAgentClient;
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
	agentClient,
	onApprovePermission,
}: ChatMessagesProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const emptyStateMaskId = useId().replace(/:/g, "-");

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
				const style = svgRef.current.style;
				style.removeProperty("animation");
				style.removeProperty("transition");
				style.removeProperty("transform");
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

				const style = svgRef.current.style;
				style.setProperty("animation", "none");
				style.setProperty("transition", "none");
				style.setProperty("transform", `rotate(${currentAngle}deg)`);

				// Force reflow
				void svgRef.current.getBoundingClientRect();

				// Calculate target angle to ensure a smooth deceleration (at least 180 deg to go)
				let targetAngle = 360;
				if (currentAngle > 180) {
					targetAngle = 720;
				}
				const distance = targetAngle - currentAngle;
				const duration = Math.max(0.8, distance / 260); // Roughly match velocity

				style.setProperty("transition", `transform ${duration}s cubic-bezier(0.25, 1, 0.5, 1)`);
				style.setProperty("transform", `rotate(${targetAngle}deg)`);

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

	const latestRunningToolCall = useMemo(() => {
		for (let m = messages.length - 1; m >= 0; m--) {
			const message = messages[m];
			for (let c = message.content.length - 1; c >= 0; c--) {
				const content = message.content[c];
				if (
					content.type === "tool_call" &&
					(content.status === "pending" || content.status === "in_progress")
				) {
					const normalized = (content.title ?? "")
						.replace(/[\s_-]+/g, "")
						.toLowerCase();
					const isFileEdit =
						content.kind === "edit" ||
						/write|createfile|editfile|applypatch|applydiff|replaceinfile/.test(
							normalized,
						);
					return {
						messageId: message.id,
						contentIndex: c,
						isFileEdit,
					};
				}
			}
		}
		return null;
	}, [messages]);

	const latestRunningToolCallTarget =
		latestRunningToolCall && !latestRunningToolCall.isFileEdit
			? latestRunningToolCall
			: null;
	const showInlineToolCallIndicator = isSending && !!latestRunningToolCallTarget;
	const hasRunningFileEditTool = isSending && !!latestRunningToolCall?.isFileEdit;

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
							<mask id={emptyStateMaskId}>
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
							mask={`url(#${emptyStateMaskId})`}
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
							agentClient={agentClient}
							onApprovePermission={onApprovePermission}
							activeSendingToolCallTarget={showInlineToolCallIndicator ? latestRunningToolCallTarget : null}
						/>
					))}
					{isSending && !showInlineToolCallIndicator && !hasRunningFileEditTool && (
						<div className="ac-loading">
							<svg className="ac-loading__spinner" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
								<line className="ac-sq-line-0" x1="15" y1="15" x2="85" y2="15" />
								<line className="ac-sq-line-1" x1="85" y1="15" x2="85" y2="85" />
								<line className="ac-sq-line-2" x1="85" y1="85" x2="15" y2="85" />
								<line className="ac-sq-line-3" x1="15" y1="85" x2="15" y2="15" />
								<circle className="ac-sq-dot-0" r="6" cx="15" cy="15" />
								<circle className="ac-sq-dot-1" r="6" cx="85" cy="15" />
								<circle className="ac-sq-dot-2" r="6" cx="85" cy="85" />
								<circle className="ac-sq-dot-3" r="6" cx="15" cy="85" />
							</svg>
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
