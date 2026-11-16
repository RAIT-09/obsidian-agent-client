import * as React from "react";
const { useRef, useEffect } = React;
import {
	Component,
	FileSystemAdapter,
	MarkdownRenderer as ObsidianMarkdownRenderer,
	Platform,
} from "obsidian";
import { resolveInternalLinkHref } from "../../utils/paths";
import { useHoverLinkPreview } from "../../hooks/useHoverLinkPreview";
import type AgentClientPlugin from "../../plugin";

interface MarkdownRendererProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function MarkdownRenderer({ text, plugin }: MarkdownRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerHoverLink = useHoverLinkPreview(plugin);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty?.();
		el.classList.add("markdown-rendered");

		// Create a temporary component for the markdown renderer lifecycle
		const component = new Component();
		component.load();

		// Render markdown
		void ObsidianMarkdownRenderer.render(
			plugin.app,
			text,
			el,
			"",
			component,
		);

		// MarkdownRenderer.render() only emits `a.internal-link[data-href]`;
		// click and hover handling is up to the host (us).
		const vaultBasePath =
			plugin.app.vault.adapter instanceof FileSystemAdapter
				? plugin.app.vault.adapter.getBasePath()
				: null;
		const isWslMode = Platform.isWin && plugin.settings.windowsWslMode;

		/**
		 * The internal link under the event target, with its vault linktext
		 * (null when it can't be opened, e.g. an absolute path outside the vault)
		 */
		const findInternalLink = (
			e: MouseEvent,
		): { link: HTMLElement; linktext: string | null } | null => {
			const link = (e.target as HTMLElement).closest<HTMLElement>(
				"a.internal-link",
			);
			if (!link) return null;
			const rawHref = link.getAttribute("data-href");
			const linktext = rawHref
				? resolveInternalLinkHref(rawHref, vaultBasePath, isWslMode)
				: null;
			return { link, linktext };
		};

		const handleInternalLinkClick = (e: MouseEvent) => {
			const found = findInternalLink(e);
			if (!found) return;
			e.preventDefault();
			if (found.linktext !== null) {
				void plugin.app.workspace.openLinkText(found.linktext, "");
			}
		};

		const handleInternalLinkHover = (e: MouseEvent) => {
			const found = findInternalLink(e);
			if (found && found.linktext !== null) {
				triggerHoverLink(e, found.link, found.linktext);
			}
		};

		el.addEventListener("click", handleInternalLinkClick);
		el.addEventListener("mouseover", handleInternalLinkHover);

		return () => {
			el.removeEventListener("click", handleInternalLinkClick);
			el.removeEventListener("mouseover", handleInternalLinkHover);
			component.unload();
		};
	}, [text, plugin, triggerHoverLink]);

	return (
		<div
			ref={containerRef}
			className="agent-client-markdown-text-renderer"
		/>
	);
}
