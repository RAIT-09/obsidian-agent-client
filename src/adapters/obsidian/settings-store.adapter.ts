/**
 * Settings Store Adapter
 *
 * Reactive settings store implementing ISettingAccess port.
 * Manages plugin settings state with observer pattern for React integration
 * via useSyncExternalStore, and handles persistence to Obsidian's data.json.
 */

import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import type { AgentClientPluginSettings } from "../../plugin";
import type AgentClientPlugin from "../../plugin";
import type { ChatMessage } from "../../domain/models/chat-message";
import type { SavedSessionInfo } from "../../domain/models/session-info";

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
export class SettingsStore implements ISettingsAccess {
	/** Current settings state */
	private state: AgentClientPluginSettings;

	/** Set of registered listeners */
	private listeners = new Set<Listener>();

	/** Plugin instance for persistence */
	private plugin: AgentClientPlugin;

	/**
	 * Create a new settings store.
	 *
	 * @param initial - Initial settings state
	 * @param plugin - Plugin instance for saving settings
	 */
	constructor(initial: AgentClientPluginSettings, plugin: AgentClientPlugin) {
		this.state = initial;
		this.plugin = plugin;
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
	// Session Storage Methods
	// ============================================================

	/** Maximum number of saved sessions to keep */
	private static readonly MAX_SAVED_SESSIONS = 50;

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches.
	 * Maintains max 50 sessions, removing oldest when exceeded.
	 *
	 * @param info - Session metadata to save
	 * @returns Promise that resolves when session is saved
	 */
	async saveSession(info: SavedSessionInfo): Promise<void> {
		const sessions = [...(this.state.savedSessions || [])];

		// Find existing session by sessionId
		const existingIndex = sessions.findIndex(
			(s) => s.sessionId === info.sessionId,
		);

		if (existingIndex >= 0) {
			// Update existing session
			sessions[existingIndex] = info;
		} else {
			// Add new session at the beginning
			sessions.unshift(info);

			// Remove oldest sessions if exceeding limit
			if (sessions.length > SettingsStore.MAX_SAVED_SESSIONS) {
				sessions.pop();
			}
		}

		await this.updateSettings({ savedSessions: sessions });
	}

	/**
	 * Get saved sessions, optionally filtered by agentId and/or cwd.
	 *
	 * Returns sessions sorted by updatedAt (newest first).
	 *
	 * @param agentId - Optional filter by agent ID
	 * @param cwd - Optional filter by working directory
	 * @returns Array of saved session metadata
	 */
	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[] {
		let sessions = this.state.savedSessions || [];

		if (agentId) {
			sessions = sessions.filter((s) => s.agentId === agentId);
		}
		if (cwd) {
			sessions = sessions.filter((s) => s.cwd === cwd);
		}

		// Sort by updatedAt descending (newest first)
		return [...sessions].sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() -
				new Date(a.updatedAt).getTime(),
		);
	}

	/**
	 * Delete a saved session by sessionId.
	 *
	 * Also deletes the associated message history file.
	 *
	 * @param sessionId - ID of session to delete
	 * @returns Promise that resolves when session is deleted
	 */
	async deleteSession(sessionId: string): Promise<void> {
		// Delete metadata from savedSessions
		const sessions = (this.state.savedSessions || []).filter(
			(s) => s.sessionId !== sessionId,
		);
		await this.updateSettings({ savedSessions: sessions });

		// Also delete message history file
		await this.deleteSessionMessages(sessionId);
	}

	// ============================================================
	// Session Message History Methods
	// ============================================================

	/** Directory for session message files */
	private static readonly SESSIONS_DIR =
		".obsidian/plugins/agent-client/sessions";

	/**
	 * Ensure the sessions directory exists.
	 *
	 * Creates the directory if it doesn't exist.
	 */
	private async ensureSessionsDir(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(SettingsStore.SESSIONS_DIR))) {
			await adapter.mkdir(SettingsStore.SESSIONS_DIR);
		}
	}

	/**
	 * Get the file path for a session's message history.
	 *
	 * Sanitizes sessionId to ensure safe file names.
	 *
	 * @param sessionId - Session ID
	 * @returns File path for the session's messages
	 */
	private getSessionFilePath(sessionId: string): string {
		// Sanitize sessionId for safe file names (replace unsafe chars with _)
		const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
		return `${SettingsStore.SESSIONS_DIR}/${safeId}.json`;
	}

	/**
	 * Save message history for a session.
	 *
	 * Saves the full ChatMessage[] to a separate file.
	 * Overwrites existing file if present.
	 *
	 * @param sessionId - Session ID
	 * @param agentId - Agent ID for validation
	 * @param messages - Chat messages to save
	 */
	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
	): Promise<void> {
		await this.ensureSessionsDir();

		// Serialize ChatMessage[] (convert timestamp: Date → string)
		const serialized = messages.map((msg) => ({
			...msg,
			timestamp: msg.timestamp.toISOString(),
		}));

		const data = {
			version: 1,
			sessionId,
			agentId,
			messages: serialized,
			savedAt: new Date().toISOString(),
		};

		const filePath = this.getSessionFilePath(sessionId);
		await this.plugin.app.vault.adapter.write(
			filePath,
			JSON.stringify(data, null, 2),
		);
	}

	/**
	 * Load message history for a session.
	 *
	 * Reads from sessions/{sessionId}.json file.
	 * Returns null if file doesn't exist or on error.
	 *
	 * @param sessionId - Session ID
	 * @returns Chat messages or null if not found
	 */
	async loadSessionMessages(
		sessionId: string,
	): Promise<ChatMessage[] | null> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (!(await adapter.exists(filePath))) {
			return null;
		}

		try {
			const content = await adapter.read(filePath);
			const data = JSON.parse(content);

			// Version check for future compatibility
			if (data.version !== 1) {
				console.warn(
					`[SettingsStore] Unknown session file version: ${data.version}`,
				);
				return null;
			}

			// Deserialize (convert timestamp: string → Date)
			return data.messages.map(
				(msg: {
					id: string;
					role: string;
					content: unknown[];
					timestamp: string;
				}) => ({
					...msg,
					timestamp: new Date(msg.timestamp),
				}),
			);
		} catch (error) {
			console.error(
				`[SettingsStore] Failed to load session messages: ${error}`,
			);
			return null;
		}
	}

	/**
	 * Delete message history file for a session.
	 *
	 * Silently succeeds if file doesn't exist.
	 *
	 * @param sessionId - Session ID
	 */
	async deleteSessionMessages(sessionId: string): Promise<void> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (await adapter.exists(filePath)) {
			await adapter.remove(filePath);
		}
	}
}

/**
 * Create a new settings store instance.
 *
 * Factory function for creating settings stores with initial state.
 *
 * @param initial - Initial plugin settings
 * @param plugin - Plugin instance for persistence
 * @returns New SettingsStore instance
 */
export const createSettingsStore = (
	initial: AgentClientPluginSettings,
	plugin: AgentClientPlugin,
) => new SettingsStore(initial, plugin);
