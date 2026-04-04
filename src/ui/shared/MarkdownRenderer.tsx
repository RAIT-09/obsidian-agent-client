import * as React from "react";
const { useRef, useEffect } = React;
import {
	Component,
	FileSystemAdapter,
	MarkdownRenderer as ObsidianMarkdownRenderer,
} from "obsidian";
import type AgentClientPlugin from "../../plugin";

interface MarkdownRendererProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function MarkdownRenderer({ text, plugin }: MarkdownRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);

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

		// Handle internal link clicks
		const vaultBasePath =
			plugin.app.vault.adapter instanceof FileSystemAdapter
				? plugin.app.vault.adapter.getBasePath()
				: null;

		const handleInternalLinkClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const link = target.closest("a.internal-link");
			if (link) {
				e.preventDefault();
				const rawHref = link.getAttribute("data-href");
				if (rawHref) {
					const href = decodeURIComponent(rawHref);
					if (
						vaultBasePath &&
						href.startsWith(vaultBasePath + "/")
					) {
						// Absolute vault path → convert to relative
						const relativePath = href.slice(
							vaultBasePath.length + 1,
						);
						void plugin.app.workspace.openLinkText(
							relativePath,
							"",
						);
					} else if (!href.startsWith("/")) {
						// Already relative or wiki-link style — pass through
						void plugin.app.workspace.openLinkText(href, "");
					}
					// Absolute path outside vault — ignore
				}
			}
		};
		el.addEventListener("click", handleInternalLinkClick);

		return () => {
			el.removeEventListener("click", handleInternalLinkClick);
			component.unload();
		};
	}, [text, plugin]);

	return (
		<div
			ref={containerRef}
			className="agent-client-markdown-text-renderer"
		/>
	);
}
