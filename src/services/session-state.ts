/**
 * Pure functions for session state updates.
 *
 * These functions are extracted from useSession to keep the hook thin
 * and to allow independent testing. They handle session config restoration
 * and legacy mode/model management.
 */

import type {
	ChatSession,
	SessionConfigOption,
	SessionResult,
} from "../types/session";
import { flattenConfigSelectOptions } from "../types/session";
import type { AcpClient } from "../acp/acp-client";
import * as React from "react";

// ============================================================================
// Legacy Config Helpers
// ============================================================================

/**
 * Apply a legacy mode/model value to the session state.
 * Used for both optimistic updates and rollbacks.
 */
export function applyLegacyValue(
	prev: ChatSession,
	kind: "mode" | "model",
	value: string,
): ChatSession {
	if (kind === "mode") {
		if (!prev.modes) return prev;
		return { ...prev, modes: { ...prev.modes, currentModeId: value } };
	}
	if (!prev.models) return prev;
	return { ...prev, models: { ...prev.models, currentModelId: value } };
}

// ============================================================================
// Config Restore Helpers
// ============================================================================

/**
 * Try to restore a saved config option value by category.
 * Returns updated configOptions if restored, or the original if unchanged.
 */
export async function tryRestoreConfigOption(
	agentClient: AcpClient,
	sessionId: string,
	configOptions: SessionConfigOption[],
	category: string,
	savedValue: string | undefined,
): Promise<SessionConfigOption[]> {
	if (!savedValue) return configOptions;

	const option = configOptions.find((o) => o.category === category);
	if (!option) return configOptions;
	if (savedValue === option.currentValue) return configOptions;
	if (
		!flattenConfigSelectOptions(option.options).some(
			(o) => o.value === savedValue,
		)
	)
		return configOptions;

	try {
		return await agentClient.setSessionConfigOption(
			sessionId,
			option.id,
			savedValue,
		);
	} catch {
		return configOptions;
	}
}

/**
 * Restore last used mode/model via legacy APIs.
 * Only called when configOptions is not available.
 */
export async function restoreLegacyConfig(
	agentClient: AcpClient,
	sessionResult: SessionResult,
	savedModelId: string | undefined,
	savedModeId: string | undefined,
	setSession: React.Dispatch<React.SetStateAction<ChatSession>>,
): Promise<void> {
	if (!sessionResult.sessionId) return;

	// Legacy model restore
	if (sessionResult.models && savedModelId) {
		if (
			savedModelId !== sessionResult.models.currentModelId &&
			sessionResult.models.availableModels.some(
				(m) => m.modelId === savedModelId,
			)
		) {
			try {
				await agentClient.setSessionModel(
					sessionResult.sessionId,
					savedModelId,
				);
				setSession((prev) =>
					applyLegacyValue(prev, "model", savedModelId),
				);
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	// Legacy mode restore
	if (sessionResult.modes && savedModeId) {
		if (
			savedModeId !== sessionResult.modes.currentModeId &&
			sessionResult.modes.availableModes.some((m) => m.id === savedModeId)
		) {
			try {
				await agentClient.setSessionMode(
					sessionResult.sessionId,
					savedModeId,
				);
				setSession((prev) =>
					applyLegacyValue(prev, "mode", savedModeId),
				);
			} catch {
				// Agent default is fine as fallback
			}
		}
	}
}
