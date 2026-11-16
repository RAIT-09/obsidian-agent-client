import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import { ChatViewRegistry } from "../src/services/view-registry";
import type { IChatViewContainer } from "../src/services/view-registry";
import { notifySessionEvent } from "../src/ui/session-notification";

const { hideNotice } = vi.hoisted(() => ({ hideNotice: vi.fn() }));

vi.mock("obsidian", () => ({
	Notice: vi.fn(function () {
		return { hide: hideNotice };
	}),
}));

describe("session notifications", () => {
	let registry: ChatViewRegistry;
	let view: IChatViewContainer;
	let focusView: ReturnType<typeof vi.fn>;
	let link: EventTarget;
	let fragment: {
		appendText: ReturnType<typeof vi.fn>;
		createEl: ReturnType<typeof vi.fn>;
	};
	let systemNotification: ReturnType<typeof vi.fn>;
	let documentHasFocus: boolean;
	let viewHasFocus: boolean;
	let sessionId: string;

	beforeEach(() => {
		vi.clearAllMocks();
		documentHasFocus = true;
		viewHasFocus = false;
		sessionId = "session-a";
		registry = new ChatViewRegistry();
		focusView = vi.fn();
		view = {
			viewId: "view-a",
			viewType: "sidebar",
			onActivate: vi.fn(),
			onDeactivate: vi.fn(),
			hasFocus: () => viewHasFocus,
			getSessionTitle: () => "Review the demo note",
			getSessionId: () => sessionId,
			focus: focusView,
		} as unknown as IChatViewContainer;
		registry.register(view);
		link = new EventTarget();
		fragment = {
			appendText: vi.fn(),
			createEl: vi.fn(() => link),
		};
		systemNotification = vi.fn(function () {});
		vi.stubGlobal("Notification", systemNotification);
		vi.stubGlobal("activeDocument", { hasFocus: () => documentHasFocus });
		vi.stubGlobal("createFragment", () => fragment);
	});

	afterEach(() => vi.unstubAllGlobals());

	it.each([
		"Demo Agent has completed the response.",
		"Demo Agent is requesting permission.",
	])("shows a named in-app notice for a background event: %s", (body) => {
		// Last-focused chat tracking can still point at this view after the
		// user focuses a note. Actual focus must determine whether to notify.
		expect(registry.getFocusedId()).toBe(view.viewId);
		notifySessionEvent(registry, view.viewId, body);
		expect(systemNotification).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(fragment);
		expect(fragment.appendText).toHaveBeenCalledWith(
			`Review the demo note: ${body} `,
		);
		expect(fragment.createEl).toHaveBeenCalledWith("a", {
			text: "Open chat",
			href: "#",
		});
	});

	it("stays silent while the originating view has focus", () => {
		viewHasFocus = true;
		notifySessionEvent(registry, view.viewId, "Response complete.");
		expect(Notice).not.toHaveBeenCalled();
		expect(systemNotification).not.toHaveBeenCalled();
	});

	it("keeps OS notifications when Obsidian is unfocused", () => {
		documentHasFocus = false;
		// The DOM can retain its focused element after switching applications.
		viewHasFocus = true;
		notifySessionEvent(registry, view.viewId, "Permission requested.");
		expect(systemNotification).toHaveBeenCalledWith("Agent Client", {
			body: "Permission requested.",
		});
		expect(Notice).not.toHaveBeenCalled();
	});

	it("opens the originating view and dismisses the notice", () => {
		notifySessionEvent(registry, view.viewId, "Response complete.");
		const event = new Event("click", { cancelable: true });
		link.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(focusView).toHaveBeenCalledOnce();
		expect(hideNotice).toHaveBeenCalledOnce();
	});

	it("does not jump to a different session reusing the same view", () => {
		notifySessionEvent(registry, view.viewId, "Response complete.");
		sessionId = "session-b";
		link.dispatchEvent(new Event("click"));
		expect(focusView).not.toHaveBeenCalled();
	});

	it("safely dismisses a notice after its view closes", () => {
		notifySessionEvent(registry, view.viewId, "Response complete.");
		registry.unregister(view.viewId);
		link.dispatchEvent(new Event("click"));
		expect(focusView).not.toHaveBeenCalled();
		expect(hideNotice).toHaveBeenCalledOnce();
	});

	it("does not show an in-app notice for an unregistered view", () => {
		registry.unregister(view.viewId);
		notifySessionEvent(registry, view.viewId, "Response complete.");
		expect(Notice).not.toHaveBeenCalled();
	});
});
