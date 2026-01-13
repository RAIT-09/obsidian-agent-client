/**
 * Shell escaping utilities for different platforms.
 */

/**
 * Escape a shell argument for Windows cmd.exe.
 * Wraps the argument in double quotes and escapes special characters.
 *
 * In cmd.exe:
 * - Double quotes are escaped by doubling them: " → ""
 * - Percent signs are escaped by doubling them: % → %% (to prevent environment variable expansion)
 */
export function escapeShellArgWindows(arg: string): string {
	return `"${arg.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}
