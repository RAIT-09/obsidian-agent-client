import * as React from "react";
import type AgentClientPlugin from "../../main";

interface TextWithMentionsProps {
	text: string;
	plugin: AgentClientPlugin;
}

// Function to render text with @mentions
export function TextWithMentions({
	text,
	plugin,
}: TextWithMentionsProps): React.ReactElement {
	// Match both @filename and @[filename with spaces] formats
	const mentionRegex = /@(?:\[([^\]]+)\]|([^@\s]+))/g;
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Add text before the mention
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		// Extract filename - either from [brackets] or plain text
		const noteName = match[1] || match[2];

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

	return (
		<div className="text-with-mentions">
			<p className="auto">{parts}</p>
		</div>
	);
}
