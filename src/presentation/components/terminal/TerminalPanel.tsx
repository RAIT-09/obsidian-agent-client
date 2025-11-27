// src/presentation/components/terminal/TerminalPanel.tsx

import * as React from "react";
const { useState, useEffect, useCallback, useRef } = React;
import { setIcon } from "obsidian";

import { useTerminal } from "../../hooks/useTerminal";
import type { PtyManager, PtyStatus } from "../../../infrastructure/pty";

export interface TerminalPanelProps {
	ptyManager: PtyManager;
	isActive: boolean;
	isPythonAvailable: boolean;
	claudePath: string;
	workingDirectory: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
	ptyManager,
	isActive,
	isPythonAvailable,
	claudePath,
	workingDirectory,
}) => {
	const [status, setStatus] = useState<PtyStatus>("idle");
	const [hasSpawned, setHasSpawned] = useState(false);
	const [showErrorBanner, setShowErrorBanner] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Icon refs for Obsidian setIcon
	const restartIconRef = useRef<HTMLButtonElement>(null);
	const clearIconRef = useRef<HTMLButtonElement>(null);
	const warningIconRef = useRef<HTMLSpanElement>(null);

	const { containerRef, isReady, clear, focus } = useTerminal({
		ptyManager,
		isActive,
		fontSize: 14,
		scrollback: 10000,
	});

	// Set icons using Obsidian's setIcon (targeting nested icon spans)
	useEffect(() => {
		if (restartIconRef.current) {
			const iconSpan = restartIconRef.current.querySelector(
				".terminal-toolbar-button-icon",
			);
			if (iconSpan) setIcon(iconSpan as HTMLElement, "refresh-cw");
		}
	}, []);

	useEffect(() => {
		if (clearIconRef.current) {
			const iconSpan = clearIconRef.current.querySelector(
				".terminal-toolbar-button-icon",
			);
			if (iconSpan) setIcon(iconSpan as HTMLElement, "trash-2");
		}
	}, []);

	useEffect(() => {
		if (warningIconRef.current) {
			setIcon(warningIconRef.current, "alert-triangle");
		}
	}, [isPythonAvailable]);

	// Track error state and show banner when process exits unexpectedly
	useEffect(() => {
		if (status === "error") {
			setShowErrorBanner(true);
			setErrorMessage("Process exited unexpectedly");
		} else if (status === "running") {
			setShowErrorBanner(false);
			setErrorMessage(null);
		}
	}, [status]);

	// Spawn Claude when terminal is ready and active for the first time
	useEffect(() => {
		if (isReady && isActive && !hasSpawned && isPythonAvailable) {
			setHasSpawned(true);
			ptyManager.spawnCommand(claudePath, [], workingDirectory);
		}
	}, [
		isReady,
		isActive,
		hasSpawned,
		isPythonAvailable,
		ptyManager,
		claudePath,
		workingDirectory,
	]);

	// Track PTY status via subscription
	useEffect(() => {
		return ptyManager.onStatusChange(setStatus);
	}, [ptyManager]);

	const handleRestart = useCallback(() => {
		ptyManager.kill();
		setTimeout(() => {
			ptyManager.spawnCommand(claudePath, [], workingDirectory);
		}, 100);
	}, [ptyManager, claudePath, workingDirectory]);

	const handleClear = useCallback(() => {
		clear();
	}, [clear]);

	const handleContainerClick = useCallback(() => {
		focus();
	}, [focus]);

	// Status label for display
	const getStatusLabel = (): string => {
		switch (status) {
			case "running":
				return "Running";
			case "starting":
				return "Starting...";
			case "error":
				return "Error";
			default:
				return "Idle";
		}
	};

	// Show unavailable message if Python not found
	if (!isPythonAvailable) {
		return (
			<div
				className="terminal-panel"
				role="region"
				aria-label="Terminal panel"
			>
				<div className="terminal-unavailable">
					<span ref={warningIconRef} aria-hidden="true" />
					<h3>Python 3 Required</h3>
					<p>
						Terminal mode requires Python 3 to be installed. Most
						macOS systems include Python 3 by default.
					</p>
					<a
						href="https://www.python.org/downloads/"
						target="_blank"
						rel="noopener noreferrer"
					>
						Install Python
					</a>
				</div>
			</div>
		);
	}

	return (
		<div
			className="terminal-panel"
			role="region"
			aria-label="Terminal panel"
		>
			<div
				className="terminal-toolbar"
				role="toolbar"
				aria-label="Terminal controls"
			>
				<button
					ref={restartIconRef}
					type="button"
					className="terminal-toolbar-button"
					onClick={handleRestart}
					title="Restart Claude"
					aria-label="Restart Claude process"
				>
					<span className="terminal-toolbar-button-icon" />
					<span className="terminal-toolbar-button-label">
						Restart
					</span>
				</button>
				<button
					ref={clearIconRef}
					type="button"
					className="terminal-toolbar-button"
					onClick={handleClear}
					title="Clear terminal"
					aria-label="Clear terminal output"
				>
					<span className="terminal-toolbar-button-icon" />
					<span className="terminal-toolbar-button-label">Clear</span>
				</button>
				<div className="terminal-toolbar-spacer" />
				<div className="terminal-status" aria-live="polite">
					<span
						className={`terminal-status-dot ${status}`}
						aria-hidden="true"
					/>
					<span>{getStatusLabel()}</span>
				</div>
			</div>
			{showErrorBanner && (
				<div className="terminal-error-banner" role="alert">
					<div className="terminal-error-banner-header">
						<span
							className="terminal-error-banner-icon"
							ref={(el) => {
								if (el) setIcon(el, "alert-triangle");
							}}
						/>
						<span className="terminal-error-banner-title">
							{errorMessage || "An error occurred"}
						</span>
					</div>
					<p className="terminal-error-banner-message">
						Check that the command path is correct in plugin
						settings.
					</p>
					<button
						type="button"
						className="terminal-error-banner-action"
						onClick={() => setShowErrorBanner(false)}
					>
						Dismiss
					</button>
				</div>
			)}
			<div
				className="terminal-panel-container"
				ref={containerRef}
				onClick={handleContainerClick}
				role="application"
				aria-label="Terminal output"
			/>
		</div>
	);
};
