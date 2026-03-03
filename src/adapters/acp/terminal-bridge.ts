import * as acp from "@agentclientprotocol/sdk";

import type { Logger } from "../../shared/logger";
import type { TerminalManager } from "./terminal-manager";
import type { AgentConfig } from "../../domain/ports/agent-client.port";

export function createTerminalOperation(args: {
	params: acp.CreateTerminalRequest;
	logger: Logger;
	terminalManager: TerminalManager;
	currentConfig: AgentConfig | null;
}): acp.CreateTerminalResponse {
	const { params, logger, terminalManager, currentConfig } = args;
	logger.log("[AcpAdapter] createTerminal called with params:", params);

	const modifiedParams = {
		...params,
		cwd: params.cwd || currentConfig?.workingDirectory || "",
	};
	logger.log("[AcpAdapter] Using modified params:", modifiedParams);

	const terminalId = terminalManager.createTerminal(modifiedParams);
	return { terminalId };
}

export function terminalOutputOperation(args: {
	params: acp.TerminalOutputRequest;
	terminalManager: TerminalManager;
}): acp.TerminalOutputResponse {
	const { params, terminalManager } = args;
	const result = terminalManager.getOutput(params.terminalId);
	if (!result) {
		throw new Error(`Terminal ${params.terminalId} not found`);
	}
	return result;
}

export async function waitForTerminalExitOperation(args: {
	params: acp.WaitForTerminalExitRequest;
	terminalManager: TerminalManager;
}): Promise<acp.WaitForTerminalExitResponse> {
	return await args.terminalManager.waitForExit(args.params.terminalId);
}

export function killTerminalOperation(args: {
	params: acp.KillTerminalCommandRequest;
	terminalManager: TerminalManager;
}): acp.KillTerminalCommandResponse {
	const success = args.terminalManager.killTerminal(args.params.terminalId);
	if (!success) {
		throw new Error(`Terminal ${args.params.terminalId} not found`);
	}
	return {};
}

export function releaseTerminalOperation(args: {
	params: acp.ReleaseTerminalRequest;
	logger: Logger;
	terminalManager: TerminalManager;
}): acp.ReleaseTerminalResponse {
	const { params, logger, terminalManager } = args;
	const success = terminalManager.releaseTerminal(params.terminalId);
	if (!success) {
		logger.log(
			`[AcpAdapter] releaseTerminal: Terminal ${params.terminalId} not found (may have been already cleaned up)`,
		);
	}
	return {};
}
