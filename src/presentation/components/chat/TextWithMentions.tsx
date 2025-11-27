import * as React from "react";
const { useCallback } = React;
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";

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

/**
 * Clickable mention link component with keyboard accessibility.
 */
function MentionLink({
	noteName,
	notePath,
	plugin,
	displayText,
}: {
	noteName: string;
	notePath: string;
	plugin: AgentClientPlugin;
	displayText?: string;
}) {
	const handleClick = useCallback(() => {
		plugin.app.workspace.openLinkText(notePath, "");
	}, [plugin.app.workspace, notePath]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				handleClick();
			}
		},
		[handleClick],
	);

	return (
		<span
			className="text-mention"
			role="link"
			tabIndex={0}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			aria-label={`Open note: ${noteName}`}
		>
			{displayText || `@${noteName}`}
		</span>
	);
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
			<MentionLink
				key="auto-mention"
				noteName={autoMentionContext.noteName}
				notePath={autoMentionContext.notePath}
				plugin={plugin}
				displayText={displayText}
			/>,
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
				<MentionLink
					key={match.index}
					noteName={noteName}
					notePath={file.path}
					plugin={plugin}
				/>,
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
