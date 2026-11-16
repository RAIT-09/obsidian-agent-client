import { Notice } from "obsidian";
import type { ChatViewRegistry } from "../services/view-registry";

/** Notify without interrupting the session the user is already watching. */
export function notifySessionEvent(
	registry: ChatViewRegistry,
	viewId: string,
	body: string,
): void {
	if (!activeDocument.hasFocus()) {
		new Notification("Agent Client", { body });
		return;
	}

	const view = registry.get(viewId);
	if (!view || view.hasFocus()) return;

	const sessionId = view.getSessionId();
	const message = createFragment();
	message.appendText(`${view.getSessionTitle()}: ${body} `);
	const link = message.createEl("a", { text: "Open chat", href: "#" });
	const notice = new Notice(message);
	link.addEventListener("click", (event) => {
		event.preventDefault();
		// The view may have closed or started another session since the alert.
		const currentView = registry.get(viewId);
		if (currentView?.getSessionId() === sessionId) currentView.focus();
		notice.hide();
	});
}
