import * as React from "react";
const { useCallback, useRef, useState } = React;
import { setIcon } from "obsidian";
import type { QueuedPrompt } from "../types/chat";

interface QueuedPromptListProps {
	prompts: QueuedPrompt[];
	isPaused: boolean;
	isSending: boolean;
	supportsSteering: boolean;
	editingId: string | null;
	onEdit: (prompt: QueuedPrompt) => void;
	onRemove: (id: string) => void;
	onResume: (expectedPauseRevision?: number) => void;
	onPause: () => number;
	onReorder: (draggedId: string, targetId: string) => void;
	onSteer: (id: string) => Promise<void>;
}

export const QueuedPromptList = React.memo(function QueuedPromptList({
	prompts,
	isPaused,
	isSending,
	supportsSteering,
	editingId,
	onEdit,
	onRemove,
	onResume,
	onPause,
	onReorder,
	onSteer,
}: QueuedPromptListProps) {
	const [draggedId, setDraggedId] = useState<string | null>(null);
	const [dropTargetId, setDropTargetId] = useState<string | null>(null);
	const [steeringId, setSteeringId] = useState<string | null>(null);
	const resumeAfterDragRef = useRef<number | null>(null);

	const finishDrag = useCallback(() => {
		setDraggedId(null);
		setDropTargetId(null);
		if (resumeAfterDragRef.current !== null) {
			const ownedPauseRevision = resumeAfterDragRef.current;
			resumeAfterDragRef.current = null;
			onResume(ownedPauseRevision);
		}
	}, [onResume]);

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
					<button type="button" onClick={() => onResume()}>
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
				{prompts.map((prompt) => {
					const isEditing = prompt.id === editingId;
					const canSteer =
						isSending && supportsSteering && !isEditing;
					const steerTitle = !supportsSteering
						? "This agent does not support mid-turn steering"
						: !isSending
							? "Steering is available while a turn is running"
							: "Steer the running turn with this message";
					return (
						<article
							key={prompt.id}
							className={`agent-client-queued-prompt${draggedId === prompt.id ? " is-dragging" : ""}${dropTargetId === prompt.id ? " is-drop-target" : ""}${isEditing ? " is-editing" : ""}`}
							onDragOver={(event) => {
								if (!draggedId || draggedId === prompt.id)
									return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								setDropTargetId(prompt.id);
							}}
							onDragLeave={() => {
								if (dropTargetId === prompt.id) {
									setDropTargetId(null);
								}
							}}
							onDrop={(event) => {
								event.preventDefault();
								if (draggedId && draggedId !== prompt.id) {
									onReorder(draggedId, prompt.id);
								}
								finishDrag();
							}}
						>
							<button
								type="button"
								className="agent-client-queued-prompt-drag-handle"
								draggable={!isEditing}
								disabled={isEditing}
								title="Drag to change queue priority"
								aria-label="Drag to change queue priority"
								onDragStart={(event) => {
									if (isEditing) {
										event.preventDefault();
										return;
									}
									event.dataTransfer.effectAllowed = "move";
									event.dataTransfer.setData(
										"text/plain",
										prompt.id,
									);
									setDraggedId(prompt.id);
									resumeAfterDragRef.current = !isPaused
										? onPause()
										: null;
								}}
								onDragEnd={finishDrag}
								ref={(element) => {
									if (element)
										setIcon(element, "grip-vertical");
								}}
							/>
							<div className="agent-client-queued-prompt-body">
								<div className="agent-client-queued-prompt-text">
									{prompt.content || "Attachment message"}
								</div>
								{prompt.attachments.length > 0 && (
									<div className="agent-client-queued-prompt-attachment-count">
										{prompt.attachments.length} attachment
										{prompt.attachments.length === 1
											? ""
											: "s"}
									</div>
								)}
								{isEditing && (
									<div className="agent-client-queued-prompt-editing-label">
										Editing in composer
									</div>
								)}
							</div>
							<div className="agent-client-queued-prompt-actions">
								<button
									type="button"
									title={steerTitle}
									aria-label={steerTitle}
									disabled={!canSteer || steeringId !== null}
									onClick={() => {
										setSteeringId(prompt.id);
										void onSteer(prompt.id).finally(() =>
											setSteeringId(null),
										);
									}}
									ref={(element) => {
										if (element)
											setIcon(
												element,
												steeringId === prompt.id
													? "loader-circle"
													: "navigation",
											);
									}}
								/>
								<button
									type="button"
									title="Edit queued message in composer"
									aria-label="Edit queued message in composer"
									disabled={isEditing}
									onClick={() => onEdit(prompt)}
									ref={(element) => {
										if (element) setIcon(element, "pencil");
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
						</article>
					);
				})}
			</div>
		</section>
	);
});
