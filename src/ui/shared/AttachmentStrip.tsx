import * as React from "react";
import { useRef, useEffect } from "react";
import { setIcon } from "obsidian";
import type { AttachedFile } from "../../types/chat";

interface AttachmentStripProps {
	files: AttachedFile[];
	onRemove: (id: string) => void;
	onOpen?: (file: AttachedFile) => void;
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
		<span ref={ref} className="agent-client-attachment-preview-file-icon" />
	);
}

/**
 * Horizontal strip of attachment previews with remove buttons.
 * - Images: show thumbnail
 * - Files: show file icon with filename
 */
export function AttachmentStrip({
	files,
	onRemove,
	onOpen,
}: AttachmentStripProps) {
	if (files.length === 0) return null;

	return (
		<div className="agent-client-attachment-preview-strip">
			{files.map((file) => (
				<div
					key={file.id}
					className="agent-client-attachment-preview-item"
					title={file.vaultPath ?? file.path ?? file.name}
				>
					{file.kind === "image" && file.data ? (
						<img
							src={`data:${file.mimeType};base64,${file.data}`}
							alt="Attached image"
							className="agent-client-attachment-preview-thumbnail"
						/>
					) : (
						<button
							type="button"
							className="agent-client-attachment-preview-file"
							onClick={() => onOpen?.(file)}
							disabled={!file.vaultPath || !onOpen}
						>
							<FileIcon />
							<span className="agent-client-attachment-preview-file-labels">
								<span className="agent-client-attachment-preview-file-name">
									{file.name ?? "file"}
								</span>
								{file.vaultPath?.includes("/") && (
									<span className="agent-client-attachment-preview-file-path">
										{file.vaultPath.slice(
											0,
											file.vaultPath.lastIndexOf("/"),
										)}
									</span>
								)}
							</span>
						</button>
					)}
					<RemoveButton fileId={file.id} onRemove={onRemove} />
				</div>
			))}
		</div>
	);
}
