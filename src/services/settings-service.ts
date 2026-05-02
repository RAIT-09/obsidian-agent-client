/**
 * Settings Store Adapter
 *
 * Reactive settings store implementing ISettingAccess port.
 * Manages plugin settings state with observer pattern for React integration
 * via useSyncExternalStore, and handles persistence to Obsidian's data.json.
 */

import type { AgentClientPluginSettings } from "../plugin";
import type AgentClientPlugin from "../plugin";
import { updateDebugMode } from "../utils/logger";
import type { ChatMessage } from "../types/chat";
import type { SavedSessionInfo } from "../types/session";
import { SessionStorage } from "./session-storage";

// ============================================================================
// Port Types (from settings-access.port.ts)
// ============================================================================

/**
 * Interface for accessing and managing plugin settings.
 *
 * Provides reactive access to settings with subscription support
 * for detecting changes (e.g., for React components using useSyncExternalStore).
 *
 * This port will be implemented by adapters that handle the actual
 * storage mechanism (SettingsService, localStorage, etc.).
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

/** Listener callback invoked when settings change */
type Listener = () => void;

/**
 * Observable store for plugin settings implementing ISettingsAccess port.
 *
 * Manages plugin settings state and notifies subscribers of changes.
 * Designed to work with React's useSyncExternalStore hook for
 * automatic re-rendering when settings update.
 *
 * Pattern: Observer/Publisher-Subscriber
 */
export class SettingsService implements ISettingsAccess {
	/** Current settings state */
	private state: AgentClientPluginSettings;

	/** Set of registered listeners */
	private listeners = new Set<Listener>();

	/** Plugin instance for persistence */
	private plugin: AgentClientPlugin;

	/** Session storage delegate */
	private sessionStorage: SessionStorage;

	/**
	 * Create a new settings store.
	 *
	 * @param initial - Initial settings state
	 * @param plugin - Plugin instance for saving settings
	 */
	constructor(initial: AgentClientPluginSettings, plugin: AgentClientPlugin) {
		this.state = initial;
		this.plugin = plugin;
		this.sessionStorage = new SessionStorage(plugin, this);
	}

	/**
	 * Get current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot = (): AgentClientPluginSettings => this.state;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings, notifies subscribers,
	 * and persists changes to disk.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	async updateSettings(
		updates: Partial<AgentClientPluginSettings>,
	): Promise<void> {
		const next = { ...this.state, ...updates };
		this.state = next;

		// Sync with plugin.settings (required for saveSettings to persist correctly)
		this.plugin.settings = next;

		// Keep logger in sync with debug mode toggle
		updateDebugMode(next.debugMode);

		// Notify all subscribers
		for (const listener of this.listeners) {
			listener();
		}

		// Persist to disk
		await this.plugin.saveSettings();
	}

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated via updateSettings().
	 * Used by React's useSyncExternalStore to detect changes.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Set entire settings object (legacy method).
	 *
	 * For backward compatibility with existing code.
	 * Delegates to updateSettings() for async persistence.
	 *
	 * @param next - New settings object
	 */
	set(next: AgentClientPluginSettings): void {
		// Delegate to async updateSettings
		// Note: Fire-and-forget - callers don't expect this to be async
		void this.updateSettings(next);
	}

	// ============================================================
	// Session Storage (delegated to SessionStorage)
	// ============================================================

	async saveSession(info: SavedSessionInfo): Promise<void> {
		return this.sessionStorage.saveSession(info);
	}

	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[] {
		return this.sessionStorage.getSavedSessions(agentId, cwd);
	}

	async deleteSession(sessionId: string): Promise<void> {
		return this.sessionStorage.deleteSession(sessionId);
	}

	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
	): Promise<void> {
		return this.sessionStorage.saveSessionMessages(
			sessionId,
			agentId,
			messages,
		);
	}

	async loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null> {
		return this.sessionStorage.loadSessionMessages(sessionId);
	}

	async deleteSessionMessages(sessionId: string): Promise<void> {
		return this.sessionStorage.deleteSessionMessages(sessionId);
	}
}

/**
 * Create a new settings store instance.
 */
export const createSettingsService = (
	initial: AgentClientPluginSettings,
	plugin: AgentClientPlugin,
) => new SettingsService(initial, plugin);
