import { execFile } from "child_process";
import { Platform } from "obsidian";

/**
 * Resolve the absolute path of a command using `which` (macOS/Linux) or `where` (Windows).
 * If the command is already an absolute path, returns it as-is.
 * Runs asynchronously to avoid blocking the Electron main thread.
 *
 * @param command - Command name (e.g. "node", "claude") or absolute path
 * @returns Absolute path string, or null if not found
 */
export function resolveCommandPath(command: string): Promise<string | null> {
	if (!command || command.trim().length === 0) return Promise.resolve(null);

	const trimmed = command.trim();

	// Already absolute — return as-is
	if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
		return Promise.resolve(trimmed);
	}

	return new Promise((resolve) => {
		if (Platform.isWin) {
			execFile("where", [trimmed], { timeout: 5000, windowsHide: true }, (err, stdout) => {
				if (err) { resolve(null); return; }
				const resolved = stdout.split("\n")[0].trim();
				resolve(resolved.length > 0 ? resolved : null);
			});
		} else {
			// Use login shell to pick up nvm/mise/volta shims etc.
			const shell = process.env.SHELL || "/bin/sh";
			// Escape single quotes in the command name to prevent injection
			const escaped = trimmed.replace(/'/g, "'\\''");
			execFile(shell, ["-l", "-c", `which '${escaped}'`], { timeout: 5000 }, (err, stdout) => {
				if (err) { resolve(null); return; }
				const resolved = stdout.split("\n")[0].trim();
				resolve(resolved.length > 0 ? resolved : null);
			});
		}
	});
}

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

/**
 * Build a file URI from an absolute path.
 * Handles both Windows and Unix paths.
 *
 * @param absolutePath - Absolute file path
 * @returns file:// URI
 *
 * @example
 * buildFileUri("/Users/user/note.md") // "file:///Users/user/note.md"
 * buildFileUri("C:\\Users\\user\\note.md") // "file:///C:/Users/user/note.md"
 */
export function buildFileUri(absolutePath: string): string {
	// Normalize backslashes to forward slashes
	const normalizedPath = absolutePath.replace(/\\/g, "/");

	// Windows path (e.g., C:/Users/...)
	if (/^[A-Za-z]:/.test(normalizedPath)) {
		return `file:///${normalizedPath}`;
	}

	// Unix path (e.g., /Users/...)
	return `file://${normalizedPath}`;
}
