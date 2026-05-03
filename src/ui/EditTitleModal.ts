/**
 * Modal for editing a session title.
 *
 * Displays a text input pre-filled with the current title.
 * Calls onSave callback with the new title when user clicks Save.
 */

import { Modal, App } from "obsidian";

export class EditTitleModal extends Modal {
	private currentTitle: string;
	private onSave: (newTitle: string) => void | Promise<void>;

	constructor(
		app: App,
		currentTitle: string,
		onSave: (newTitle: string) => void | Promise<void>,
	) {
		super(app);
		this.currentTitle = currentTitle;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Edit session title" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			cls: "agent-client-edit-title-input",
			attr: { maxlength: "100" },
		});
		// createEl sets HTML attribute; explicit assignment sets DOM property (displayed value)
		inputEl.value = this.currentTitle;

		// Focus and select all text for easy replacement
		setTimeout(() => {
			inputEl.focus();
			inputEl.select();
		}, 10);

		// Enter key to save
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.saveAndClose(inputEl.value);
			}
		});

		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-edit-title-buttons",
		});

		buttonContainer
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.close();
			});

		buttonContainer
			.createEl("button", {
				text: "Save",
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				this.saveAndClose(inputEl.value);
			});
	}

	private saveAndClose(rawValue: string) {
		const value = rawValue.trim();
		if (!value) return;
		this.close();
		void this.onSave(value);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
