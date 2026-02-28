import * as React from "react";
import { setIcon } from "obsidian";
import type AgentClientPlugin from "../../plugin";
import { getUiLanguage, t } from "../../shared/i18n";

/**
 * Attached image with unique ID for React key stability
 */
export interface AttachedImage {
	id: string;
	data: string;
	mimeType: string;
}

interface ImagePreviewStripProps {
	plugin: AgentClientPlugin;
	images: AttachedImage[];
	onRemove: (id: string) => void;
}

/**
 * Horizontal strip of image thumbnails with remove buttons.
 * Displays attached images before sending.
 */
export function ImagePreviewStrip({
	plugin,
	images,
	onRemove,
}: ImagePreviewStripProps) {
	if (images.length === 0) return null;
	const language = getUiLanguage(plugin.app);

	return (
		<div className="agent-client-image-preview-strip">
			{images.map((image) => (
				<div key={image.id} className="agent-client-image-preview-item">
					<img
						src={`data:${image.mimeType};base64,${image.data}`}
						alt={t(language, "attachedImage")}
						className="agent-client-image-preview-thumbnail"
					/>
					<button
						className="agent-client-image-preview-remove"
						onClick={() => onRemove(image.id)}
						title={t(language, "removeImage")}
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
