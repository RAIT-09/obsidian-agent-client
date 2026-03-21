/**
 * Port for terminal output operations.
 *
 * UI components (TerminalRenderer) use this interface to poll terminal output.
 * Implemented by AcpAdapter in the adapter layer.
 *
 * This port isolates UI components from the ACP SDK's terminal types,
 * ensuring that protocol changes don't affect the UI layer.
 */

/**
 * Result of polling terminal output.
 */
export interface TerminalOutputResult {
	/** Terminal output text captured so far */
	output: string;
	/** Whether the output was truncated due to byte limits */
	truncated: boolean;
	/** Exit status if the command has completed, null if still running */
	exitStatus: {
		exitCode: number | null;
		signal: string | null;
	} | null;
}

/**
 * Interface for terminal output operations.
 *
 * Provides read-only access to terminal output for UI rendering.
 * The actual terminal lifecycle (create, kill, release) is managed
 * internally by the adapter and is not exposed to the UI layer.
 */
export interface ITerminalClient {
	/**
	 * Get the current output and exit status of a terminal.
	 *
	 * @param terminalId - Terminal identifier from a tool_call
	 * @returns Terminal output and optional exit status
	 * @throws Error if terminal not found
	 */
	getTerminalOutput(terminalId: string): Promise<TerminalOutputResult>;
}
