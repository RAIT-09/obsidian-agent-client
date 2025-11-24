import { useSyncExternalStore } from "react";
import type AgentClientPlugin from "../infrastructure/obsidian-plugin/plugin";

export function useSettings(plugin: AgentClientPlugin) {
	return useSyncExternalStore(
		plugin.settingsStore.subscribe,
		plugin.settingsStore.getSnapshot,
		plugin.settingsStore.getSnapshot,
	);
}
