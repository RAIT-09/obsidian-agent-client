import * as React from "react";
const { useState, useRef, useEffect } = React;
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import { getLogger } from "../../shared/logger";
import type AgentClientPlugin from "../../plugin";
import { CollapsibleSection } from "./CollapsibleSection";
import { ObsidianIcon } from "./ObsidianIcon";

interface TerminalRendererProps {
	terminalId: string;
	agentClient: IAgentClient | null;
	plugin: AgentClientPlugin;
}

export function TerminalRenderer({
	terminalId,
	agentClient,
	plugin,
}: TerminalRendererProps) {
	const logger = getLogger();
	const [output, setOutput] = useState("");
	const [exitStatus, setExitStatus] = useState<{
		exitCode: number | null;
		signal: string | null;
	} | null>(null);
	const [isRunning, setIsRunning] = useState(true);
	const [isCancelled, setIsCancelled] = useState(false);
	const intervalRef = useRef<number | null>(null);

	logger.log(
		`[TerminalRenderer] Component rendered for terminal ${terminalId}, agentClient: ${!!agentClient}`,
	);

	useEffect(() => {
		logger.log(
			`[TerminalRenderer] useEffect triggered for ${terminalId}, agentClient: ${!!agentClient}`,
		);
		if (!terminalId || !agentClient) return;

		const pollOutput = async () => {
			try {
				const result = await agentClient.getTerminalOutput(terminalId);
				logger.log(`[TerminalRenderer] Poll result for ${terminalId}:`, result);
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

		void pollOutput();

		intervalRef.current = window.setInterval(() => {
			void pollOutput();
		}, 100);

		return () => {
			if (intervalRef.current) {
				window.clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [terminalId, agentClient, logger]);

	useEffect(() => {
		if (!isRunning && intervalRef.current) {
			window.clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, [isRunning]);

	const statusClass = isRunning
		? "ac-tool-status--running"
		: isCancelled
			? "ac-tool-status--error"
			: "ac-tool-status--completed";
	const statusIconName = isRunning ? "" : isCancelled ? "x" : "check";

	const header = (
		<>
			<ObsidianIcon name="terminal" className="ac-tool-icon" />
			<span className="ac-row__title">Terminal</span>
			{exitStatus?.exitCode != null && (
				<span className="ac-row__summary">exit {exitStatus.exitCode}</span>
			)}
			<span className={`ac-tool-status ${statusClass}`}>
				{statusIconName && <ObsidianIcon name={statusIconName} size={14} />}
			</span>
		</>
	);

	return (
		<CollapsibleSection
			className="ac-terminal"
			defaultExpanded={false}
			header={header}
		>
			<div className="ac-tree__item">
				<pre className="ac-terminal__output">
					{output || (isRunning ? "Waiting for output..." : "No output")}
				</pre>
			</div>
			{exitStatus && (
				<div className="ac-tree__item">
					<span
						className={`ac-terminal__exit ${exitStatus.exitCode === 0 ? "ac-terminal__exit--ok" : "ac-terminal__exit--err"}`}
					>
						Exit Code: {exitStatus.exitCode}
						{exitStatus.signal && ` | Signal: ${exitStatus.signal}`}
					</span>
				</div>
			)}
		</CollapsibleSection>
	);
}
