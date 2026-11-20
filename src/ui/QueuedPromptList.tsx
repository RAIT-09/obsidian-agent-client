import * as React from "react";
const { useCallback, useEffect, useState } = React;
import { setIcon } from "obsidian";
import {
	beginQueuedPromptEdit,
	finishQueuedPromptEdit,
	type QueuedPromptEditState,
} from "../services/message-queue";
import type { AttachedFile, QueuedPrompt } from "../types/chat";
import { AttachmentStrip } from "./shared/AttachmentStrip";

interface QueuedPromptListProps {
	prompts: QueuedPrompt[];
	isPaused: boolean;
	onUpdate: (
		id: string,
		content: string,
		attachments: AttachedFile[],
	) => void;
	onRemove: (id: string) => void;
	onResume: () => void;
	onPause: () => void;
}

export const QueuedPromptList = React.memo(function QueuedPromptList({
	prompts,
	isPaused,
	onUpdate,
	onRemove,
	onResume,
	onPause,
}: QueuedPromptListProps) {
	const [editState, setEditState] = useState<QueuedPromptEditState>({
		editingId: null,
		resumeAfterEdit: false,
	});
	const [draft, setDraft] = useState("");
	const [draftAttachments, setDraftAttachments] = useState<AttachedFile[]>(
		[],
	);
	const canSave = draft.trim().length > 0 || draftAttachments.length > 0;
	const finishEditing = useCallback(
		(resumeNow = false) => {
			const result = finishQueuedPromptEdit(editState, resumeNow);
			setEditState(result.state);
			setDraft("");
			setDraftAttachments([]);
			if (result.shouldResume) onResume();
		},
		[editState, onResume],
	);
	const saveEditing = useCallback(
		(id: string) => {
			if (!canSave) return;
			onUpdate(id, draft.trim(), draftAttachments);
			finishEditing();
		},
		[canSave, draft, draftAttachments, finishEditing, onUpdate],
	);

	useEffect(() => {
		if (
			editState.editingId &&
			!prompts.some((prompt) => prompt.id === editState.editingId)
		) {
			finishEditing();
		}
	}, [editState.editingId, finishEditing, prompts]);

	if (prompts.length === 0) return null;

	return (
		<section
			className="agent-client-queued-prompts"
			aria-label="Queued messages"
		>
			<header className="agent-client-queued-prompts-header">
				<span>
					{prompts.length} queued message
					{prompts.length === 1 ? "" : "s"}
				</span>
				{isPaused && (
					<button type="button" onClick={() => finishEditing(true)}>
						<span
							className="agent-client-queued-prompt-action-icon"
							ref={(element) => {
								if (element) setIcon(element, "play");
							}}
						/>
						Resume
					</button>
				)}
			</header>
			<div className="agent-client-queued-prompts-list">
				{prompts.map((prompt, index) => {
					const isEditing = prompt.id === editState.editingId;
					return (
						<article
							key={prompt.id}
							className="agent-client-queued-prompt"
						>
							<span className="agent-client-queued-prompt-index">
								{index + 1}
							</span>
							<div className="agent-client-queued-prompt-body">
								{isEditing ? (
									<>
										<textarea
											value={draft}
											onChange={(event) =>
												setDraft(event.target.value)
											}
											onKeyDown={(event) => {
												if (event.key === "Escape") {
													event.preventDefault();
													finishEditing();
													return;
												}
												if (
													event.key === "Enter" &&
													(event.metaKey ||
														event.ctrlKey)
												) {
													event.preventDefault();
													saveEditing(prompt.id);
												}
											}}
											rows={2}
											aria-label="Edit queued message"
											autoFocus
										/>
										<AttachmentStrip
											files={draftAttachments}
											onRemove={(id) =>
												setDraftAttachments((files) =>
													files.filter(
														(file) =>
															file.id !== id,
													),
												)
											}
										/>
										<div className="agent-client-queued-prompt-edit-actions">
											<button
												type="button"
												onClick={() =>
													saveEditing(prompt.id)
												}
												disabled={!canSave}
											>
												Save
											</button>
											<button
												type="button"
												onClick={() => finishEditing()}
											>
												Cancel
											</button>
										</div>
									</>
								) : (
									<>
										<div className="agent-client-queued-prompt-text">
											{prompt.content ||
												"Attachment message"}
										</div>
										{prompt.attachments.length > 0 && (
											<div className="agent-client-queued-prompt-attachment-count">
												{prompt.attachments.length}{" "}
												attachment
												{prompt.attachments.length === 1
													? ""
													: "s"}
											</div>
										)}
									</>
								)}
							</div>
							{!isEditing && (
								<div className="agent-client-queued-prompt-actions">
									<button
										type="button"
										title="Edit queued message"
										aria-label="Edit queued message"
										onClick={() => {
											const result =
												beginQueuedPromptEdit(
													editState,
													prompt.id,
													isPaused,
												);
											if (result.shouldPause) onPause();
											setEditState(result.state);
											setDraft(prompt.content);
											setDraftAttachments([
												...prompt.attachments,
											]);
										}}
										ref={(element) => {
											if (element)
												setIcon(element, "pencil");
										}}
									/>
									<button
										type="button"
										title="Delete queued message"
										aria-label="Delete queued message"
										onClick={() => onRemove(prompt.id)}
										ref={(element) => {
											if (element)
												setIcon(element, "trash-2");
										}}
									/>
								</div>
							)}
						</article>
					);
				})}
			</div>
		</section>
	);
});
