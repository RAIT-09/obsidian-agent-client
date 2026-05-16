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
 *
 * Returns the final modes/models state after restoration (or the originals
 * if no restoration was needed or if the agent-side calls failed).
 * The caller is responsible for applying these to session state.
 * This function has no side effects on React state so callers can sequence
 * the restore BEFORE marking the session as "ready", avoiding a UI race
 * where the dropdown briefly shows the agent's default mode/model before
 * the user's saved selection is re-applied.
 */
export async function restoreLegacyConfig(
	agentClient: AcpClient,
	sessionResult: SessionResult,
	savedModelId: string | undefined,
	savedModeId: string | undefined,
): Promise<{
	modes: SessionResult["modes"];
	models: SessionResult["models"];
}> {
	let modes = sessionResult.modes;
	let models = sessionResult.models;

	if (!sessionResult.sessionId) return { modes, models };

	// Legacy model restore
	if (models && savedModelId) {
		if (
			savedModelId !== models.currentModelId &&
			models.availableModels.some((m) => m.modelId === savedModelId)
		) {
			try {
				await agentClient.setSessionModel(
					sessionResult.sessionId,
					savedModelId,
				);
				models = { ...models, currentModelId: savedModelId };
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	// Legacy mode restore
	if (modes && savedModeId) {
		if (
			savedModeId !== modes.currentModeId &&
			modes.availableModes.some((m) => m.id === savedModeId)
		) {
			try {
				await agentClient.setSessionMode(
					sessionResult.sessionId,
					savedModeId,
				);
				modes = { ...modes, currentModeId: savedModeId };
			} catch {
				// Agent default is fine as fallback
			}
		}
	}

	return { modes, models };
}
