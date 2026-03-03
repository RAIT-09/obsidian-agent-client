import { spawn, ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type {
	AgentConfig,
	InitializeResult,
} from "../../domain/ports/agent-client.port";
import type { ProcessError } from "../../domain/models/agent-error";
import type { Logger } from "../../shared/logger";
import { wrapCommandForWsl } from "../../shared/wsl-utils";
import { resolveCommandDirectory } from "../../shared/path-utils";
import { getEnhancedWindowsEnv } from "../../shared/windows-env";
import {
	BUILTIN_AGENT_DEFAULT_COMMANDS,
	escapeShellArgWindows,
	getLoginShell,
} from "../../shared/shell-utils";

export interface InitializeOperationResult {
	connection: acp.ClientSideConnection;
	agentProcess: ChildProcess;
	initializeResult: InitializeResult;
}

export async function initializeOperation(args: {
	config: AgentConfig;
	logger: Logger;
	pluginVersion: string;
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	nodePath: string;
	allowTerminalCommands: boolean;
	onError: (error: ProcessError) => void;
	clientFactory: (
		stream: ReturnType<typeof acp.ndJsonStream>,
	) => acp.ClientSideConnection;
	onStderrData: (chunk: string) => void;
	getErrorInfo: (
		error: Error,
		command: string,
		agentLabel: string,
	) => { title: string; message: string; suggestion: string };
	getCommandNotFoundSuggestion: (command: string) => string;
}): Promise<InitializeOperationResult> {
	const {
		config,
		logger,
		pluginVersion,
		windowsWslMode,
		windowsWslDistribution,
		nodePath,
		allowTerminalCommands,
		onError,
		clientFactory,
		onStderrData,
		getErrorInfo,
		getCommandNotFoundSuggestion,
	} = args;

	let command = config.command?.trim() || "";

	if (command.length === 0) {
		const defaultCommand = BUILTIN_AGENT_DEFAULT_COMMANDS[config.id];
		if (defaultCommand) {
			command = defaultCommand;
			logger.log(
				`[AcpAdapter] No command configured for "${config.displayName}", using default: ${defaultCommand}`,
			);
		} else {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id}). Please configure the agent command in settings.`,
			);
		}
	}
	const commandArgs = config.args.length > 0 ? [...config.args] : [];
	logger.log(`[AcpAdapter] Active agent: ${config.displayName} (${config.id})`);
	logger.log("[AcpAdapter] Command:", command);
	logger.log(
		"[AcpAdapter] Args:",
		commandArgs.length > 0 ? commandArgs.join(" ") : "(none)",
	);

	let baseEnv: NodeJS.ProcessEnv = { ...process.env, ...(config.env || {}) };
	if (Platform.isWin && !windowsWslMode) {
		baseEnv = getEnhancedWindowsEnv(baseEnv);
	}

	if (nodePath && nodePath.trim().length > 0) {
		const nodeDir = resolveCommandDirectory(nodePath.trim());
		if (nodeDir) {
			const separator = Platform.isWin ? ";" : ":";
			baseEnv.PATH = baseEnv.PATH
				? `${nodeDir}${separator}${baseEnv.PATH}`
				: nodeDir;
		}
	}

	logger.log(
		"[AcpAdapter] Starting agent process in directory:",
		config.workingDirectory,
	);

	let spawnCommand = command;
	let spawnArgs = commandArgs;
	if (Platform.isWin && windowsWslMode) {
		const nodeDir = nodePath
			? resolveCommandDirectory(nodePath.trim()) || undefined
			: undefined;
		const wslWrapped = wrapCommandForWsl(
			command,
			commandArgs,
			config.workingDirectory,
			windowsWslDistribution,
			nodeDir,
		);
		spawnCommand = wslWrapped.command;
		spawnArgs = wslWrapped.args;
		logger.log(
			"[AcpAdapter] Using WSL mode:",
			windowsWslDistribution || "default",
			"with command:",
			spawnCommand,
			spawnArgs,
		);
	} else if (Platform.isMacOS || Platform.isLinux) {
		const shell = getLoginShell();
		const commandString = [command, ...commandArgs]
			.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
			.join(" ");

		let fullCommand = commandString;
		if (nodePath && nodePath.trim().length > 0) {
			const nodeDir = resolveCommandDirectory(nodePath.trim());
			if (nodeDir) {
				const escapedNodeDir = nodeDir.replace(/'/g, "'\\''");
				fullCommand = `export PATH='${escapedNodeDir}':"$PATH"; ${commandString}`;
			}
		}
		spawnCommand = shell;
		spawnArgs = ["-l", "-c", fullCommand];
		logger.log(
			"[AcpAdapter] Using login shell:",
			shell,
			"with command:",
			fullCommand,
		);
	} else if (Platform.isWin) {
		spawnCommand = escapeShellArgWindows(command);
		spawnArgs = commandArgs.map(escapeShellArgWindows);
		logger.log(
			"[AcpAdapter] Using Windows shell with command:",
			spawnCommand,
			spawnArgs,
		);
	}

	const needsShell = Platform.isWin && !windowsWslMode;
	const agentProcess = spawn(spawnCommand, spawnArgs, {
		stdio: ["pipe", "pipe", "pipe"],
		env: baseEnv,
		cwd: config.workingDirectory,
		shell: needsShell,
	});
	const agentLabel = `${config.displayName} (${config.id})`;

	agentProcess.on("spawn", () => {
		logger.log(
			`[AcpAdapter] ${agentLabel} process spawned successfully, PID:`,
			agentProcess.pid,
		);
	});

	agentProcess.on("error", (error) => {
		logger.error(`[AcpAdapter] ${agentLabel} process error:`, error);
		const processError: ProcessError = {
			type: "spawn_failed",
			agentId: config.id,
			errorCode: (error as NodeJS.ErrnoException).code,
			originalError: error,
			...getErrorInfo(error, command, agentLabel),
		};
		onError(processError);
	});

	agentProcess.on("exit", (code, signal) => {
		logger.log(
			`[AcpAdapter] ${agentLabel} process exited with code:`,
			code,
			"signal:",
			signal,
		);

		if (code === 127) {
			logger.error(`[AcpAdapter] Command not found: ${command}`);
			onError({
				type: "command_not_found",
				agentId: config.id,
				exitCode: code,
				title: "Command Not Found",
				message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
				suggestion: getCommandNotFoundSuggestion(command),
			});
		}
	});

	agentProcess.on("close", (code, signal) => {
		logger.log(
			`[AcpAdapter] ${agentLabel} process closed with code:`,
			code,
			"signal:",
			signal,
		);
	});

	agentProcess.stderr?.setEncoding("utf8");
	agentProcess.stderr?.on("data", (data) => {
		logger.log(`[AcpAdapter] ${agentLabel} stderr:`, data);
		onStderrData(String(data));
	});

	if (!agentProcess.stdin || !agentProcess.stdout) {
		throw new Error("Agent process stdin/stdout not available");
	}

	const stdin = agentProcess.stdin;
	const stdout = agentProcess.stdout;
	const input = new WritableStream<Uint8Array>({
		write(chunk: Uint8Array) {
			stdin.write(chunk);
		},
		close() {
			stdin.end();
		},
	});
	const output = new ReadableStream<Uint8Array>({
		start(controller) {
			stdout.on("data", (chunk: Uint8Array) => {
				controller.enqueue(chunk);
			});
			stdout.on("end", () => {
				controller.close();
			});
		},
	});

	logger.log("[AcpAdapter] Using working directory:", config.workingDirectory);
	const stream = acp.ndJsonStream(input, output);
	const connection = clientFactory(stream);
	logger.log("[AcpAdapter] Starting ACP initialization...");
	const initResult = await connection.initialize({
		protocolVersion: acp.PROTOCOL_VERSION,
		clientCapabilities: {
			fs: {
				readTextFile: false,
				writeTextFile: false,
			},
			terminal: allowTerminalCommands,
		},
		clientInfo: {
			name: "obsius",
			title: "Obsius",
			version: pluginVersion,
		},
	});

	logger.log(
		`[AcpAdapter] ✅ Connected to agent (protocol v${initResult.protocolVersion})`,
	);
	logger.log("[AcpAdapter] Auth methods:", initResult.authMethods);
	logger.log("[AcpAdapter] Agent capabilities:", initResult.agentCapabilities);

	const promptCaps = initResult.agentCapabilities?.promptCapabilities;
	const mcpCaps = initResult.agentCapabilities?.mcpCapabilities;
	const sessionCaps = initResult.agentCapabilities?.sessionCapabilities;
	return {
		connection,
		agentProcess,
		initializeResult: {
			protocolVersion: initResult.protocolVersion,
			authMethods: initResult.authMethods || [],
			promptCapabilities: {
				image: promptCaps?.image ?? false,
				audio: promptCaps?.audio ?? false,
				embeddedContext: promptCaps?.embeddedContext ?? false,
			},
			agentCapabilities: {
				loadSession: initResult.agentCapabilities?.loadSession ?? false,
				sessionCapabilities: sessionCaps
					? {
							resume: sessionCaps.resume ?? undefined,
							fork: sessionCaps.fork ?? undefined,
							list: sessionCaps.list ?? undefined,
						}
					: undefined,
				mcpCapabilities: mcpCaps
					? {
							http: mcpCaps.http ?? false,
							sse: mcpCaps.sse ?? false,
						}
					: undefined,
				promptCapabilities: {
					image: promptCaps?.image ?? false,
					audio: promptCaps?.audio ?? false,
					embeddedContext: promptCaps?.embeddedContext ?? false,
				},
			},
			agentInfo: initResult.agentInfo
				? {
						name: initResult.agentInfo.name,
						title: initResult.agentInfo.title ?? undefined,
						version: initResult.agentInfo.version ?? undefined,
					}
				: undefined,
		},
	};
}
