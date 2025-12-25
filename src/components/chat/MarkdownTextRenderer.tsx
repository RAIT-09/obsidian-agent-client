import * as React from "react";
const { useRef, useEffect } = React;
import { Component, MarkdownRenderer, type App } from "obsidian";

interface MarkdownTextRendererProps {
	text: string;
	app: App;
}

export function MarkdownTextRenderer({ text, app }: MarkdownTextRendererProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.empty?.();
		el.classList.add("agent-client-markdown-rendered");

		// Create a temporary component for the markdown renderer lifecycle
		const component = new Component();
		component.load();

		// Render markdown
		void MarkdownRenderer.render(app, text, el, "", component);

		return () => {
			component.unload();
		};
	}, [text, app]);

	return (
		<div
			ref={containerRef}
			className="agent-client-markdown-text-renderer"
		/>
	);
}
