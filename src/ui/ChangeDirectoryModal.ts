/**
 * Modal for selecting a working directory for a new chat session.
 *
 * Provides a text input for manual path entry and a Browse button
 * that opens the native OS folder picker via Electron's dialog API.
 * Calls onSelect callback with the chosen path when user clicks Start.
 */

import { Modal, App } from "obsidian";

export class ChangeDirectoryModal extends Modal {
	private currentPath: string;
	private onSelect: (path: string) => void | Promise<void>;

	constructor(
		app: App,
		currentPath: string,
		onSelect: (path: string) => void | Promise<void>,
	) {
		super(app);
		this.currentPath = currentPath;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "New chat in directory" });

		contentEl.createEl("p", {
			text: "Start a new chat session with the agent working in the specified directory.",
			cls: "agent-client-change-dir-description",
		});

		// Path input row (text input + browse button)
		const inputRow = contentEl.createDiv({
			cls: "agent-client-change-dir-input-row",
		});

		const inputEl = inputRow.createEl("input", {
			type: "text",
			cls: "agent-client-change-dir-input",
			placeholder: "/path/to/directory",
		});
		inputEl.value = this.currentPath;

		const browseButton = inputRow.createEl("button", {
			text: "Browse...",
		});
		browseButton.addEventListener("click", () => {
			void this.openFolderPicker().then((selectedPath) => {
				if (selectedPath) {
					inputEl.value = selectedPath;
				}
			});
		});

		// Focus and select all text
		setTimeout(() => {
			inputEl.focus();
			inputEl.select();
		}, 10);

		// Enter key to start
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.selectAndClose(inputEl.value);
			}
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({
			cls: "agent-client-change-dir-buttons",
		});

		buttonContainer
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.close();
			});

		buttonContainer
			.createEl("button", {
				text: "Start",
				cls: "mod-cta",
			})
			.addEventListener("click", () => {
				this.selectAndClose(inputEl.value);
			});
	}

	private async openFolderPicker(): Promise<string | null> {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { remote } = require("electron") as {
				remote: {
					dialog: {
						showOpenDialog: (options: {
							properties: string[];
							title: string;
							defaultPath?: string;
						}) => Promise<{
							canceled: boolean;
							filePaths: string[];
						}>;
					};
				};
			};
			const result = await remote.dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select working directory",
				defaultPath: this.currentPath,
			});
			if (!result.canceled && result.filePaths.length > 0) {
				return result.filePaths[0];
			}
		} catch {
			// Electron remote not available — ignore silently
			// User can still type the path manually
		}
		return null;
	}

	private selectAndClose(rawValue: string) {
		const value = rawValue.trim();
		if (!value) return;
		this.close();
		void this.onSelect(value);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
