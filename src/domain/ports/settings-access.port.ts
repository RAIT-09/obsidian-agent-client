/**
 * Port for accessing plugin settings
 *
 * This interface abstracts the plugin settings management, allowing
 * the domain layer to access and modify settings without depending
 * on the specific implementation (e.g., Obsidian's data.json storage).
 */

import type { AgentClientPluginSettings } from "../../plugin";

/**
 * Interface for accessing and managing plugin settings.
 *
 * Provides reactive access to settings with subscription support
 * for detecting changes (e.g., for React components using useSyncExternalStore).
 *
 * This port will be implemented by adapters that handle the actual
 * storage mechanism (SettingsStore, localStorage, etc.).
 */
export interface ISettingsAccess {
	/**
	 * Get the current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 * Should return the settings object immediately without side effects.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot(): AgentClientPluginSettings;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings and persists
	 * the changes. Notifies all subscribers after the update.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated.
	 * Used by React's useSyncExternalStore to detect changes and trigger re-renders.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe(listener: () => void): () => void;
}
