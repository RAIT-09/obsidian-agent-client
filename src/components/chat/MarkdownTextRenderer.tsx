import * as React from "react";
const { useRef, useEffect } = React;
import { Component, MarkdownRenderer } from "obsidian";
import type AgentClientPlugin from "../../plugin";

interface MarkdownTextRendererProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function MarkdownTextRenderer({
	text,
	plugin,
}: MarkdownTextRendererProps) {
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
		void MarkdownRenderer.render(plugin.app, text, el, "", component);

		// Handle internal link clicks
		const handleInternalLinkClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const link = target.closest("a.internal-link");
			if (link) {
				e.preventDefault();
				const href = link.getAttribute("data-href");
				if (href) {
					void plugin.app.workspace.openLinkText(href, "");
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
