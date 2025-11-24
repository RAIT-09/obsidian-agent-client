import * as React from "react";
import type AgentClientPlugin from "../../plugin";

interface TextWithMentionsProps {
	text: string;
	plugin: AgentClientPlugin;
	autoMentionContext?: {
		noteName: string;
		notePath: string;
		selection?: {
			fromLine: number;
			toLine: number;
		};
	};
}

// Function to render text with @mentions and optional auto-mention
export function TextWithMentions({
	text,
	plugin,
	autoMentionContext,
}: TextWithMentionsProps): React.ReactElement {
	// Match @[[filename]] format only
	const mentionRegex = /@\[\[([^\]]+)\]\]/g;
	const parts: React.ReactNode[] = [];

	// Add auto-mention badge first if provided
	if (autoMentionContext) {
		const displayText = autoMentionContext.selection
			? `@${autoMentionContext.noteName}:${autoMentionContext.selection.fromLine}-${autoMentionContext.selection.toLine}`
			: `@${autoMentionContext.noteName}`;

		parts.push(
			<span
				key="auto-mention"
				className="text-mention"
				onClick={() => {
					plugin.app.workspace.openLinkText(
						autoMentionContext.notePath,
						"",
					);
				}}
			>
				{displayText}
			</span>,
		);
		parts.push("\n");
	}

	let lastIndex = 0;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Add text before the mention
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		// Extract filename from [[brackets]]
		const noteName = match[1];

		// Check if file actually exists
		const file = plugin.app.vault
			.getMarkdownFiles()
			.find((f) => f.basename === noteName);

		if (file) {
			// File exists - render as clickable mention
			parts.push(
				<span
					key={match.index}
					className="text-mention"
					onClick={() => {
						plugin.app.workspace.openLinkText(file.path, "");
					}}
				>
					@{noteName}
				</span>,
			);
		} else {
			// File doesn't exist - render as plain text
			parts.push(`@${noteName}`);
		}

		lastIndex = match.index + match[0].length;
	}

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <div className="text-with-mentions">{parts}</div>;
}
