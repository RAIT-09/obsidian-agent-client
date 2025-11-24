/**
 * usePermissions Hook
 *
 * Handles permission request interactions.
 * Provides methods to approve/reject permission requests from the agent.
 */

import { useCallback } from "react";
import type { PermissionOption, ChatMessage } from "../types";
import type { HandlePermissionUseCase } from "../core/use-cases/handle-permission.use-case";
import type { UseSessionReturn } from "./useSession";

// ============================================================================
// Types
// ============================================================================

export interface UsePermissionsOptions {
	/** Permission handling use case */
	handlePermissionUseCase: HandlePermissionUseCase;

	/** Session hook for error handling */
	sessionHook: UseSessionReturn;

	/** Function to get current messages (for finding active permission) */
	getMessages: () => ChatMessage[];
}

// ============================================================================
// Hook
// ============================================================================

export function usePermissions(options: UsePermissionsOptions) {
	const { handlePermissionUseCase, sessionHook, getMessages } = options;

	/**
	 * Find the active permission request in messages.
	 */
	const findActivePermission = useCallback((): {
		requestId: string;
		options: PermissionOption[];
	} | null => {
		const messages = getMessages();

		for (const message of messages) {
			for (const content of message.content) {
				if (content.type === "tool_call") {
					const permission = content.permissionRequest;
					if (permission?.isActive) {
						return {
							requestId: permission.requestId,
							options: permission.options,
						};
					}
				}
			}
		}
		return null;
	}, [getMessages]);

	/**
	 * Select an option from permission options based on preferred kinds.
	 */
	const selectOption = useCallback(
		(
			options: PermissionOption[],
			preferredKinds: PermissionOption["kind"][],
			fallback?: (option: PermissionOption) => boolean,
		): PermissionOption | undefined => {
			for (const kind of preferredKinds) {
				const match = options.find((opt) => opt.kind === kind);
				if (match) {
					return match;
				}
			}
			if (fallback) {
				const fallbackOption = options.find(fallback);
				if (fallbackOption) {
					return fallbackOption;
				}
			}
			return options[0];
		},
		[],
	);

	/**
	 * Approve a permission request with a specific option.
	 */
	const approvePermission = useCallback(
		async (requestId: string, optionId: string) => {
			try {
				const result = await handlePermissionUseCase.approvePermission({
					requestId,
					optionId,
				});

				if (!result.success) {
					sessionHook.setError({
						title: "Permission Error",
						message:
							result.error ||
							"Failed to respond to permission request",
					});
				}
			} catch (error) {
				sessionHook.setError({
					title: "Permission Error",
					message: `Failed to respond to permission request: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		},
		[handlePermissionUseCase, sessionHook],
	);

	/**
	 * Approve the currently active permission request.
	 * Selects the first "allow" option.
	 */
	const approveActivePermission = useCallback(async (): Promise<boolean> => {
		const active = findActivePermission();
		if (!active || active.options.length === 0) {
			return false;
		}

		const option = selectOption(active.options, [
			"allow_once",
			"allow_always",
		]);

		if (!option) {
			return false;
		}

		await approvePermission(active.requestId, option.optionId);
		return true;
	}, [findActivePermission, selectOption, approvePermission]);

	/**
	 * Reject the currently active permission request.
	 * Selects the first "reject" option.
	 */
	const rejectActivePermission = useCallback(async (): Promise<boolean> => {
		const active = findActivePermission();
		if (!active || active.options.length === 0) {
			return false;
		}

		const option = selectOption(
			active.options,
			["reject_once", "reject_always"],
			(opt) =>
				opt.name.toLowerCase().includes("reject") ||
				opt.name.toLowerCase().includes("deny"),
		);

		if (!option) {
			return false;
		}

		await approvePermission(active.requestId, option.optionId);
		return true;
	}, [findActivePermission, selectOption, approvePermission]);

	return {
		approvePermission,
		approveActivePermission,
		rejectActivePermission,
		findActivePermission,
	};
}

export type UsePermissionsReturn = ReturnType<typeof usePermissions>;
