import { useCallback, useRef } from "react";
import type { HoverParent } from "obsidian";
import type AgentClientPlugin from "../plugin";

/**
 * Bridge chat links to Obsidian's "Page preview" core plugin.
 *
 * Obsidian only shows hover previews for links whose container emits the
 * `hover-link` workspace event; `MarkdownRenderer.render()` output does not do
 * that on its own. The returned callback emits it with this plugin as the
 * source (registered in `plugin.ts` via `registerHoverLinkSource`), so the
 * user's Page preview settings decide whether the Mod key is required.
 *
 * The hover parent is stable for the component's lifetime so Page preview can
 * dedupe repeated `mouseover`s on the link that already owns the popover.
 * No unmount cleanup is needed: Obsidian hides a popover on its own once the
 * pointer is over neither the (possibly detached) link nor the popover.
 *
 * @returns `(event, targetEl, linktext)` — call from a link's `mouseover`
 */
export function useHoverLinkPreview(
	plugin: AgentClientPlugin,
): (event: MouseEvent, targetEl: HTMLElement, linktext: string) => void {
	const hoverParentRef = useRef<HoverParent>({ hoverPopover: null });

	return useCallback(
		(event: MouseEvent, targetEl: HTMLElement, linktext: string) => {
			// `mouseover` bubbles from the link's children; only react when the
			// pointer enters the link from outside (mirrors Obsidian's own guard)
			const related = event.relatedTarget;
			if (related && targetEl.contains(related as Node)) return;

			plugin.app.workspace.trigger("hover-link", {
				event,
				source: plugin.manifest.id,
				hoverParent: hoverParentRef.current,
				targetEl,
				linktext,
				sourcePath: "",
			});
		},
		[plugin],
	);
}
