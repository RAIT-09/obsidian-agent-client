/**
 * Session History Modal
 *
 * Obsidian Modal wrapper that renders the SessionHistoryContent React component.
 * Handles modal lifecycle (open/close) while delegating UI rendering to React.
 */

import { Modal, App } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import {
	SessionHistoryContent,
	SessionHistoryContentProps,
} from "./SessionHistoryContent";

/**
 * Props for SessionHistoryModal (same as SessionHistoryContentProps minus onClose).
 */
export type SessionHistoryModalProps = Omit<
	SessionHistoryContentProps,
	"onClose"
>;

/**
 * Modal for displaying and selecting from session history.
 *
 * This is a thin wrapper around the SessionHistoryContent React component.
 * It extends Obsidian's Modal class for proper modal behavior (backdrop,
 * escape key handling, etc.) while delegating all UI rendering to React.
 */
export class SessionHistoryModal extends Modal {
	private root: Root | null = null;
	private props: SessionHistoryModalProps;

	constructor(app: App, props: SessionHistoryModalProps) {
		super(app);
		this.props = props;
	}

	/**
	 * Update modal props and re-render the React component.
	 * Call this when session data changes.
	 */
	updateProps(props: SessionHistoryModalProps) {
		this.props = props;
		this.renderContent();
	}

	/**
	 * Called when modal is opened.
	 * Creates React root and renders the content.
	 */
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal title
		contentEl.createEl("h2", { text: "Session history" });

		// Create container for React content
		const reactContainer = contentEl.createDiv();

		// Create React root and render
		this.root = createRoot(reactContainer);
		this.renderContent();
	}

	/**
	 * Render or re-render the React content.
	 */
	private renderContent() {
		if (this.root) {
			this.root.render(
				React.createElement(SessionHistoryContent, {
					...this.props,
					onClose: () => this.close(),
				}),
			);
		}
	}

	/**
	 * Called when modal is closed.
	 * Unmounts React component and cleans up.
	 */
	onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}
