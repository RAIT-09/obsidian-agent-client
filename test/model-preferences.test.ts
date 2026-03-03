import { describe, expect, it } from "vitest";
import { renderAgentModelSettings } from "../src/components/settings/sections/model-preferences";

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function installObsidianElementHelpers(): void {
	const proto = HTMLElement.prototype as HTMLElement & {
		createDiv?: (options?: unknown) => HTMLDivElement;
		createSpan?: (options?: unknown) => HTMLSpanElement;
		empty?: () => void;
		addClass?: (cls: string) => void;
		removeClass?: (cls: string) => void;
	};

	if (!proto.createDiv) {
		proto.createDiv = function (this: HTMLElement, options?: unknown) {
			const el = this.ownerDocument.createElement("div");
			const opts = options as { cls?: string; text?: string } | undefined;
			if (opts?.cls) el.className = opts.cls;
			if (opts?.text) el.textContent = opts.text;
			this.appendChild(el);
			return el;
		};
	}

	if (!proto.createSpan) {
		proto.createSpan = function (this: HTMLElement, options?: unknown) {
			const el = this.ownerDocument.createElement("span");
			const opts = options as
				| { cls?: string; text?: string; attr?: Record<string, string> }
				| undefined;
			if (opts?.cls) el.className = opts.cls;
			if (opts?.text) el.textContent = opts.text;
			if (opts?.attr) {
				for (const [key, value] of Object.entries(opts.attr)) {
					el.setAttribute(key, value);
				}
			}
			this.appendChild(el);
			return el;
		};
	}

	if (!proto.empty) {
		proto.empty = function (this: HTMLElement) {
			this.textContent = "";
		};
	}

	if (!proto.addClass) {
		proto.addClass = function (this: HTMLElement, cls: string) {
			this.classList.add(cls);
		};
	}

	if (!proto.removeClass) {
		proto.removeClass = function (this: HTMLElement, cls: string) {
			this.classList.remove(cls);
		};
	}
}

describe("model preferences settings", () => {
	it("re-renders mode model options after candidate model changes", async () => {
		installObsidianElementHelpers();
		const containerEl = document.createElement("div");
		const agentId = "agent-1";

		const plugin = {
			settings: {
				cachedAgentModels: {
					[agentId]: [
						{ modelId: "openai/gpt-5", name: "openai/gpt-5" },
						{ modelId: "openai/gpt-5-mini", name: "openai/gpt-5-mini" },
					],
				},
				cachedAgentModes: {
					[agentId]: [{ id: "code", name: "Code" }],
				},
				candidateModels: {},
				modeModelDefaults: {},
			},
			settingsStore: {
				updateSettings: async (
					update: Partial<{
						candidateModels: Record<string, string[]>;
						modeModelDefaults: Record<string, Record<string, string>>;
					}>,
				) => {
					plugin.settings = {
						...plugin.settings,
						...update,
					};
				},
			},
		};

		renderAgentModelSettings(containerEl, plugin as never, agentId);

		let modeSelect = Array.from(containerEl.querySelectorAll("select")).at(-1);
		expect(modeSelect).toBeTruthy();
		expect(modeSelect?.options).toHaveLength(1);
		expect(modeSelect?.options[0]?.textContent).toBe("(empty)");

		const addButton = containerEl.querySelector<HTMLButtonElement>(
			'button[aria-label="Add model"]',
		);
		expect(addButton).toBeTruthy();
		addButton?.click();

		const firstModelItem = containerEl.querySelector<HTMLElement>(
			".obsius-model-picker-item",
		);
		expect(firstModelItem).toBeTruthy();
		firstModelItem?.click();
		await flush();

		modeSelect = Array.from(containerEl.querySelectorAll("select")).at(-1);
		expect(modeSelect).toBeTruthy();
		expect(modeSelect?.options).toHaveLength(2);
		expect(modeSelect?.options[0]?.textContent).toBe("(auto)");
		expect(
			Array.from(modeSelect?.options ?? []).some(
				(option) => option.value === "openai/gpt-5",
			),
		).toBe(true);
	});
});
