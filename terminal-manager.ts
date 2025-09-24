import { spawn, ChildProcess } from "child_process";
import * as acp from "@zed-industries/agent-client-protocol";

interface TerminalProcess {
	id: string;
	process: ChildProcess;
	output: string;
	exitStatus: { exitCode: number | null; signal: string | null } | null;
	outputByteLimit?: number;
	waitPromises: Array<
		(exitStatus: { exitCode: number | null; signal: string | null }) => void
	>;
}

export class TerminalManager {
	private terminals = new Map<string, TerminalProcess>();

	createTerminal(params: acp.CreateTerminalRequest): string {
		const terminalId = crypto.randomUUID();

		// Set up environment variables
		const env = { ...process.env };
		if (params.env) {
			for (const envVar of params.env) {
				env[envVar.name] = envVar.value;
			}
		}

		// Handle command parsing - if command contains spaces and no args provided,
		// split the command into command and args
		let command = params.command;
		let args = params.args || [];

		if (!params.args && params.command.includes(" ")) {
			const parts = params.command
				.split(" ")
				.filter((part) => part.length > 0);
			command = parts[0];
			args = parts.slice(1);
		}

		console.log(`[Terminal ${terminalId}] Creating terminal:`, {
			command,
			args,
			cwd: params.cwd,
		});

		// Spawn the process
		const childProcess = spawn(command, args, {
			cwd: params.cwd || undefined,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		} as any); // Type assertion to avoid complex spawn overload issues

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
			console.log(
				`[Terminal ${terminalId}] Process error:`,
				error.message,
			);
			// Set exit status to indicate failure
			terminal.exitStatus = { exitCode: 127, signal: null }; // 127 = command not found
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) =>
				resolve(terminal.exitStatus!),
			);
			terminal.waitPromises = [];
		});

		// Capture stdout and stderr
		childProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			console.log(`[Terminal ${terminalId}] stdout:`, output);
			this.appendOutput(terminal, output);
		});

		childProcess.stderr?.on("data", (data: Buffer) => {
			const output = data.toString();
			console.log(`[Terminal ${terminalId}] stderr:`, output);
			this.appendOutput(terminal, output);
		});

		// Handle process exit
		childProcess.on("exit", (code, signal) => {
			console.log(
				`[Terminal ${terminalId}] Process exited with code: ${code}, signal: ${signal}`,
			);
			terminal.exitStatus = { exitCode: code, signal };
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) =>
				resolve(terminal.exitStatus!),
			);
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

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}
		this.terminals.delete(terminalId);
		return true;
	}

	killAllTerminals(): void {
		console.log(`Killing ${this.terminals.size} running terminals...`);
		this.terminals.forEach((terminal, terminalId) => {
			if (!terminal.exitStatus) {
				console.log(`Killing terminal ${terminalId}`);
				this.killTerminal(terminalId);
			}
		});
	}
}
