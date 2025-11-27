import { spawn, ChildProcess, SpawnOptions } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import type AgentClientPlugin from "../obsidian-plugin/plugin";
import { Logger } from "../../shared/logger";
import { Platform } from "obsidian";
import { wrapCommandForWsl } from "../../shared/wsl-utils";
import { resolveCommandDirectory } from "../../shared/path-utils";

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
		this.logger = new Logger(plugin);
		this.plugin = plugin;
	}

	createTerminal(params: acp.CreateTerminalRequest): string {
		const terminalId = crypto.randomUUID();

		// Check current platform
		if (!Platform.isDesktopApp) {
			throw new Error("Agent Client is only available on desktop");
		}

		// Set up environment variables
		// Desktop-only: Node.js process environment for terminal operations
		const env = { ...process.env };
		if (params.env) {
			for (const envVar of params.env) {
				env[envVar.name] = envVar.value;
			}
		}

		// Handle command parsing
		let command = params.command;
		let args = params.args || [];

		// If no args provided and command contains shell syntax, use shell to execute
		if (!params.args) {
			// Check for shell syntax (pipes, redirects, logical operators, etc.)
			const hasShellSyntax = /[|&;<>()$`\\"]/.test(params.command);

			if (hasShellSyntax) {
				// Use shell to execute the command
				const shell =
					Platform.isMacOS || Platform.isLinux
						? "/bin/sh"
						: "cmd.exe";
				const shellFlag =
					Platform.isMacOS || Platform.isLinux ? "-c" : "/c";
				command = shell;
				args = [shellFlag, params.command];
			} else if (params.command.includes(" ")) {
				// Simple command with arguments, split by space
				const parts = params.command
					.split(" ")
					.filter((part) => part.length > 0);
				command = parts[0];
				args = parts.slice(1);
			}
		}

		// WSL mode for Windows (wrap command to run inside WSL)
		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			// Extract node directory from settings for PATH (if available)
			const nodeDir = this.plugin.settings.nodePath
				? resolveCommandDirectory(
						this.plugin.settings.nodePath.trim(),
					) || undefined
				: undefined;

			const wslWrapped = wrapCommandForWsl(
				command,
				args,
				params.cwd || process.cwd(),
				this.plugin.settings.windowsWslDistribution,
				nodeDir,
			);
			command = wslWrapped.command;
			args = wslWrapped.args;
			this.logger.log(
				`[Terminal ${terminalId}] Using WSL mode:`,
				this.plugin.settings.windowsWslDistribution || "default",
			);
		}
		// On macOS and Linux, wrap the command in a login shell to inherit the user's environment
		else if (Platform.isMacOS || Platform.isLinux) {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const commandString = [command, ...args]
				.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
				.join(" ");
			command = shell;
			args = ["-l", "-c", commandString];
		}

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
		};
		const childProcess = spawn(command, args, spawnOptions);

		const terminal: TerminalProcess = {
			id: terminalId,
			process: childProcess,
			output: "",
			exitStatus: null,
			outputByteLimit: params.outputByteLimit ?? undefined,
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

	async killTerminal(terminalId: string): Promise<boolean> {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return false;

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");

			// Wait up to 3 seconds for graceful exit
			const exited = await Promise.race([
				new Promise<boolean>((resolve) => {
					terminal.process.once("exit", () => resolve(true));
				}),
				new Promise<boolean>((resolve) =>
					setTimeout(() => resolve(false), 3000),
				),
			]);

			// Force kill if still running
			if (!exited && !terminal.exitStatus) {
				terminal.process.kill("SIGKILL");
			}
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

	async killAllTerminals(): Promise<void> {
		this.logger.log(`Killing ${this.terminals.size} running terminals...`);

		const killPromises: Promise<boolean>[] = [];

		this.terminals.forEach((terminal, terminalId) => {
			// Clear cleanup timeout if scheduled
			if (terminal.cleanupTimeout) {
				window.clearTimeout(terminal.cleanupTimeout);
			}
			if (!terminal.exitStatus) {
				this.logger.log(`Killing terminal ${terminalId}`);
				killPromises.push(this.killTerminal(terminalId));
			}
		});

		// Wait for all kills to complete
		await Promise.all(killPromises);

		// Clear all terminals
		this.terminals.clear();
	}
}
