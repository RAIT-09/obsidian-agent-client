/**
 * ACP Error Utilities
 *
 * Utilities for handling ACP protocol errors and converting them
 * to user-friendly ErrorInfo for UI display.
 *
 * These functions extract error information from ACP JSON-RPC errors
 * and provide appropriate titles and suggestions based on error codes.
 */

import {
	AcpErrorCode,
	type AcpError,
	type ErrorInfo,
} from "../domain/models/agent-error";

// ============================================================================
// Error Extraction Functions
// ============================================================================

/**
 * Extract error code from unknown error object.
 */
export function extractErrorCode(error: unknown): number | undefined {
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code: unknown }).code;
		if (typeof code === "number") return code;
	}
	return undefined;
}

/**
 * Extract error message from ACP error object.
 * Checks both `message` field and `data.details` for compatibility.
 */
export function extractErrorMessage(error: unknown): string {
	if (!error || typeof error !== "object") {
		return "An unexpected error occurred.";
	}

	// Check data.details first (some agents use this format)
	if ("data" in error) {
		const data = (error as { data: unknown }).data;
		if (data && typeof data === "object" && "details" in data) {
			const details = (data as { details: unknown }).details;
			if (typeof details === "string") return details;
		}
	}

	// Then check message
	if ("message" in error) {
		const msg = (error as { message: unknown }).message;
		if (typeof msg === "string") return msg;
	}

	return "An unexpected error occurred.";
}

/**
 * Extract error data from ACP error object.
 */
export function extractErrorData(error: unknown): unknown {
	if (error && typeof error === "object" && "data" in error) {
		return (error as { data: unknown }).data;
	}
	return undefined;
}

// ============================================================================
// Error Classification Functions
// ============================================================================

/**
 * Get user-friendly title for ACP error code.
 */
export function getErrorTitle(code: number | undefined): string {
	switch (code) {
		case AcpErrorCode.PARSE_ERROR:
			return "Protocol Error";
		case AcpErrorCode.INVALID_REQUEST:
			return "Invalid Request";
		case AcpErrorCode.METHOD_NOT_FOUND:
			return "Method Not Supported";
		case AcpErrorCode.INVALID_PARAMS:
			return "Invalid Parameters";
		case AcpErrorCode.INTERNAL_ERROR:
			return "Internal Error";
		case AcpErrorCode.AUTHENTICATION_REQUIRED:
			return "Authentication Required";
		case AcpErrorCode.RESOURCE_NOT_FOUND:
			return "Resource Not Found";
		default:
			return "Agent Error";
	}
}

/**
 * Get suggestion for ACP error code.
 * Uses error message content to provide more specific suggestions.
 */
export function getErrorSuggestion(
	code: number | undefined,
	message: string,
): string {
	// Check for context exhaustion in message (Internal Error)
	if (code === AcpErrorCode.INTERNAL_ERROR) {
		const lowerMsg = message.toLowerCase();
		if (
			lowerMsg.includes("context") ||
			lowerMsg.includes("token") ||
			lowerMsg.includes("max_tokens") ||
			lowerMsg.includes("too long")
		) {
			return "Try using /compact to compress the conversation, or start a new chat.";
		}
		if (lowerMsg.includes("overloaded") || lowerMsg.includes("capacity")) {
			return "The service is busy. Please wait a moment and try again.";
		}
	}

	switch (code) {
		case AcpErrorCode.PARSE_ERROR:
		case AcpErrorCode.INVALID_REQUEST:
		case AcpErrorCode.METHOD_NOT_FOUND:
			return "Try restarting the agent session.";
		case AcpErrorCode.INVALID_PARAMS:
			return "Check your agent configuration in settings.";
		case AcpErrorCode.INTERNAL_ERROR:
			return "Try again or restart the agent session.";
		case AcpErrorCode.AUTHENTICATION_REQUIRED:
			return "Check if you are logged in or if your API key is set correctly.";
		case AcpErrorCode.RESOURCE_NOT_FOUND:
			return "Check if the file or resource exists.";
		default:
			return "Try again or restart the agent session.";
	}
}

// ============================================================================
// Error Conversion Functions
// ============================================================================

/**
 * Convert unknown error to AcpError.
 * The error's message field is used directly for user display.
 */
export function toAcpError(
	error: unknown,
	sessionId?: string | null,
): AcpError {
	const code = extractErrorCode(error) ?? -1;
	const message = extractErrorMessage(error);
	const data = extractErrorData(error);

	return {
		code,
		message, // Agent's message is used directly
		data,
		sessionId,
		originalError: error,
		title: getErrorTitle(code),
		suggestion: getErrorSuggestion(code, message),
	};
}

/**
 * Convert AcpError to ErrorInfo for UI display.
 */
export function toErrorInfo(acpError: AcpError): ErrorInfo {
	return {
		title: acpError.title,
		message: acpError.message,
		suggestion: acpError.suggestion,
	};
}

// ============================================================================
// Error Check Functions
// ============================================================================

/**
 * Check if error is the "empty response text" error that should be ignored.
 */
export function isEmptyResponseError(error: unknown): boolean {
	const code = extractErrorCode(error);
	if (code !== AcpErrorCode.INTERNAL_ERROR) {
		return false;
	}

	const message = extractErrorMessage(error);
	return message.includes("empty response text");
}

/**
 * Check if error is a "user aborted" error that should be ignored.
 */
export function isUserAbortedError(error: unknown): boolean {
	const code = extractErrorCode(error);
	if (code !== AcpErrorCode.INTERNAL_ERROR) {
		return false;
	}

	const message = extractErrorMessage(error);
	return message.includes("user aborted");
}
