import { execSync } from "child_process";
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

/**
 * Cache for the full Windows PATH to avoid repeated registry queries.
 */
let cachedFullPath: string | null = null;

/**
 * Get the full Windows PATH environment variable from the registry.
 *
 * Electron apps launched from shortcuts don't inherit the full user PATH.
 * This function queries both system and user PATH from the registry
 * and combines them to get the complete PATH.
 *
 * @returns The full PATH string, or null if unable to retrieve
 */
export function getFullWindowsPath(): string | null {
	if (!Platform.isWin) {
		return null;
	}

	if (cachedFullPath !== null) {
		return cachedFullPath;
	}

	try {
		// Get system PATH from registry
		const systemPath = execSync(
			'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
			{ encoding: "utf8", windowsHide: true },
		);

		// Get user PATH from registry
		const userPath = execSync('reg query "HKCU\\Environment" /v Path', {
			encoding: "utf8",
			windowsHide: true,
		});

		// Parse the registry output to extract PATH values
		const systemPathValue = parseRegQueryOutput(systemPath);
		const userPathValue = parseRegQueryOutput(userPath);

		// Combine system and user PATH (user PATH typically comes first)
		const paths: string[] = [];
		if (userPathValue) {
			paths.push(userPathValue);
		}
		if (systemPathValue) {
			paths.push(systemPathValue);
		}

		cachedFullPath = paths.join(";");
		return cachedFullPath;
	} catch {
		// If registry query fails, return null
		return null;
	}
}

/**
 * Parse the output of `reg query` command to extract the PATH value.
 */
function parseRegQueryOutput(output: string): string | null {
	// Registry output format:
	// HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment
	//     Path    REG_EXPAND_SZ    C:\Windows\system32;C:\Windows;...
	const lines = output.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		// Look for lines containing "Path" and "REG_"
		if (trimmed.toLowerCase().startsWith("path")) {
			// Split by REG_SZ or REG_EXPAND_SZ and take the value part
			const match = trimmed.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
			if (match) {
				return match[1].trim();
			}
		}
	}
	return null;
}

/**
 * Get enhanced environment variables for Windows.
 *
 * This merges the current process.env with the full PATH from registry,
 * ensuring that executables like python, node, etc. can be found.
 *
 * @param baseEnv - The base environment variables to enhance
 * @returns Enhanced environment variables with full PATH
 */
export function getEnhancedWindowsEnv(
	baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	if (!Platform.isWin) {
		return baseEnv;
	}

	const fullPath = getFullWindowsPath();
	if (!fullPath) {
		return baseEnv;
	}

	// Merge the full PATH with any existing PATH modifications
	const existingPath = baseEnv.PATH || "";
	const existingPaths = existingPath.split(";").filter((p) => p.length > 0);
	const fullPaths = fullPath.split(";").filter((p) => p.length > 0);

	// Combine: keep existing modifications first, then add paths from registry
	// that aren't already present
	const combinedPaths = [...existingPaths];
	for (const p of fullPaths) {
		if (!combinedPaths.some((ep) => ep.toLowerCase() === p.toLowerCase())) {
			combinedPaths.push(p);
		}
	}

	return {
		...baseEnv,
		PATH: combinedPaths.join(";"),
	};
}

/**
 * Clear the cached PATH (useful for testing or when PATH might have changed).
 */
export function clearWindowsPathCache(): void {
	cachedFullPath = null;
}

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
 * Convert WSL path to Windows path format.
 * Example: /mnt/c/Users/name/vault → C:\Users\name\vault
 *
 * Note: This function is only called in WSL mode on Windows.
 */
export function convertWslPathToWindows(wslPath: string): string {
	const match = wslPath.match(/^\/mnt\/([a-zA-Z])\/(.*)/);

	if (match) {
		const driveLetter = match[1].toUpperCase();
		const pathPart = match[2].replace(/\//g, "\\");
		return `${driveLetter}:\\${pathPart}`;
	}

	return wslPath;
}

/**
 * Build a WSL shell wrapper that sources ~/.profile, detects the user's
 * $SHELL, and falls back to /bin/sh for non-POSIX shells (fish, elvish,
 * nushell, xonsh).
 *
 * IMPORTANT: wsl.exe pre-expands $VAR references using WSL environment
 * variables before passing them to the Linux shell. Intermediate variables
 * (e.g., s=$SHELL; exec $s) will NOT work because wsl.exe expands $s to
 * empty. Always reference $SHELL or ${SHELL:-/bin/sh} directly.
 *
 * @param innerCommand - The POSIX command to execute inside the login shell
 * @returns The full wrapper command string to pass as argument to `sh -c`
 */
export function buildWslShellWrapper(innerCommand: string): string {
	const innerEscaped = innerCommand.replace(/'/g, "'\\''");
	return (
		`. ~/.profile 2>/dev/null; ` +
		`case \${SHELL:-/bin/sh} in ` +
		`*/fish|*/elvish|*/nushell|*/xonsh) exec /bin/sh -l -c '${innerEscaped}';; ` +
		`*) exec \${SHELL:-/bin/sh} -l -c '${innerEscaped}';; ` +
		`esac`
	);
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
		// Validate distribution name (alphanumeric, dot, dash, underscore only)
		if (!/^[a-zA-Z0-9._-]+$/.test(distribution)) {
			throw new Error(`Invalid WSL distribution name: ${distribution}`);
		}
		wslArgs.push("-d", distribution);
	}

	// Build command to execute inside WSL
	// Use login shell (-l) to inherit PATH from user's shell profile
	const escapedArgs = args.map(escapeShellArgBash).join(" ");
	const argsString = escapedArgs.length > 0 ? ` ${escapedArgs}` : "";

	// Add additional PATH if provided (e.g., for Node.js)
	let pathPrefix = "";
	if (additionalPath) {
		const wslPath = convertWindowsPathToWsl(additionalPath);
		// Quote PATH value to handle paths with spaces
		pathPrefix = `export PATH="${escapePathForShell(wslPath)}:$PATH"; `;
	}

	const innerCommand = `${pathPrefix}cd ${escapeShellArgBash(wslCwd)} && ${command}${argsString}`;
	wslArgs.push("sh", "-c", buildWslShellWrapper(innerCommand));

	return {
		command: "C:\\Windows\\System32\\wsl.exe",
		args: wslArgs,
	};
}

/**
 * Escape a path value for use in shell PATH variable (double-quoted context).
 * Escapes double quotes and backslashes for use within double quotes.
 */
function escapePathForShell(path: string): string {
	return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Result of platform-specific command preparation.
 */
export interface PreparedCommand {
	/** The command to pass to spawn() */
	command: string;
	/** The arguments to pass to spawn() */
	args: string[];
	/** Whether spawn() should use shell: true (Windows non-WSL only) */
	needsShell: boolean;
}

/**
 * Prepare a command for execution by wrapping it in the appropriate
 * platform-specific shell.
 *
 * - **WSL**: Wraps via wrapCommandForWsl (wsl.exe → sh -c → login shell)
 * - **macOS/Linux**: Wraps in login shell (-l -c) with optional PATH injection
 * - **Windows non-WSL**: Escapes for cmd.exe (shell: true)
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param cwd - Working directory
 * @param options - Platform and configuration options
 * @returns Prepared command ready for spawn()
 */
export function prepareShellCommand(
	command: string,
	args: string[],
	cwd: string,
	options: {
		/** Whether WSL mode is enabled (Windows only) */
		wslMode: boolean;
		/** WSL distribution name */
		wslDistribution?: string;
		/** Node.js directory to inject into PATH (absolute path only) */
		nodeDir?: string;
		/**
		 * When true, always escape command and args with single quotes.
		 * When false, pass command as-is if args is empty (allows shell
		 * to parse pipes, &&, etc. in tool_call commands).
		 * Default: true
		 */
		alwaysEscape?: boolean;
	},
): PreparedCommand {
	const alwaysEscape = options.alwaysEscape ?? true;

	// WSL mode (Windows only)
	if (Platform.isWin && options.wslMode) {
		const wrapped = wrapCommandForWsl(
			command,
			args,
			cwd,
			options.wslDistribution,
			options.nodeDir,
		);
		return {
			command: wrapped.command,
			args: wrapped.args,
			needsShell: false,
		};
	}

	// macOS / Linux — login shell
	if (Platform.isMacOS || Platform.isLinux) {
		const shell = getLoginShell();
		let commandString: string;
		if (args.length > 0 || alwaysEscape) {
			commandString = [command, ...args]
				.map(escapeShellArgBash)
				.join(" ");
		} else {
			commandString = command;
		}

		// Prepend PATH export if nodeDir is provided
		if (options.nodeDir) {
			const escapedNodeDir = options.nodeDir.replace(/'/g, "'\\''");
			commandString = `export PATH='${escapedNodeDir}':"$PATH"; ${commandString}`;
		}

		return {
			command: shell,
			args: ["-l", "-c", commandString],
			needsShell: false,
		};
	}

	// Windows (non-WSL) — cmd.exe
	if (args.length > 0 || alwaysEscape) {
		return {
			command: escapeShellArgWindows(command),
			args: args.map(escapeShellArgWindows),
			needsShell: true,
		};
	}
	return { command, args, needsShell: true };
}
