import * as React from "react";
const { useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type { ErrorInfo } from "../../domain/models/agent-error";
import type { IChatViewHost } from "./types";
import { getUiLanguage, t } from "../../shared/i18n";
import type AgentClientPlugin from "../../plugin";

export interface ErrorOverlayProps {
	/** Error information to display */
	errorInfo: ErrorInfo;
	/** Callback to close/clear the error */
	onClose: () => void;
	/** Whether to show emojis */
	showEmojis: boolean;
	/** Plugin instance for language detection */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: IChatViewHost;
}

/**
 * Error overlay component displayed above the input field.
 *
 * Design decisions:
 * - Uses same positioning pattern as SuggestionDropdown (position: absolute; bottom: 100%)
 * - Closes on outside click (consistent with SuggestionDropdown)
 * - Closes on Escape key (consistent with Obsidian's native Menu)
 * - Does not block chat messages from being visible
 */
export function ErrorOverlay({
	errorInfo,
	onClose,
	showEmojis,
	plugin,
	view,
}: ErrorOverlayProps) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const language = getUiLanguage(plugin.app);

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
					aria-label={t(language, "closeError")}
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
