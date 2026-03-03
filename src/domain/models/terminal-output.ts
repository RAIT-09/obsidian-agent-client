export interface TerminalExitStatus {
	exitCode: number | null;
	signal: string | null;
}

export interface TerminalOutputSnapshot {
	output: string;
	exitStatus?: TerminalExitStatus;
}
