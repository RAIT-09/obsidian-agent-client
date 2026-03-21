import { spawn, ChildProcess, SpawnOptions } from "child_process";
import type AgentClientPlugin from "../../plugin";
import { getLogger, Logger } from "../../shared/logger";
import { Platform } from "obsidian";
import { resolveNodeDirectory } from "../../shared/path-utils";
import { getEnhancedWindowsEnv } from "../../shared/windows-env";
import { prepareShellCommand } from "../../shared/command-builder";

/**
 * Parameters for creating a terminal process.
 *
 * This is the TerminalManager's own parameter type, independent of the ACP SDK.
 * The AcpAdapter is responsible for converting ACP protocol types to this format.
 */
interface CreateTerminalParams {
	/** The command to execute */
	command: string;
	/** Command arguments */
	args?: string[];
	/** Working directory for the command (absolute path) */
	cwd?: string;
	/** Environment variables as name-value pairs */
	env?: Array<{ name: string; value: string }>;
	/** Maximum number of output bytes to retain */
	outputByteLimit?: number;
}

interface TerminalProcess {
	id: string;
	process: ChildProcess;
	output: string;
	exitStatus: { exitCode: number | null; signal: string | null } | null;
	outputByteLimit?: number;
	waitPromises: Array<
		(exitStatus: { exitCode: number | null; signal: string | null }) => void
	>;
	cleanupTimeout?: number;
}

export class TerminalManager {
	private terminals = new Map<string, TerminalProcess>();
	private logger: Logger;
	private plugin: AgentClientPlugin;

	constructor(plugin: AgentClientPlugin) {
		this.logger = getLogger();
		this.plugin = plugin;
	}

	createTerminal(params: CreateTerminalParams): string {
		const terminalId = crypto.randomUUID();

		// Check current platform
		if (!Platform.isDesktopApp) {
			throw new Error("Agent Client is only available on desktop");
		}

		// Set up environment variables
		// Desktop-only: Node.js process environment for terminal operations
		let env: NodeJS.ProcessEnv = { ...process.env };

		// On Windows (non-WSL mode), enhance PATH with full system/user PATH from registry.
		// Electron apps launched from shortcuts don't inherit the full PATH.
		if (Platform.isWin && !this.plugin.settings.windowsWslMode) {
			env = getEnhancedWindowsEnv(env);
		}

		if (params.env) {
			for (const envVar of params.env) {
				env[envVar.name] = envVar.value;
			}
		}

		// Handle command parsing
		let command = params.command;
		let args = params.args || [];

		// Platform-specific shell wrapping
		const nodeDir = resolveNodeDirectory(this.plugin.settings.nodePath);
		const prepared = prepareShellCommand(
			command,
			args,
			params.cwd || process.cwd(),
			{
				wslMode: this.plugin.settings.windowsWslMode,
				wslDistribution: this.plugin.settings.windowsWslDistribution,
				nodeDir,
				alwaysEscape: false,
			},
		);
		command = prepared.command;
		args = prepared.args;
		const needsShell = prepared.needsShell;

		this.logger.log(`[Terminal ${terminalId}] Creating terminal:`, {
			command,
			args,
			cwd: params.cwd,
		});

		// Spawn the process
		const spawnOptions: SpawnOptions = {
			cwd: params.cwd || undefined,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: needsShell,
		};
		const childProcess = spawn(command, args, spawnOptions);

		const terminal: TerminalProcess = {
			id: terminalId,
			process: childProcess,
			output: "",
			exitStatus: null,
			outputByteLimit:
				params.outputByteLimit !== undefined
					? Number(params.outputByteLimit)
					: undefined,
			waitPromises: [],
		};

		// Handle spawn errors
		childProcess.on("error", (error) => {
			this.logger.log(
				`[Terminal ${terminalId}] Process error:`,
				error.message,
			);
			// Set exit status to indicate failure
			const exitStatus = { exitCode: 127, signal: null }; // 127 = command not found
			terminal.exitStatus = exitStatus;
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});

		// Capture stdout and stderr
		childProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stdout:`, output);
			this.appendOutput(terminal, output);
		});

		childProcess.stderr?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stderr:`, output);
			this.appendOutput(terminal, output);
		});

		// Handle process exit
		childProcess.on("exit", (code, signal) => {
			this.logger.log(
				`[Terminal ${terminalId}] Process exited with code: ${code}, signal: ${signal}`,
			);
			const exitStatus = { exitCode: code, signal };
			terminal.exitStatus = exitStatus;
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});

		this.terminals.set(terminalId, terminal);
		return terminalId;
	}

	private appendOutput(terminal: TerminalProcess, data: string): void {
		terminal.output += data;

		// Apply output byte limit if specified
		if (
			terminal.outputByteLimit &&
			Buffer.byteLength(terminal.output, "utf8") >
				terminal.outputByteLimit
		) {
			// Truncate from the beginning, ensuring we stay at character boundaries
			const bytes = Buffer.from(terminal.output, "utf8");
			const truncatedBytes = bytes.subarray(
				bytes.length - terminal.outputByteLimit,
			);
			terminal.output = truncatedBytes.toString("utf8");
		}
	}

	getOutput(terminalId: string): {
		output: string;
		truncated: boolean;
		exitStatus: { exitCode: number | null; signal: string | null } | null;
	} | null {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return null;

		return {
			output: terminal.output,
			truncated: terminal.outputByteLimit
				? Buffer.byteLength(terminal.output, "utf8") >=
					terminal.outputByteLimit
				: false,
			exitStatus: terminal.exitStatus,
		};
	}

	waitForExit(
		terminalId: string,
	): Promise<{ exitCode: number | null; signal: string | null }> {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return Promise.reject(
				new Error(`Terminal ${terminalId} not found`),
			);
		}

		if (terminal.exitStatus) {
			return Promise.resolve(terminal.exitStatus);
		}

		return new Promise((resolve) => {
			terminal.waitPromises.push(resolve);
		});
	}

	killTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return false;

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}
		return true;
	}

	releaseTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return false;

		this.logger.log(`[Terminal ${terminalId}] Releasing terminal`);
		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}

		// Schedule cleanup after 30 seconds to allow UI to poll final output
		terminal.cleanupTimeout = window.setTimeout(() => {
			this.logger.log(
				`[Terminal ${terminalId}] Cleaning up terminal after grace period`,
			);
			this.terminals.delete(terminalId);
		}, 30000);

		return true;
	}

	killAllTerminals(): void {
		this.logger.log(`Killing ${this.terminals.size} running terminals...`);
		this.terminals.forEach((terminal, terminalId) => {
			// Clear cleanup timeout if scheduled
			if (terminal.cleanupTimeout) {
				window.clearTimeout(terminal.cleanupTimeout);
			}
			if (!terminal.exitStatus) {
				this.logger.log(`Killing terminal ${terminalId}`);
				this.killTerminal(terminalId);
			}
		});
		// Clear all terminals
		this.terminals.clear();
	}
}
