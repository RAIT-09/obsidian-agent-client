/**
 * Confirmation Modal for Session Deletion
 *
 * Obsidian Modal that prompts user to confirm before deleting a session.
 * Prevents accidental deletion due to misclicks.
 */

import { Modal, App } from "obsidian";
import { getUiLanguage, t } from "../../shared/i18n";

/**
 * Confirmation modal for session deletion.
 *
 * Displays session title and asks user to confirm deletion.
 * Calls onConfirm callback only when user clicks Delete button.
 */
export class ConfirmDeleteModal extends Modal {
	private sessionTitle: string;
	private onConfirm: () => void | Promise<void>;

	constructor(
		app: App,
		sessionTitle: string,
		onConfirm: () => void | Promise<void>,
	) {
		super(app);
		this.sessionTitle = sessionTitle;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		const language = getUiLanguage(this.app);

		// Title
		contentEl.createEl("h2", {
			text: t(language, "deleteSessionConfirmTitle"),
		});

		// Message
		contentEl.createEl("p", {
			text: t(language, "deleteSessionConfirmMessage", {
				title: this.sessionTitle,
			}),
			cls: "agent-client-confirm-delete-message",
		});

		contentEl.createEl("p", {
			text: t(language, "deleteSessionWarning"),
			cls: "agent-client-confirm-delete-warning",
		});

		// Buttons container
		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-confirm-delete-buttons",
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: t(language, "cancel"),
			cls: "agent-client-confirm-delete-cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		// Delete button
		const deleteButton = buttonContainer.createEl("button", {
			text: t(language, "delete"),
			cls: "agent-client-confirm-delete-confirm mod-warning",
		});
		deleteButton.addEventListener("click", () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
