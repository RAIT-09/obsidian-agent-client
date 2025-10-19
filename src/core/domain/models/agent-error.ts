/**
 * Domain Models for Agent Errors
 *
 * These types represent errors that occur during agent operations,
 * independent of the ACP protocol implementation. They provide structured
 * error information with categorization, severity levels, and contextual
 * details for proper error handling and user feedback.
 */

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Categories of errors that can occur during agent operations.
 *
 * - connection: Network or process connection failures
 * - authentication: Auth failures (invalid API key, expired token, etc.)
 * - configuration: Invalid settings or missing required config
 * - communication: Protocol-level communication errors
 * - permission: Permission denied or access control issues
 * - timeout: Operation exceeded time limit
 * - unknown: Uncategorized or unexpected errors
 */
export type AgentErrorCategory =
	| "connection"
	| "authentication"
	| "configuration"
	| "communication"
	| "permission"
	| "timeout"
	| "unknown";

/**
 * Severity level of an error.
 *
 * - error: Critical error requiring user attention
 * - warning: Non-critical issue that may affect functionality
 * - info: Informational message (e.g., connection restored)
 */
export type AgentErrorSeverity = "error" | "warning" | "info";

// ============================================================================
// Error Information
// ============================================================================

/**
 * User-facing error information.
 *
 * Provides a structured way to present errors to users with:
 * - A concise title
 * - Detailed explanation message
 * - Optional suggestion for resolution
 */
export interface ErrorInfo {
	/** Short, user-friendly error title */
	title: string;

	/** Detailed error message explaining what went wrong */
	message: string;

	/** Optional suggestion on how to resolve the error */
	suggestion?: string;
}

/**
 * Complete error information with metadata.
 *
 * Extends ErrorInfo with additional context for logging, tracking,
 * and debugging purposes. Used internally to track error history
 * and provide detailed diagnostics.
 */
export interface AgentError extends ErrorInfo {
	/** Unique identifier for this error occurrence */
	id: string;

	/** Error category for classification */
	category: AgentErrorCategory;

	/** Severity level */
	severity: AgentErrorSeverity;

	/** Timestamp when the error occurred */
	occurredAt: Date;

	/** ID of the agent where the error occurred (if applicable) */
	agentId?: string;

	/** Session ID where the error occurred (null if no session) */
	sessionId?: string | null;

	/** Error code from the underlying system/protocol (if available) */
	code?: string | number;

	/** Original error object for debugging (not shown to users) */
	originalError?: unknown;
}
