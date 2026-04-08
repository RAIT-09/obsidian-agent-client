import * as React from "react";
const { useState, useRef, useEffect } = React;
import type { AcpClient } from "../acp/acp-client";
import { getLogger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
interface TerminalBlockProps {
	terminalId: string;
	terminalClient: AcpClient | null;
	plugin: AgentClientPlugin;
}

export const TerminalBlock = React.memo(function TerminalBlock({
	terminalId,
	terminalClient,
	plugin,
}: TerminalBlockProps) {
	const logger = getLogger();
	const [output, setOutput] = useState("");
	const [exitStatus, setExitStatus] = useState<{
		exitCode: number | null;
		signal: string | null;
	} | null>(null);
	const [isRunning, setIsRunning] = useState(true);
	const intervalRef = useRef<number | null>(null);

	logger.log(
		`[TerminalBlock] Component rendered for terminal ${terminalId}, terminalClient: ${!!terminalClient}`,
	);

	useEffect(() => {
		logger.log(
			`[TerminalBlock] useEffect triggered for ${terminalId}, terminalClient: ${!!terminalClient}`,
		);
		if (!terminalId || !terminalClient) return;

		const pollOutput = async () => {
			try {
				const result =
					await terminalClient.getTerminalOutput(terminalId);
				logger.log(
					`[TerminalBlock] Poll result for ${terminalId}:`,
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
					`[TerminalBlock] Polling error for terminal ${terminalId}: ${errorMessage}`,
				);

				setIsRunning(false);
				if (intervalRef.current) {
					window.clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			}
		};

		// Start polling immediately
		void pollOutput();

		// Set up polling interval with shorter interval to catch fast commands
		intervalRef.current = window.setInterval(() => {
			void pollOutput();
		}, 100);

		return () => {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [terminalId, terminalClient, logger]);

	// Separate effect to stop polling when no longer running
	useEffect(() => {
		if (!isRunning && intervalRef.current) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, [isRunning]);

	return (
		<div className="agent-client-terminal-renderer">
			{output || (isRunning ? "Waiting for output..." : "No output")}

			{exitStatus && (
				<div
					className={`agent-client-terminal-renderer-exit ${exitStatus.exitCode === 0 ? "agent-client-success" : "agent-client-error"}`}
				>
					Exit Code: {exitStatus.exitCode}
					{exitStatus.signal && ` | Signal: ${exitStatus.signal}`}
				</div>
			)}
		</div>
	);
});
