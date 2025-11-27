import * as React from "react";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { CollapsibleBlock } from "../shared/CollapsibleBlock";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	// Calculate a brief preview of the thought for the meta field
	const preview = text.length > 50 ? `${text.slice(0, 47).trim()}...` : undefined;

	return (
		<CollapsibleBlock
			icon="lightbulb"
			label="Thinking"
			meta={preview}
			defaultExpanded={false}
			variant="subtle"
		>
			<MarkdownTextRenderer text={text} plugin={plugin} />
		</CollapsibleBlock>
	);
}
