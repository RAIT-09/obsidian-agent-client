import * as React from "react";
const { useCallback } = React;

import type { App } from "obsidian";
import { ObsidianIcon } from "../ObsidianIcon";
import { getFileIcon } from "./file-icons";
import type { UseAutoMentionReturn } from "../../../hooks/useAutoMention";

interface MentionBadgeStripProps {
	contextMentions: string[];
	onAddContextMention: (name: string) => void;
	onRemoveContextMention: (name: string) => void;
	autoMentionEnabled: boolean;
	autoMention: UseAutoMentionReturn;
	app: App;
}

export function MentionBadgeStrip({
	contextMentions,
	onAddContextMention,
	onRemoveContextMention,
	autoMentionEnabled,
	autoMention,
	app,
}: MentionBadgeStripProps) {
	const openFile = useCallback(
		(name: string) => {
			void app.workspace.openLinkText(name, "");
		},
		[app],
	);

	const handleAddActiveNote = useCallback(() => {
		if (autoMention.activeNote) {
			onAddContextMention(autoMention.activeNote.name);
		}
	}, [autoMention.activeNote, onAddContextMention]);

	const showAddButton = autoMentionEnabled && autoMention.activeNote !== null;
	const activeNoteAlreadyAdded =
		autoMention.activeNote !== null &&
		contextMentions.includes(autoMention.activeNote.name);
	const activeNoteName = autoMention.activeNote?.name ?? "";

	if (!showAddButton && contextMentions.length === 0) return null;

	return (
		<div className="obsius-mention-badge-strip">
			{contextMentions.map((name) => (
				<div key={name} className="obsius-context-mention-badge">
					<ObsidianIcon
						name={getFileIcon(name)}
						className="obsius-context-mention-icon"
						size={12}
					/>
					<span
						className="obsius-context-mention-name obsius-context-mention-link"
						onClick={() => openFile(name)}
						role="link"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								openFile(name);
							}
						}}
					>
						{name}
					</span>
					<span
						className="obsius-context-mention-remove"
						onClick={() => onRemoveContextMention(name)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onRemoveContextMention(name);
							}
						}}
					>
						<ObsidianIcon name="x" size={12} />
					</span>
				</div>
			))}
			{showAddButton && !activeNoteAlreadyAdded && (
				<div
					className="obsius-context-mention-add"
					onClick={handleAddActiveNote}
					role="button"
					tabIndex={0}
					title={`Add "${activeNoteName}" as context`}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleAddActiveNote();
						}
					}}
				>
					<ObsidianIcon name="at-sign" size={12} />
					<ObsidianIcon name="plus" size={10} />
				</div>
			)}
		</div>
	);
}
