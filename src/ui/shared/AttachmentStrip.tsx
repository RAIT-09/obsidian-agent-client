import * as React from "react";
import { useRef, useEffect } from "react";
import { setIcon } from "obsidian";
import type { AttachedFile } from "../../types/chat";

interface AttachmentStripProps {
	files: AttachedFile[];
	onRemove: (id: string) => void;
}

/** Remove button with a stable ref so setIcon runs once on mount. */
function RemoveButton({
	fileId,
	onRemove,
}: {
	fileId: string;
	onRemove: (id: string) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "x");
	}, []);
	return (
		<button
			ref={ref}
			className="agent-client-attachment-preview-remove"
			onClick={() => onRemove(fileId)}
			title="Remove attachment"
			type="button"
		/>
	);
}

/** File icon with a stable ref so setIcon runs once on mount. */
function FileIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "file");
	}, []);
	return (
		<span
			ref={ref}
			className="agent-client-attachment-preview-file-icon"
		/>
	);
}

/**
 * Horizontal strip of attachment previews with remove buttons.
 * - Images: show thumbnail
 * - Files: show file icon with filename
 */
export function AttachmentStrip({ files, onRemove }: AttachmentStripProps) {
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
							<FileIcon />
							<span className="agent-client-attachment-preview-file-name">
								{file.name ?? "file"}
							</span>
						</div>
					)}
					<RemoveButton fileId={file.id} onRemove={onRemove} />
				</div>
			))}
		</div>
	);
}
