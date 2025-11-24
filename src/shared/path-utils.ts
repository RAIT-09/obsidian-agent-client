/**
 * Extract the directory containing a command (for PATH adjustments).
 * Example: /usr/local/bin/node → /usr/local/bin
 *
 * @param command - Full path to a command
 * @returns Directory path, or null if cannot be determined
 */
export function resolveCommandDirectory(command: string): string | null {
	if (!command) {
		return null;
	}
	const lastSlash = Math.max(
		command.lastIndexOf("/"),
		command.lastIndexOf("\\"),
	);
	if (lastSlash <= 0) {
		return null;
	}
	return command.slice(0, lastSlash);
}

/**
 * Convert absolute path to relative path if it's under basePath.
 * Otherwise return the absolute path as-is.
 *
 * @param absolutePath - The absolute path to convert
 * @param basePath - The base path (e.g., vault path)
 * @returns Relative path if under basePath, otherwise absolute path
 */
export function toRelativePath(absolutePath: string, basePath: string): string {
	// Normalize paths (remove trailing slashes)
	const normalizedBase = basePath.replace(/\/+$/, "");
	const normalizedPath = absolutePath.replace(/\/+$/, "");

	if (normalizedPath.startsWith(normalizedBase + "/")) {
		return normalizedPath.slice(normalizedBase.length + 1);
	}
	return absolutePath;
}
