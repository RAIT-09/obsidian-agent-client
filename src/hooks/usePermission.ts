import { useState, useCallback, useMemo } from "react";
import type {
	ChatMessage,
	PermissionOption,
} from "../core/domain/models/chat-message";
import type { HandlePermissionUseCase } from "../core/use-cases/handle-permission.use-case";
import type { ErrorInfo } from "../core/domain/models/agent-error";

// ============================================================================
// Types
// ============================================================================

/**
 * Active permission request information.
 */
export interface ActivePermission {
	/** Permission request ID */
	requestId: string;
	/** Tool call ID that triggered the request */
	toolCallId: string;
	/** Available permission options */
	options: PermissionOption[];
}

/**
 * Return type for usePermission hook.
 */
export interface UsePermissionReturn {
	/** Currently active permission request (if any) */
	activePermission: ActivePermission | null;
	/** Error information from permission operations */
	errorInfo: ErrorInfo | null;

	/**
	 * Approve a specific permission request with the given option.
	 * @param requestId - Permission request ID
	 * @param optionId - Selected option ID
	 */
	approvePermission: (requestId: string, optionId: string) => Promise<void>;

	/**
	 * Approve the currently active permission request.
	 * Selects "allow_once" or "allow_always" option.
	 * Used for hotkey handling.
	 * @returns True if permission was approved, false if no active permission
	 */
	approveActivePermission: () => Promise<boolean>;

	/**
	 * Reject the currently active permission request.
	 * Selects "reject_once" or "reject_always" option.
	 * Used for hotkey handling.
	 * @returns True if permission was rejected, false if no active permission
	 */
	rejectActivePermission: () => Promise<boolean>;

	/**
	 * Clear the current error.
	 */
	clearError: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the active permission request from messages.
 */
function findActivePermission(messages: ChatMessage[]): ActivePermission | null {
	for (const message of messages) {
		for (const content of message.content) {
			if (content.type === "tool_call") {
				const permission = content.permissionRequest;
				if (permission?.isActive) {
					return {
						requestId: permission.requestId,
						toolCallId: content.toolCallId,
						options: permission.options,
					};
				}
			}
		}
	}
	return null;
}

/**
 * Select an option from the available options based on preferred kinds.
 */
function selectOption(
	options: PermissionOption[],
	preferredKinds: PermissionOption["kind"][],
	fallback?: (option: PermissionOption) => boolean,
): PermissionOption | undefined {
	// Try preferred kinds in order
	for (const kind of preferredKinds) {
		const match = options.find((opt) => opt.kind === kind);
		if (match) {
			return match;
		}
	}

	// Try fallback predicate
	if (fallback) {
		const fallbackOption = options.find(fallback);
		if (fallbackOption) {
			return fallbackOption;
		}
	}

	// Return first option as last resort
	return options[0];
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing permission request handling.
 *
 * This hook:
 * - Detects active permission requests from messages
 * - Provides methods to approve/reject permissions
 * - Handles hotkey-triggered approve/reject actions
 *
 * @param handlePermissionUseCase - Use case for permission operations
 * @param messages - Chat messages (from useChat) to scan for active permissions
 */
export function usePermission(
	handlePermissionUseCase: HandlePermissionUseCase,
	messages: ChatMessage[],
): UsePermissionReturn {
	// Error state
	const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

	// Find active permission from messages (derived state)
	const activePermission = useMemo(
		() => findActivePermission(messages),
		[messages],
	);

	/**
	 * Approve a specific permission request.
	 */
	const approvePermission = useCallback(
		async (requestId: string, optionId: string): Promise<void> => {
			try {
				const result = await handlePermissionUseCase.approvePermission({
					requestId,
					optionId,
				});

				if (!result.success) {
					setErrorInfo({
						title: "Permission Error",
						message: result.error || "Failed to respond to permission request",
					});
				}
			} catch (error) {
				setErrorInfo({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[handlePermissionUseCase],
	);

	/**
	 * Approve the currently active permission.
	 */
	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0) {
			return false;
		}

		const option = selectOption(activePermission.options, [
			"allow_once",
			"allow_always",
		]);

		if (!option) {
			return false;
		}

		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	/**
	 * Reject the currently active permission.
	 */
	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		if (!activePermission || activePermission.options.length === 0) {
			return false;
		}

		const option = selectOption(
			activePermission.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);

		if (!option) {
			return false;
		}

		await approvePermission(activePermission.requestId, option.optionId);
		return true;
	}, [activePermission, approvePermission]);

	/**
	 * Clear the current error.
	 */
	const clearError = useCallback((): void => {
		setErrorInfo(null);
	}, []);

	return {
		activePermission,
		errorInfo,
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
		clearError,
	};
}
