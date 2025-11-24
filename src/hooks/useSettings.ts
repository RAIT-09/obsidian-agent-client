import { useSyncExternalStore } from "react";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

/**
 * Hook for subscribing to plugin settings changes.
 *
 * Uses useSyncExternalStore to safely subscribe to the external settings store,
 * ensuring React re-renders when settings change.
 *
 * @param plugin - Plugin instance containing the settings store
 * @returns Current settings snapshot (AgentClientPluginSettings)
 */
export function useSettings(plugin: AgentClientPlugin) {
	return useSyncExternalStore(
		plugin.settingsStore.subscribe,
		plugin.settingsStore.getSnapshot,
		plugin.settingsStore.getSnapshot,
	);
}
