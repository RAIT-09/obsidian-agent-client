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
