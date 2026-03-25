/**
 * ACP Error Utilities
 *
 * Utilities for handling ACP protocol errors and converting them
 * to user-friendly ErrorInfo for UI display.
 *
 * These functions extract error information from ACP JSON-RPC errors
 * and provide appropriate titles and suggestions based on error codes.
 */

import { Platform } from "obsidian";
import {
	AcpErrorCode,
	type AcpError,
	type ErrorInfo,
} from "../types/errors";

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
			return "The conversation is too long. Try using a compact command if available, or start a new chat.";
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
 * Extract a user-friendly error hint from stderr output.
 * Detects common failure patterns like missing API keys.
 */
export function extractStderrErrorHint(stderr: string): string | null {
	if (!stderr) return null;

	if (
		stderr.includes("API key is missing") ||
		stderr.includes("LoadAPIKeyError")
	) {
		return "The agent's API key may be missing. For custom agents, add the required API key (e.g., ANTHROPIC_API_KEY) in the agent's Environment Variables setting.";
	}

	if (
		stderr.includes("authentication") ||
		stderr.includes("unauthorized") ||
		stderr.includes("401")
	) {
		return "The agent reported an authentication error. Check that your API key or credentials are valid.";
	}

	return null;
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

// ============================================================================
// Process Error Functions
// ============================================================================

/**
 * Get error information for process spawn errors.
 */
export function getSpawnErrorInfo(
	error: Error,
	command: string,
	agentLabel: string,
	wslMode: boolean,
): { title: string; message: string; suggestion: string } {
	if ((error as NodeJS.ErrnoException).code === "ENOENT") {
		return {
			title: "Command Not Found",
			message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
			suggestion: getCommandNotFoundSuggestion(command, wslMode),
		};
	}

	return {
		title: "Agent Startup Error",
		message: `Failed to start ${agentLabel}: ${error.message}`,
		suggestion: "Please check the agent configuration in settings.",
	};
}

/**
 * Get platform-specific suggestions for command not found errors.
 */
export function getCommandNotFoundSuggestion(
	command: string,
	wslMode: boolean,
): string {
	const commandName =
		command.split("/").pop()?.split("\\").pop() || "command";

	if (Platform.isWin && wslMode) {
		return `1. Verify the agent path: Use "which ${commandName}" in your WSL terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
	} else if (Platform.isWin) {
		return `1. Verify the agent path: Use "where ${commandName}" in Command Prompt to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "where node" to find it).`;
	} else {
		return `1. Verify the agent path: Use "which ${commandName}" in Terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
	}
}
