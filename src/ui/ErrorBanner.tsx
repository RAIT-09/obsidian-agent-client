import * as React from "react";
const { useEffect } = React;
import { setIcon } from "obsidian";
import type { ErrorInfo, OverlayVariant } from "../types/errors";
import { LucideIcon } from "./shared/IconButton";
import type { IChatViewHost } from "./view-host";

export interface ErrorBannerProps {
	/** Error information to display */
	errorInfo: ErrorInfo;
	/** Callback to close/clear the error */
	onClose: () => void;
	/** Whether to show emojis */
	showEmojis: boolean;
	/** View instance for event registration */
	view: IChatViewHost;
	/** Visual variant. Defaults to "error" for backward compatibility. */
	variant?: OverlayVariant;
}

/**
 * Banner component displayed above the input field.
 *
 * Supports visual variants:
 * - "error" (default): Red border/title — for process errors and failures
 * - "info": Subtle border/title — for update notifications
 *
 * Design decisions:
 * - Uses same positioning pattern as SuggestionPopup (position: absolute; bottom: 100%)
 * - Closes on Escape key or close button
 * - Does not block chat messages from being visible
 */
export function ErrorBanner({
	errorInfo,
	onClose,
	showEmojis,
	view,
	variant = "error",
}: ErrorBannerProps) {
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
		<div
			className={`agent-client-error-overlay agent-client-error-overlay--${variant}`}
		>
			<div className="agent-client-error-overlay-header">
				<h4 className="agent-client-error-overlay-title">
					{errorInfo.title}
				</h4>
				<button
					className="agent-client-error-overlay-close"
					onClick={onClose}
					aria-label="Close"
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
				<div className="agent-client-error-overlay-suggestion">
					{showEmojis && variant === "error" && (
						<LucideIcon
							name="circle-alert"
							className="agent-client-error-overlay-suggestion-icon"
						/>
					)}
					{variant !== "error" ? (
						<code className="agent-client-error-overlay-code">
							{errorInfo.suggestion}
						</code>
					) : (
						errorInfo.suggestion
					)}
				</div>
			)}
		</div>
	);
}
