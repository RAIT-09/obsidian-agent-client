import * as React from "react";
import { setIcon } from "obsidian";
import type { AttachedFile } from "../domain/models/chat-input-state";

interface AttachmentPreviewStripProps {
	files: AttachedFile[];
	onRemove: (id: string) => void;
}

/**
 * Horizontal strip of attachment previews with remove buttons.
 * - Images: show thumbnail
 * - Files: show file icon with filename
 */
export function AttachmentPreviewStrip({
	files,
	onRemove,
}: AttachmentPreviewStripProps) {
	if (files.length === 0) return null;

	return (
		<div className="agent-client-attachment-preview-strip">
			{files.map((file) => (
				<div
					key={file.id}
					className="agent-client-attachment-preview-item"
				>
					{file.kind === "image" && file.data ? (
						<img
							src={`data:${file.mimeType};base64,${file.data}`}
							alt="Attached image"
							className="agent-client-attachment-preview-thumbnail"
						/>
					) : (
						<div className="agent-client-attachment-preview-file">
							<span
								className="agent-client-attachment-preview-file-icon"
								ref={(el) => {
									if (el) setIcon(el, "file");
								}}
							/>
							<span className="agent-client-attachment-preview-file-name">
								{file.name ?? "file"}
							</span>
						</div>
					)}
					<button
						className="agent-client-attachment-preview-remove"
						onClick={() => onRemove(file.id)}
						title="Remove attachment"
						type="button"
						ref={(el) => {
							if (el) setIcon(el, "x");
						}}
					/>
				</div>
			))}
		</div>
	);
}
