import * as React from "react";
const { useRef, useEffect } = React;
import { MarkdownRenderer } from "obsidian";
import type AgentClientPlugin from "../../main";

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
		el.innerHTML = "";
		el.classList.add("markdown-rendered");

		// Render markdown
		MarkdownRenderer.render(
			plugin.app,
			text,
			el,
			"", // sourcePath - empty for dynamic content
			plugin,
		);
	}, [text, plugin]);

	return <div ref={containerRef} style={{ userSelect: "text" }} />;
}
