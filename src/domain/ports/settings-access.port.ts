/**
 * Port for accessing plugin settings
 *
 * This interface abstracts the plugin settings management, allowing
 * the domain layer to access and modify settings without depending
 * on the specific implementation (e.g., Obsidian's data.json storage).
 */

import type { AgentClientPluginSettings } from "../../plugin";
import type { ChatMessage } from "../models/chat-message";
import type { SavedSessionInfo } from "../models/session-info";

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

	// ============================================================
	// Session Storage Methods
	// ============================================================

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches.
	 * Maintains max 50 sessions, removing oldest when exceeded.
	 *
	 * @param info - Session metadata to save
	 * @returns Promise that resolves when session is saved
	 */
	saveSession(info: SavedSessionInfo): Promise<void>;

	/**
	 * Get saved sessions, optionally filtered by agentId and/or cwd.
	 *
	 * Returns sessions sorted by updatedAt (newest first).
	 *
	 * @param agentId - Optional filter by agent ID
	 * @param cwd - Optional filter by working directory
	 * @returns Array of saved session metadata
	 */
	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[];

	/**
	 * Delete a saved session by sessionId.
	 *
	 * @param sessionId - ID of session to delete
	 * @returns Promise that resolves when session is deleted
	 */
	deleteSession(sessionId: string): Promise<void>;

	// ============================================================
	// Session Message History Methods
	// ============================================================

	/**
	 * Save message history for a session.
	 *
	 * Saves the full ChatMessage[] to a separate file in sessions/ directory.
	 * Overwrites existing file if present.
	 *
	 * @param sessionId - Session ID
	 * @param agentId - Agent ID for validation
	 * @param messages - Chat messages to save
	 * @returns Promise that resolves when messages are saved
	 */
	saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
	): Promise<void>;

	/**
	 * Load message history for a session.
	 *
	 * Reads from sessions/{sessionId}.json file.
	 * Returns null if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 * @returns Promise that resolves with messages or null if not found
	 */
	loadSessionMessages(sessionId: string): Promise<ChatMessage[] | null>;

	/**
	 * Delete message history file for a session.
	 *
	 * Called when session is deleted from savedSessions.
	 * Silently succeeds if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 * @returns Promise that resolves when file is deleted
	 */
	deleteSessionMessages(sessionId: string): Promise<void>;
}
