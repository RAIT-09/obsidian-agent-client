/**
 * Domain Models for Agent Errors
 *
 * This module defines error types for the Agent Client plugin:
 * - AcpError: ACP protocol errors (JSON-RPC based)
 * - ProcessError: Node.js process-level errors
 *
 * These types are based on the ACP (Agent Client Protocol) specification
 * and JSON-RPC 2.0 error object specification.
 */

// ============================================================================
// ACP Error Codes
// ============================================================================

/**
 * ACP Error Codes based on JSON-RPC 2.0 and ACP protocol extensions.
 * https://agentclientprotocol.com/
 *
 * Standard JSON-RPC 2.0 errors: -32700 to -32600
 * ACP protocol-specific errors: -32000 to -32099 (reserved range)
 */
export const AcpErrorCode = {
	// JSON-RPC 2.0 standard errors
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,

	// ACP protocol-specific errors (reserved range -32000 to -32099)
	AUTHENTICATION_REQUIRED: -32000,
	RESOURCE_NOT_FOUND: -32002,
} as const;

export type AcpErrorCodeValue =
	(typeof AcpErrorCode)[keyof typeof AcpErrorCode];

// ============================================================================
// User-Facing Error Information
// ============================================================================

/**
 * User-facing error information for UI display.
 *
 * This is the common interface used by all error types to provide
 * consistent error information to the user.
 */
export interface ErrorInfo {
	/** Short, user-friendly error title */
	title: string;

	/** Detailed error message explaining what went wrong */
	message: string;

	/** Optional suggestion on how to resolve the error */
	suggestion?: string;
}

// ============================================================================
// ACP Error (Protocol-level)
// ============================================================================

/**
 * ACP protocol error from agent communication.
 *
 * Based on JSON-RPC 2.0 error object specification with ACP extensions.
 * The `message` field contains the agent's error message and should be
 * displayed directly to the user for detailed error information.
 */
export interface AcpError extends ErrorInfo {
	/** ACP/JSON-RPC error code */
	code: number;

	/** Additional error data from agent (for debugging) */
	data?: unknown;

	/** Session ID where the error occurred */
	sessionId?: string | null;

	/** Original error object for debugging */
	originalError?: unknown;
}

// ============================================================================
// Process Error (System-level)
// ============================================================================

/**
 * Process-level error types.
 *
 * These represent Node.js/system errors that occur during
 * agent process management, not ACP protocol errors.
 */
export type ProcessErrorType =
	| "spawn_failed" // Process spawn failed (ENOENT, etc.)
	| "command_not_found" // Exit code 127
	| "process_crashed" // Abnormal termination
	| "process_timeout"; // Timeout

/**
 * Process-level error from agent process management.
 *
 * These are Node.js/system errors, not ACP protocol errors.
 * Used for errors that occur before or outside of ACP communication.
 */
export interface ProcessError extends ErrorInfo {
	/** Error type classification */
	type: ProcessErrorType;

	/** Agent ID where the error occurred */
	agentId: string;

	/** Exit code (if applicable) */
	exitCode?: number;

	/** Node.js error code (e.g., "ENOENT") */
	errorCode?: string;

	/** Original error object for debugging */
	originalError?: unknown;
}
