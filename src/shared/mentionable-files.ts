export const MENTIONABLE_FILE_EXTENSIONS = new Set([
	"md",
	"canvas",
	"excalidraw",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export function isMentionableExtension(extension: string): boolean {
	return MENTIONABLE_FILE_EXTENSIONS.has(extension.toLowerCase());
}

export function getImageMimeTypeForExtension(
	extension: string,
): string | undefined {
	return IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()];
}

export function getPathExtension(path: string): string {
	const dotIndex = path.lastIndexOf(".");
	if (dotIndex < 0) {
		return "";
	}
	return path.slice(dotIndex + 1).toLowerCase();
}
