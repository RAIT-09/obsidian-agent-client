/**
 * Handle Permission Use Case
 *
 * Handles permission request responses from users.
 * Responsibilities:
 * - Respond to permission requests (approve/deny)
 * - Check auto-approval settings
 * - Manage permission request lifecycle
 */

import type {
	IAgentClient,
	ISettingsAccess,
	PermissionOption,
} from "../../types";

// ============================================================================
// Input/Output Types
// ============================================================================

/**
 * Permission request data
 */
export interface PermissionRequest {
	/** Unique ID for this permission request */
	requestId: string;

	/** Tool call ID that triggered the request */
	toolCallId: string;

	/** Available permission options */
	options: PermissionOption[];

	/** Optional title for the operation */
	title?: string;
}

/**
 * Input for responding to a permission request
 */
export interface RespondToPermissionInput {
	/** Permission request ID */
	requestId: string;

	/** Selected option ID */
	optionId: string;
}

/**
 * Result of responding to a permission request
 */
export interface RespondToPermissionResult {
	/** Whether the response was successful */
	success: boolean;

	/** Error message if failed */
	error?: string;
}

// ============================================================================
// Use Case Implementation
// ============================================================================

export class HandlePermissionUseCase {
	constructor(
		private agentClient: IAgentClient,
		private settingsAccess: ISettingsAccess,
	) {}

	/**
	 * Respond to a permission request by approving a specific option
	 */
	async approvePermission(
		input: RespondToPermissionInput,
	): Promise<RespondToPermissionResult> {
		try {
			await this.agentClient.respondToPermission(
				input.requestId,
				input.optionId,
			);

			return {
				success: true,
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to respond to permission: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Deny a permission request by selecting the reject option
	 */
	async denyPermission(
		requestId: string,
	): Promise<RespondToPermissionResult> {
		// For denial, we typically select a "reject" option
		// The actual option ID would need to be determined from the permission request
		// This is a simplified implementation
		try {
			// In a real implementation, we'd need to find the reject option ID
			// from the permission request options
			await this.agentClient.respondToPermission(requestId, "reject");

			return {
				success: true,
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to deny permission: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Check if auto-approval is enabled in settings
	 */
	shouldAutoApprove(): boolean {
		const settings = this.settingsAccess.getSnapshot();
		return settings.autoAllowPermissions || false;
	}

	/**
	 * Get the appropriate auto-approval option from a permission request
	 *
	 * Selects the first "allow" option, preferring "allow_once" over others.
	 */
	getAutoApproveOption(request: PermissionRequest): PermissionOption | null {
		if (!this.shouldAutoApprove()) {
			return null;
		}

		// Try to find allow_once first
		const allowOnce = request.options.find(
			(option) => option.kind === "allow_once",
		);
		if (allowOnce) {
			return allowOnce;
		}

		// Fall back to allow_always
		const allowAlways = request.options.find(
			(option) => option.kind === "allow_always",
		);
		if (allowAlways) {
			return allowAlways;
		}

		// Fall back to any option with "allow" in the name
		const allowByName = request.options.find((option) =>
			option.name.toLowerCase().includes("allow"),
		);
		if (allowByName) {
			return allowByName;
		}

		// Last resort: first option
		return request.options[0] || null;
	}

	/**
	 * Automatically approve a permission request if auto-approval is enabled
	 *
	 * Returns null if auto-approval is disabled or no suitable option is found.
	 */
	async autoApproveIfEnabled(
		request: PermissionRequest,
	): Promise<RespondToPermissionResult | null> {
		const autoOption = this.getAutoApproveOption(request);

		if (!autoOption) {
			return null; // Auto-approval not enabled or no suitable option
		}

		return await this.approvePermission({
			requestId: request.requestId,
			optionId: autoOption.optionId,
		});
	}
}
