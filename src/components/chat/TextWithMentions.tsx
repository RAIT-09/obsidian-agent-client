import * as React from "react";
import { TFile, TFolder } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import { getFileIcon } from "./chat-input/file-icons";
import { ObsidianIcon } from "./ObsidianIcon";
import {
	formatChatContextBadgeLabel,
	formatChatContextTooltip,
	parseChatContextToken,
	type ChatContextReference,
} from "../../shared/chat-context-token";
import { parseSlashCommandToken } from "../../shared/slash-command-token";
import { isMentionableExtension } from "../../shared/mentionable-files";

function isMentionableFile(file: TFile): boolean {
	return isMentionableExtension(file.extension);
}

function resolveMentionedFile(
	plugin: AgentClientPlugin,
	mentionTarget: string,
): TFile | null {
	const direct = plugin.app.vault.getAbstractFileByPath(mentionTarget);
	if (direct instanceof TFile && isMentionableFile(direct)) {
		return direct;
	}

	return (
		plugin.app.vault
			.getFiles()
			.filter((f) => isMentionableFile(f))
			.find((f) => f.basename === mentionTarget) ?? null
	);
}

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

function getContextIconName(reference: ChatContextReference): string {
	if (reference.type === "selection") {
		return "list";
	}
	if (reference.type === "folder") {
		return "folder";
	}
	return getFileIcon(reference.notePath);
}

function renderContextBadge(
	reference: ChatContextReference,
	key: string,
	plugin: AgentClientPlugin,
): React.ReactElement {
	const canOpenInEditor = reference.type !== "folder";

	return (
		<span
			key={key}
			className={`obsius-inline-mention-badge obsius-inline-context-badge${canOpenInEditor ? " obsius-inline-context-badge-clickable" : ""}`}
			title={formatChatContextTooltip(reference)}
			onClick={
				canOpenInEditor
					? () => void plugin.openContextReference(reference)
					: undefined
			}
			role={canOpenInEditor ? "button" : undefined}
			tabIndex={canOpenInEditor ? 0 : undefined}
			onKeyDown={(e) => {
				if (!canOpenInEditor) {
					return;
				}
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					void plugin.openContextReference(reference);
				}
			}}
		>
			<ObsidianIcon
				name={getContextIconName(reference)}
				className="obsius-inline-mention-icon"
				size={12}
			/>
			<span className="obsius-inline-mention-name">
				{formatChatContextBadgeLabel(reference)}
			</span>
		</span>
	);
}

function renderSlashCommandBadge(
	commandName: string,
	key: string,
): React.ReactElement {
	return (
		<span
			key={key}
			className="obsius-inline-mention-badge obsius-inline-slash-badge"
		>
			<ObsidianIcon
				name="terminal"
				className="obsius-inline-mention-icon"
				size={12}
			/>
			<span className="obsius-inline-mention-name">/{commandName}</span>
		</span>
	);
}

// Function to render text with @mentions and optional auto-mention
export function TextWithMentions({
	text,
	plugin,
	autoMentionContext,
}: TextWithMentionsProps): React.ReactElement {
	// Match @[[filename]], context tokens, and slash command tokens
	const mentionRegex = /@\[obsius-context:[A-Za-z0-9_-]+\]|@\[obsius-slash:([^\]]+)\]|@\[\[([^\]]+)\]\]/g;
	const parts: React.ReactNode[] = [];

	if (autoMentionContext) {
		const autoContext: ChatContextReference = autoMentionContext.selection
			? {
					type: "selection",
					notePath: autoMentionContext.notePath,
					noteName: autoMentionContext.noteName,
					selection: {
						from: {
							line: Math.max(0, autoMentionContext.selection.fromLine - 1),
							ch: 0,
						},
						to: {
							line: Math.max(0, autoMentionContext.selection.toLine - 1),
							ch: 0,
						},
					},
				}
			: {
					type: "file",
					notePath: autoMentionContext.notePath,
					noteName: autoMentionContext.noteName,
				};
		parts.push(
			<span
				key="auto-context-prefix"
				className="obsius-text-inline-context-prefix"
			>
				{renderContextBadge(autoContext, "auto-context-badge", plugin)}
			</span>,
		);
		if (text.trim().length > 0) {
			parts.push("\n");
		}
	}

	let lastIndex = 0;
	let match;

	while ((match = mentionRegex.exec(text)) !== null) {
		// Add text before the mention
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		const token = match[0];
		if (token.startsWith("@[obsius-context:")) {
			const parsedContext = parseChatContextToken(token);
			if (parsedContext) {
				parts.push(
					renderContextBadge(
						parsedContext,
						`context-token-${match.index}`,
						plugin,
					),
				);
			} else {
				parts.push(token);
			}
		} else if (token.startsWith("@[obsius-slash:")) {
			const cmdName = parseSlashCommandToken(token);
			if (cmdName) {
				parts.push(
					renderSlashCommandBadge(cmdName, `slash-token-${match.index}`),
				);
			} else {
				parts.push(token);
			}
		} else {
			const mentionTarget = match[2];

			const file = resolveMentionedFile(plugin, mentionTarget);

			if (file) {
				parts.push(
					<span
						key={match.index}
						className="obsius-inline-mention-badge obsius-inline-context-badge obsius-inline-context-badge-clickable"
						title={file.path}
						onClick={() => {
							void plugin.app.workspace.openLinkText(file.path, "");
						}}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								void plugin.app.workspace.openLinkText(file.path, "");
							}
						}}
					>
						<ObsidianIcon
							name={getFileIcon(file.path)}
							className="obsius-inline-mention-icon"
							size={12}
						/>
						<span className="obsius-inline-mention-name">
							{file.basename}
						</span>
					</span>,
				);
			} else {
				const abstractFile =
					plugin.app.vault.getAbstractFileByPath(mentionTarget);
				if (abstractFile instanceof TFolder) {
					parts.push(
						<span
							key={match.index}
							className="obsius-inline-mention-badge obsius-inline-context-badge"
							title={abstractFile.path}
						>
							<ObsidianIcon
								name="folder"
								className="obsius-inline-mention-icon"
								size={12}
							/>
							<span className="obsius-inline-mention-name">
								{mentionTarget}
							</span>
						</span>,
					);
				} else {
					parts.push(`@${mentionTarget}`);
				}
			}
		}

		lastIndex = match.index + match[0].length;
	}

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return <div className="obsius-text-with-mentions">{parts}</div>;
}
