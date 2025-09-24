import * as React from "react";
const { useState } = React;
import type AgentClientPlugin from "../../main";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function CollapsibleThought({
	text,
	plugin,
}: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			style={{
				fontStyle: "italic",
				color: "var(--text-muted)",
				backgroundColor: "transparent",
				fontSize: "0.9em",
				cursor: "pointer",
			}}
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
				💡Thinking
				<span
					style={{
						fontSize: "0.8em",
						opacity: 0.7,
						marginLeft: "auto",
					}}
				>
					{isExpanded ? "▼" : "▶"}
				</span>
			</div>
			{isExpanded && (
				<div
					style={{
						marginTop: "8px",
						paddingLeft: "16px",
						userSelect: "text",
					}}
				>
					<MarkdownTextRenderer text={text} plugin={plugin} />
				</div>
			)}
		</div>
	);
}
