import { Platform } from "obsidian";
import {
	escapeShellArgBash,
	escapeShellArgWindows,
	getLoginShell,
} from "./shell-utils";
import { wrapCommandForWsl } from "./wsl-utils";

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
