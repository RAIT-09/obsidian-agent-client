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
