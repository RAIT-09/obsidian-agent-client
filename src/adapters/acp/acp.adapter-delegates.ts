import * as acp from "@agentclientprotocol/sdk";
import type { TerminalOutputSnapshot } from "../../domain/models/terminal-output";
import type {
	ForkSessionResult,
	ListSessionsResult,
	LoadSessionResult,
	ResumeSessionResult,
} from "../../domain/models/session-info";
import type { TerminalManager } from "./terminal-manager";
import type { Logger } from "../../shared/logger";
import type { AgentConfig } from "../../domain/ports/agent-client.port";
import {
	createTerminalOperation,
	killTerminalOperation,
	releaseTerminalOperation,
	terminalOutputOperation,
	waitForTerminalExitOperation,
} from "./terminal-bridge";
import {
	forkSessionOperation,
	listSessionsOperation,
	loadSessionOperation,
	resumeSessionOperation,
} from "./session-ops";

export function getTerminalOutputSnapshot(args: {
	terminalId: string;
	sessionId: string;
	terminalManager: TerminalManager;
}): TerminalOutputSnapshot {
	const output = terminalOutputOperation({
		params: {
			terminalId: args.terminalId,
			sessionId: args.sessionId,
		},
		terminalManager: args.terminalManager,
	});

	return {
		output: output.output,
		exitStatus: output.exitStatus
			? {
					exitCode: output.exitStatus.exitCode ?? null,
					signal: output.exitStatus.signal ?? null,
				}
			: undefined,
	};
}

export function createTerminalViaBridge(args: {
	params: acp.CreateTerminalRequest;
	logger: Logger;
	terminalManager: TerminalManager;
	currentConfig: AgentConfig | null;
}): acp.CreateTerminalResponse {
	return createTerminalOperation(args);
}

export function terminalOutputViaBridge(args: {
	params: acp.TerminalOutputRequest;
	terminalManager: TerminalManager;
}): acp.TerminalOutputResponse {
	return terminalOutputOperation(args);
}

export async function waitForTerminalExitViaBridge(args: {
	params: acp.WaitForTerminalExitRequest;
	terminalManager: TerminalManager;
}): Promise<acp.WaitForTerminalExitResponse> {
	return await waitForTerminalExitOperation(args);
}

export function killTerminalViaBridge(args: {
	params: acp.KillTerminalCommandRequest;
	terminalManager: TerminalManager;
}): acp.KillTerminalCommandResponse {
	return killTerminalOperation(args);
}

export function releaseTerminalViaBridge(args: {
	params: acp.ReleaseTerminalRequest;
	logger: Logger;
	terminalManager: TerminalManager;
}): acp.ReleaseTerminalResponse {
	return releaseTerminalOperation(args);
}

export async function listSessionsViaBridge(args: {
	connection: acp.ClientSideConnection | null;
	logger: Logger;
	windowsWslMode: boolean;
	cwd?: string;
	cursor?: string;
}): Promise<ListSessionsResult> {
	return await listSessionsOperation(args);
}

export async function loadSessionViaBridge(args: {
	connection: acp.ClientSideConnection | null;
	logger: Logger;
	windowsWslMode: boolean;
	sessionId: string;
	cwd: string;
}): Promise<LoadSessionResult> {
	return await loadSessionOperation(args);
}

export async function resumeSessionViaBridge(args: {
	connection: acp.ClientSideConnection | null;
	logger: Logger;
	windowsWslMode: boolean;
	sessionId: string;
	cwd: string;
}): Promise<ResumeSessionResult> {
	return await resumeSessionOperation(args);
}

export async function forkSessionViaBridge(args: {
	connection: acp.ClientSideConnection | null;
	logger: Logger;
	windowsWslMode: boolean;
	sessionId: string;
	cwd: string;
}): Promise<ForkSessionResult> {
	return await forkSessionOperation(args);
}
