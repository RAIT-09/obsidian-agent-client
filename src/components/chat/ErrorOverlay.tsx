import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type { ErrorInfo } from "../../domain/models/agent-error";
import type { ChatView } from "./ChatView";

export interface ErrorOverlayProps {
	/** Error information to display */
	errorInfo: ErrorInfo;
	/** Callback to close/clear the error */
	onClose: () => void;
	/** Whether to show emojis */
	showEmojis: boolean;
	/** View instance for event registration */
	view: ChatView;
}

/**
 * Error overlay component displayed above the input field.
 *
 * Design decisions:
 * - Uses same positioning pattern as SuggestionDropdown (position: absolute; bottom: 100%)
 * - Closes on outside click (consistent with SuggestionDropdown)
 * - Closes on Escape key (consistent with HeaderMenu)
 * - Does not block chat messages from being visible
 */
export function ErrorOverlay({
	errorInfo,
	onClose,
	showEmojis,
	view,
}: ErrorOverlayProps) {
	const overlayRef = useRef<HTMLDivElement>(null);

	// Handle outside click to close
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				overlayRef.current &&
				!overlayRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		};

		view.registerDomEvent(document, "mousedown", handleClickOutside);
	}, [onClose, view]);

	// Handle Escape key to close
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
				event.preventDefault();
			}
		};

		view.registerDomEvent(document, "keydown", handleKeyDown);
	}, [onClose, view]);

	return (
		<div ref={overlayRef} className="agent-client-error-overlay">
			<div className="agent-client-error-overlay-header">
				<h4 className="agent-client-error-overlay-title">
					{errorInfo.title}
				</h4>
				<button
					className="agent-client-error-overlay-close"
					onClick={onClose}
					aria-label="Close error"
					type="button"
					ref={(el) => {
						if (el) {
							setIcon(el, "x");
						}
					}}
				/>
			</div>
			<p className="agent-client-error-overlay-message">
				{errorInfo.message}
			</p>
			{errorInfo.suggestion && (
				<p className="agent-client-error-overlay-suggestion">
					{showEmojis && "💡 "}
					{errorInfo.suggestion}
				</p>
			)}
		</div>
	);
}
