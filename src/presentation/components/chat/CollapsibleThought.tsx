import * as React from "react";
const { useState, useId, useCallback } = React;
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const contentId = useId();

	const handleToggle = useCallback(() => {
		setIsExpanded((prev) => !prev);
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				handleToggle();
			}
		},
		[handleToggle],
	);

	return (
		<div className="collapsible-thought">
			<div
				className="collapsible-thought-header"
				role="button"
				tabIndex={0}
				aria-expanded={isExpanded}
				aria-controls={contentId}
				onClick={handleToggle}
				onKeyDown={handleKeyDown}
			>
				<span aria-hidden="true">&#128161;</span>
				<span>Thinking</span>
				<span className="collapsible-thought-icon" aria-hidden="true">
					{isExpanded ? "\u25BC" : "\u25B6"}
				</span>
			</div>
			{isExpanded && (
				<div
					id={contentId}
					className="collapsible-thought-content"
					role="region"
					aria-label="Agent thought content"
				>
					<MarkdownTextRenderer text={text} plugin={plugin} />
				</div>
			)}
		</div>
	);
}
