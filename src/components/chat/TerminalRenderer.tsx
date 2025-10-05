import * as React from "react";
const { useState, useRef, useEffect, useMemo } = React;
import type { IAcpClient } from "../../types/acp-types";
import { Logger } from "../../utils/logger";
import type AgentClientPlugin from "../../main";

interface TerminalRendererProps {
	terminalId: string;
	acpClient: IAcpClient | null;
	plugin: AgentClientPlugin;
}

export function TerminalRenderer({
	terminalId,
	acpClient,
	plugin,
}: TerminalRendererProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);
	const [output, setOutput] = useState("");
	const [exitStatus, setExitStatus] = useState<{
		exitCode: number | null;
		signal: string | null;
	} | null>(null);
	const [isRunning, setIsRunning] = useState(true);
	const [isCancelled, setIsCancelled] = useState(false);
	const intervalRef = useRef<number | null>(null);

	logger.log(
		`[TerminalRenderer] Component rendered for terminal ${terminalId}, acpClient: ${!!acpClient}`,
	);

	useEffect(() => {
		logger.log(
			`[TerminalRenderer] useEffect triggered for ${terminalId}, acpClient: ${!!acpClient}`,
		);
		if (!terminalId || !acpClient) return;

		const pollOutput = async () => {
			try {
				const result = await acpClient.terminalOutput({
					terminalId,
					sessionId: "",
				});
				logger.log(
					`[TerminalRenderer] Poll result for ${terminalId}:`,
					result,
				);
				setOutput(result.output);
				if (result.exitStatus) {
					setExitStatus({
						exitCode: result.exitStatus.exitCode ?? null,
						signal: result.exitStatus.signal ?? null,
					});
					setIsRunning(false);
					if (intervalRef.current) {
						window.clearInterval(intervalRef.current);
						intervalRef.current = null;
					}
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				logger.log(
					`[TerminalRenderer] Polling error for terminal ${terminalId}: ${errorMessage}`,
				);

				// If terminal not found and no exit status was captured, it was likely cancelled
				if (errorMessage.includes("not found") && !exitStatus) {
					setIsCancelled(true);
				}

				setIsRunning(false);
				if (intervalRef.current) {
					window.clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			}
		};

		// Start polling immediately
		pollOutput();

		// Set up polling interval with shorter interval to catch fast commands
		intervalRef.current = window.setInterval(pollOutput, 100);

		return () => {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [terminalId, acpClient, logger]); // Include acpClient and logger in dependencies

	// Separate effect to stop polling when no longer running
	useEffect(() => {
		if (!isRunning && intervalRef.current) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, [isRunning]);

	return (
		<div className="terminal-renderer">
			<div className="terminal-renderer-header">
				🖥️ Terminal {terminalId.slice(0, 8)}
				{isRunning ? (
					<span className="terminal-status running">● RUNNING</span>
				) : isCancelled ? (
					<span className="terminal-status cancelled">
						● CANCELLED
					</span>
				) : (
					<span className="terminal-status finished">● FINISHED</span>
				)}
			</div>

			<div className="terminal-renderer-output">
				{output || (isRunning ? "Waiting for output..." : "No output")}
			</div>

			{exitStatus && (
				<div
					className={`terminal-renderer-exit ${exitStatus.exitCode === 0 ? "success" : "error"}`}
				>
					Exit Code: {exitStatus.exitCode}
					{exitStatus.signal && ` | Signal: ${exitStatus.signal}`}
				</div>
			)}
		</div>
	);
}
