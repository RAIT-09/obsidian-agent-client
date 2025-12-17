import * as React from "react";
import { setIcon } from "obsidian";

/**
 * Attached image with unique ID for React key stability
 */
export interface AttachedImage {
	id: string;
	data: string;
	mimeType: string;
}

interface ImagePreviewStripProps {
	images: AttachedImage[];
	onRemove: (id: string) => void;
}

/**
 * Horizontal strip of image thumbnails with remove buttons.
 * Displays attached images before sending.
 */
export function ImagePreviewStrip({
	images,
	onRemove,
}: ImagePreviewStripProps) {
	if (images.length === 0) return null;

	return (
		<div className="image-preview-strip">
			{images.map((image) => (
				<div key={image.id} className="image-preview-item">
					<img
						src={`data:${image.mimeType};base64,${image.data}`}
						alt="Attached image"
						className="image-preview-thumbnail"
					/>
					<button
						className="image-preview-remove"
						onClick={() => onRemove(image.id)}
						title="Remove image"
						type="button"
						ref={(el) => {
							if (el) {
								setIcon(el, "x");
							}
						}}
					/>
				</div>
			))}
		</div>
	);
}
