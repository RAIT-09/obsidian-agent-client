import { Platform } from "obsidian";

/**
 * Shell escaping utilities for different platforms.
 */

/**
 * Escape a shell argument for Windows cmd.exe.
 * Only wraps in double quotes if the argument contains spaces or special characters.
 *
 * In cmd.exe:
 * - Double quotes are escaped by doubling them: " → ""
 * - Percent signs are escaped by doubling them: % → %% (to prevent environment variable expansion)
 */
export function escapeShellArgWindows(arg: string): string {
	// Escape percent signs and double quotes
	const escaped = arg.replace(/%/g, "%%").replace(/"/g, '""');

	// Only wrap in quotes if contains spaces or special characters that need quoting
	if (/[\s&()<>|^]/.test(arg)) {
		return `"${escaped}"`;
	}
	return escaped;
}

/**
 * Resolve the login shell for the current platform.
 * Uses $SHELL environment variable when available (covers NixOS, etc.),
 * falls back to platform defaults (/bin/zsh on macOS, /bin/sh on Linux).
 */
export function getLoginShell(): string {
	if (process.env.SHELL) {
		return process.env.SHELL;
	}
	return Platform.isMacOS ? "/bin/zsh" : "/bin/sh";
}

/**
 * Escape a shell argument for Bash/Zsh/POSIX shells.
 * Wraps the argument in single quotes and escapes internal single quotes
 * using the '\'' idiom (end quote, escaped quote, start quote).
 *
 * Example: hello'world → 'hello'\''world'
 */
export function escapeShellArgBash(arg: string): string {
	return `'${arg.replace(/'/g, "'\\''")}'`;
}
