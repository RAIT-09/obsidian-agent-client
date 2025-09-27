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
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (!terminalId || !acpClient) return;

		const pollOutput = async () => {
			try {
				const result = await (acpClient as any).terminalOutput({
					terminalId,
					sessionId: "",
				});
				setOutput(result.output);
				if (result.exitStatus) {
					setExitStatus({
						exitCode: result.exitStatus.exitCode ?? null,
						signal: result.exitStatus.signal ?? null,
					});
					setIsRunning(false);
					if (intervalRef.current) {
						clearInterval(intervalRef.current);
						intervalRef.current = null;
					}
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				// Check if the error is because terminal was not found (cancelled/killed)
				if (errorMessage.includes("not found")) {
					logger.log(
						`[TerminalRenderer] Terminal ${terminalId} was cancelled/killed, stopping polling`,
					);
					setIsCancelled(true);
				} else {
					// Log other errors but don't spam the console
					logger.log(
						`[TerminalRenderer] Polling stopped for terminal ${terminalId}: ${errorMessage}`,
					);
					setIsCancelled(true); // Treat any polling error as cancelled
				}

				setIsRunning(false);
				if (intervalRef.current) {
					clearInterval(intervalRef.current);
					intervalRef.current = null;
				}
			}
		};

		// Initial poll
		pollOutput();

		// Set up polling interval - will be cleared when isRunning becomes false
		intervalRef.current = setInterval(pollOutput, 500);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [terminalId, acpClient]); // Include acpClient in dependencies

	// Separate effect to stop polling when no longer running
	useEffect(() => {
		if (!isRunning && intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, [isRunning]);

	return (
		<div
			style={{
				padding: "12px",
				marginTop: "4px",
				backgroundColor: "var(--background-secondary)",
				border: "1px solid var(--background-modifier-border)",
				borderRadius: "8px",
				fontSize: "12px",
				fontFamily: "var(--font-monospace)",
				userSelect: "text",
			}}
		>
			<div
				style={{
					fontWeight: "bold",
					marginBottom: "8px",
					display: "flex",
					alignItems: "center",
					gap: "8px",
					fontFamily: "var(--font-interface)",
					userSelect: "text",
				}}
			>
				🖥️ Terminal {terminalId.slice(0, 8)}
				{isRunning ? (
					<span
						style={{
							color: "var(--color-green)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● RUNNING
					</span>
				) : isCancelled ? (
					<span
						style={{
							color: "var(--color-orange)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● CANCELLED
					</span>
				) : (
					<span
						style={{
							color: "var(--text-muted)",
							fontSize: "10px",
							userSelect: "text",
						}}
					>
						● FINISHED
					</span>
				)}
			</div>

			<div
				style={{
					backgroundColor: "var(--background-primary)",
					padding: "8px",
					borderRadius: "4px",
					border: "1px solid var(--background-modifier-border)",
					minHeight: "100px",
					maxHeight: "400px",
					overflow: "auto",
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					userSelect: "text",
				}}
			>
				{output || (isRunning ? "Waiting for output..." : "No output")}
			</div>

			{exitStatus && (
				<div
					style={{
						marginTop: "8px",
						padding: "4px 8px",
						backgroundColor:
							exitStatus.exitCode === 0
								? "var(--color-green)"
								: "var(--color-red)",
						color: "white",
						borderRadius: "4px",
						fontSize: "11px",
						fontFamily: "var(--font-interface)",
						userSelect: "text",
					}}
				>
					Exit Code: {exitStatus.exitCode}
					{exitStatus.signal && ` | Signal: ${exitStatus.signal}`}
				</div>
			)}
		</div>
	);
}
