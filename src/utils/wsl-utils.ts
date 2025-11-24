/**
 * Convert Windows path to WSL path format.
 * Example: C:\Users\name\vault → /mnt/c/Users/name/vault
 *
 * Note: This function is only called in WSL mode on Windows.
 */
export function convertWindowsPathToWsl(windowsPath: string): string {
	// Normalize backslashes to forward slashes
	const normalized = windowsPath.replace(/\\/g, "/");

	// Match drive letter pattern: C:/... or C:\...
	const match = normalized.match(/^([A-Za-z]):(\/.*)/);

	if (match) {
		const driveLetter = match[1].toLowerCase();
		const pathPart = match[2];
		return `/mnt/${driveLetter}${pathPart}`;
	}

	return windowsPath;
}

/**
 * Wrap a command to run inside WSL using wsl.exe.
 * Generates wsl.exe command with proper arguments for executing commands in WSL environment.
 */
export function wrapCommandForWsl(
	command: string,
	args: string[],
	cwd: string,
	distribution?: string,
	additionalPath?: string,
): { command: string; args: string[] } {
	// Validate working directory path
	// Check for UNC paths (\\server\share) which are not supported by WSL
	if (/^\\\\/.test(cwd)) {
		throw new Error(
			`UNC paths are not supported in WSL mode: ${cwd}. Please use a local drive path.`,
		);
	}

	const wslCwd = convertWindowsPathToWsl(cwd);

	// Verify path conversion succeeded (if it was a Windows path with drive letter)
	// If conversion failed, wslCwd will be the same as cwd but still match Windows path pattern
	if (wslCwd === cwd && /^[A-Za-z]:[\\/]/.test(cwd)) {
		throw new Error(`Failed to convert Windows path to WSL format: ${cwd}`);
	}

	// Build wsl.exe arguments
	const wslArgs: string[] = [];

	// Specify WSL distribution if provided
	if (distribution) {
		// Validate distribution name (alphanumeric, dash, underscore only)
		if (!/^[a-zA-Z0-9_-]+$/.test(distribution)) {
			throw new Error(`Invalid WSL distribution name: ${distribution}`);
		}
		wslArgs.push("-d", distribution);
	}

	// Build command to execute inside WSL
	// Use login shell (-l) to inherit PATH from user's shell profile
	const escapedArgs = args.map(escapeShellArg).join(" ");
	const argsString = escapedArgs.length > 0 ? ` ${escapedArgs}` : "";

	// Add additional PATH if provided (e.g., for Node.js)
	let pathPrefix = "";
	if (additionalPath) {
		const wslPath = convertWindowsPathToWsl(additionalPath);
		// Quote PATH value to handle paths with spaces
		pathPrefix = `export PATH="${escapePathForShell(wslPath)}:$PATH"; `;
	}

	const fullCommand = `${pathPrefix}cd ${escapeShellArg(wslCwd)} && ${command}${argsString}`;
	wslArgs.push("bash", "-l", "-c", fullCommand);

	return {
		command: "C:\\Windows\\System32\\wsl.exe",
		args: wslArgs,
	};
}

/**
 * Escape a shell argument for Bash.
 * Wraps the argument in single quotes and escapes internal single quotes as '\''
 */
function escapeShellArg(arg: string): string {
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a path value for use in shell PATH variable (double-quoted context).
 * Escapes double quotes and backslashes for use within double quotes.
 */
function escapePathForShell(path: string): string {
	return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
