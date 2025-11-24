/**
 * useSettings Hook
 *
 * Provides reactive access to plugin settings.
 */

import * as React from "react";
const { useSyncExternalStore, useCallback } = React;
import { usePlugin } from "../contexts";
import type { PluginSettings } from "../types";

/**
 * Hook for accessing and updating plugin settings.
 *
 * Uses useSyncExternalStore for automatic re-renders when settings change.
 */
export function useSettings() {
	const plugin = usePlugin();
	const { settingsStore } = plugin;

	const settings = useSyncExternalStore(
		settingsStore.subscribe,
		settingsStore.getSnapshot,
		settingsStore.getSnapshot,
	);

	const updateSettings = useCallback(
		async (updates: Partial<PluginSettings>) => {
			await settingsStore.updateSettings(updates);
		},
		[settingsStore],
	);

	return {
		settings,
		updateSettings,
	};
}

/**
 * Hook for accessing only settings (no update function).
 * Useful for components that only read settings.
 */
export function useSettingsValue(): PluginSettings {
	const plugin = usePlugin();
	const { settingsStore } = plugin;

	return useSyncExternalStore(
		settingsStore.subscribe,
		settingsStore.getSnapshot,
		settingsStore.getSnapshot,
	);
}
