/**
 * Session storage for persisting session metadata and message history.
 *
 * Handles:
 * - Session metadata CRUD (in plugin settings savedSessions array)
 * - Session message file I/O (sessions/{id}.json)
 */

import { Platform } from "obsidian";

import type { AgentClientPluginSettings } from "../plugin";
import type AgentClientPlugin from "../plugin";
import type { ChatMessage, MessageContent } from "../types/chat";
import type { SavedSessionInfo } from "../types/session";
import { convertWindowsPathToWsl } from "../utils/platform";
import { getLogger } from "../utils/logger";
import { isPermissionPending } from "./message-state";

// ============================================================================
// Types
// ============================================================================

/**
 * Serialized format for session message files.
 */
interface SessionMessagesFile {
	version: number;
	sessionId: string;
	agentId: string;
	/**
	 * Snapshot of the session's index entry (data.json row) as of the last
	 * save. Makes the transcript self-contained: a session evicted from the
	 * capped index keeps its handle — where to reopen it (cwd), its display
	 * name (title), its owning embed block (embedId) — for future
	 * search/restore. Absent in files written before this feature. The index
	 * entry stays authoritative while it exists; this is a copy.
	 */
	cwd?: string;
	title?: string;
	embedId?: string;
	createdAt?: string;
	updatedAt?: string;
	messages: Array<{
		id: string;
		role: "user" | "assistant";
		content: MessageContent[];
		timestamp: string;
	}>;
	savedAt: string;
}

/**
 * Interface for settings access needed by SessionStorage.
 * Subset of SettingsService to avoid circular dependency.
 */
interface SessionStorageSettingsAccess {
	getSnapshot(): AgentClientPluginSettings;
	updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

/** Maximum number of saved sessions to keep */
const MAX_SAVED_SESSIONS = 50;

/**
 * Evict the least-recently-used entries (oldest updatedAt) until the list
 * fits the cap. Reads and the UI order by updatedAt, so eviction must use the
 * same axis — a positional pop() would drop an old-inserted entry that is
 * still in active use. Eviction removes only the index entry: the transcript
 * file under sessions/ is intentionally kept as an archive.
 */
function evictLeastRecentlyUsed(
	sessions: SavedSessionInfo[],
	cap: number,
): void {
	while (sessions.length > cap) {
		let oldest = 0;
		for (let i = 1; i < sessions.length; i++) {
			if (
				new Date(sessions[i].updatedAt).getTime() <
				new Date(sessions[oldest].updatedAt).getTime()
			) {
				oldest = i;
			}
		}
		sessions.splice(oldest, 1);
	}
}

/**
 * Settle permission requests found in a stored transcript.
 *
 * A permission belongs to a live agent process, so anything still undecided
 * on disk died with that process — normally `cancelAll()` records that on
 * disconnect, but a crash leaves the flags as they were. Marking them
 * cancelled (rather than merely inactive) matters: an undecided request keeps
 * its tool call out of the transcript, so leaving one behind would hide that
 * call forever.
 */
function settleStoredPermissions(messages: ChatMessage[]): void {
	for (const message of messages) {
		for (const content of message.content) {
			if (content.type !== "tool_call") continue;
			const permission = content.permissionRequest;
			if (!isPermissionPending(permission)) continue;
			permission.isActive = false;
			permission.isCancelled = true;
		}
	}
}

export class SessionStorage {
	private plugin: AgentClientPlugin;
	private settingsAccess: SessionStorageSettingsAccess;

	/** Lock for session operations to prevent race conditions */
	private sessionLock: Promise<void> = Promise.resolve();

	constructor(
		plugin: AgentClientPlugin,
		settingsAccess: SessionStorageSettingsAccess,
	) {
		this.plugin = plugin;
		this.settingsAccess = settingsAccess;
	}

	// ============================================================
	// Session Metadata Methods
	// ============================================================

	/**
	 * Save a session to local storage.
	 *
	 * Updates existing session if sessionId matches.
	 * Maintains max 50 sessions, removing oldest when exceeded.
	 */
	async saveSession(info: SavedSessionInfo): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			// Convert Windows path to WSL path if in WSL mode
			let sessionInfo = info;
			const state = this.settingsAccess.getSnapshot();
			if (Platform.isWin && state.windowsWslMode && info.cwd) {
				sessionInfo = {
					...info,
					cwd: convertWindowsPathToWsl(info.cwd),
				};
			}

			const sessions = [...(state.savedSessions || [])];

			// Dedup by sessionId only: re-saving the same session updates it in
			// place; a new session accumulates (bounded by MAX_SAVED_SESSIONS).
			// Embedded persist sessions carry an embedId TAG but are NOT deduped
			// or deleted by it — a block's conversations accumulate in Session
			// History like any other session and stay recoverable. Restore
			// resolves the block's latest via getSavedSessionByEmbedId (newest
			// embedId match); nothing is replaced or removed here.
			const existingIndex = sessions.findIndex(
				(s) => s.sessionId === sessionInfo.sessionId,
			);

			if (existingIndex >= 0) {
				sessions[existingIndex] = sessionInfo;
			} else {
				sessions.unshift(sessionInfo);
				evictLeastRecentlyUsed(sessions, MAX_SAVED_SESSIONS);
			}

			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});
		});
		await this.sessionLock;
	}

	/**
	 * Get saved sessions, optionally filtered by agentId and/or cwd.
	 * Returns sessions sorted by updatedAt (newest first).
	 */
	getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[] {
		const state = this.settingsAccess.getSnapshot();
		let sessions = state.savedSessions || [];

		if (agentId) {
			sessions = sessions.filter((s) => s.agentId === agentId);
		}
		if (cwd) {
			let filterCwd = cwd;
			if (Platform.isWin && state.windowsWslMode) {
				filterCwd = convertWindowsPathToWsl(cwd);
			}
			sessions = sessions.filter((s) => s.cwd === filterCwd);
		}

		return [...sessions].sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() -
				new Date(a.updatedAt).getTime(),
		);
	}

	/**
	 * Get the saved session owned by an embedded persist block, identified by
	 * its device-neutral embedId.
	 *
	 * Unlike getSavedSessions(agentId, cwd), this resolves a persist block's
	 * conversation WITHOUT an agent/cwd filter, so an unpinned block that
	 * switched agents — or whose conversation lives under a custom
	 * "New chat in directory…" cwd — still finds its last session (#5, #11).
	 *
	 * Returns the most-recently-updated match, or undefined if none. saveSession
	 * dedups by sessionId ONLY, so a single embedId legitimately accumulates one
	 * row per conversation (the block's history stays recoverable); the newest
	 * by updatedAt is treated as the block's current conversation.
	 */
	getSavedSessionByEmbedId(embedId: string): SavedSessionInfo | undefined {
		const state = this.settingsAccess.getSnapshot();
		const matches = (state.savedSessions || []).filter(
			(s) => s.embedId === embedId,
		);
		if (matches.length === 0) return undefined;
		return matches.reduce((newest, s) =>
			new Date(s.updatedAt).getTime() >
			new Date(newest.updatedAt).getTime()
				? s
				: newest,
		);
	}

	/**
	 * Delete a saved session by sessionId.
	 * Also deletes the associated message history file.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			const state = this.settingsAccess.getSnapshot();
			const sessions = (state.savedSessions || []).filter(
				(s) => s.sessionId !== sessionId,
			);
			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});
			await this.deleteSessionMessages(sessionId);
		});
		await this.sessionLock;
	}

	/**
	 * Update the title of a saved session.
	 * If createIfMissing is provided and session doesn't exist, creates a new entry.
	 */
	async updateSessionTitle(
		sessionId: string,
		newTitle: string,
		createIfMissing?: { agentId: string; cwd: string },
	): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			const state = this.settingsAccess.getSnapshot();
			const sessions = [...(state.savedSessions || [])];
			const idx = sessions.findIndex((s) => s.sessionId === sessionId);

			if (idx >= 0) {
				// Immutable update: replace the object instead of mutating it,
				// matching saveSession's pattern and keeping state objects stable.
				// updatedAt is deliberately NOT bumped: it means "last activity"
				// (types/session.ts) and backs "last used" ordering (#320) plus
				// getSavedSessionByEmbedId's newest-wins resolution — a rename is
				// a metadata edit, not activity, and must not reorder either.
				sessions[idx] = {
					...sessions[idx],
					title: newTitle,
				};
			} else if (createIfMissing) {
				sessions.unshift({
					sessionId,
					agentId: createIfMissing.agentId,
					cwd: createIfMissing.cwd,
					title: newTitle,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				});
				evictLeastRecentlyUsed(sessions, MAX_SAVED_SESSIONS);
			} else {
				return;
			}

			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});

			// Keep the transcript's title snapshot in sync (best-effort;
			// covers the rename-then-never-continue case where no turn-end
			// save would refresh it).
			await this.syncTranscriptTitle(sessionId, newTitle);
		});
		await this.sessionLock;
	}

	/**
	 * Update fields of an existing saved session.
	 * Silently no-op if the session does not exist (no create).
	 * `updatedAt` is set to now unless explicitly provided in `patch`.
	 */
	async updateSession(
		sessionId: string,
		patch: Partial<Omit<SavedSessionInfo, "sessionId" | "createdAt">>,
	): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			const state = this.settingsAccess.getSnapshot();
			const sessions = [...(state.savedSessions || [])];
			const idx = sessions.findIndex((s) => s.sessionId === sessionId);
			if (idx < 0) return;

			sessions[idx] = {
				...sessions[idx],
				...patch,
				updatedAt: patch.updatedAt ?? new Date().toISOString(),
			};
			await this.settingsAccess.updateSettings({
				savedSessions: sessions,
			});
		});
		await this.sessionLock;
	}

	// ============================================================
	// Session Message History Methods
	// ============================================================

	private getSessionsDir(): string {
		return `${this.plugin.app.vault.configDir}/plugins/agent-client/sessions`;
	}

	private async ensureSessionsDir(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const sessionsDir = this.getSessionsDir();
		if (!(await adapter.exists(sessionsDir))) {
			await adapter.mkdir(sessionsDir);
		}
	}

	private getSessionFilePath(sessionId: string): string {
		const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
		return `${this.getSessionsDir()}/${safeId}.json`;
	}

	/**
	 * Save message history for a session.
	 *
	 * Runs inside sessionLock: the transcript file has TWO writers (this
	 * turn-end save and updateSessionTitle's title sync, both full-file
	 * rewrites), so writes must serialize or a rename racing a turn end could
	 * overwrite newer messages with the older array it read. As a bonus, the
	 * snapshot below is taken after any queued rename, so it sees the fresh
	 * title.
	 */
	async saveSessionMessages(
		sessionId: string,
		agentId: string,
		messages: ChatMessage[],
	): Promise<void> {
		this.sessionLock = this.sessionLock.then(async () => {
			await this.ensureSessionsDir();

			// Self-contained archive: snapshot the index entry into the file
			// so an evicted session keeps its handle (cwd/title/embedId/
			// timestamps) for future search/restore. If the entry is already
			// gone (evicted while the session stayed open), carry the previous
			// snapshot over from the existing file instead of dropping it on
			// rewrite.
			const entry = (
				this.settingsAccess.getSnapshot().savedSessions || []
			).find((s) => s.sessionId === sessionId);
			const meta = entry
				? {
						cwd: entry.cwd,
						title: entry.title,
						embedId: entry.embedId,
						createdAt: entry.createdAt,
						updatedAt: entry.updatedAt,
					}
				: await this.readExistingMeta(sessionId);

			const serialized = messages.map((msg) => ({
				...msg,
				timestamp: msg.timestamp.toISOString(),
			}));

			const data = {
				version: 1,
				sessionId,
				agentId,
				// undefined values are dropped by JSON.stringify, so absent
				// fields (e.g. no title yet) never appear as null in the file.
				...meta,
				messages: serialized,
				savedAt: new Date().toISOString(),
			};

			const filePath = this.getSessionFilePath(sessionId);
			await this.plugin.app.vault.adapter.write(
				filePath,
				JSON.stringify(data, null, 2),
			);
		});
		await this.sessionLock;
	}

	/**
	 * Load message history for a session.
	 * Returns null if file doesn't exist or on error.
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
			const data = JSON.parse(content) as SessionMessagesFile;

			if (
				typeof data.version !== "number" ||
				!Array.isArray(data.messages)
			) {
				getLogger().debug(
					`[SessionStorage] Invalid session file structure: ${filePath}`,
				);
				return null;
			}

			if (data.version !== 1) {
				getLogger().debug(
					`[SessionStorage] Unknown session file version: ${data.version}`,
				);
				return null;
			}

			const messages = data.messages.map((msg) => ({
				...msg,
				timestamp: new Date(msg.timestamp),
			}));
			settleStoredPermissions(messages);
			return messages;
		} catch (error) {
			getLogger().error(
				`[SessionStorage] Failed to load session messages: ${error}`,
			);
			return null;
		}
	}

	/**
	 * Carry-over: read the metadata snapshot from an existing transcript file.
	 * Used when the index entry was evicted while the session stayed open, so
	 * a rewrite does not drop the previously saved handle.
	 */
	private async readExistingMeta(
		sessionId: string,
	): Promise<
		Partial<
			Pick<
				SessionMessagesFile,
				"cwd" | "title" | "embedId" | "createdAt" | "updatedAt"
			>
		>
	> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (!(await adapter.exists(filePath))) return {};
			const data = JSON.parse(
				await adapter.read(filePath),
			) as SessionMessagesFile;
			if (!data || typeof data !== "object") return {};
			return {
				cwd: data.cwd,
				title: data.title,
				embedId: data.embedId,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			};
		} catch {
			return {};
		}
	}

	/**
	 * Best-effort: patch the title snapshot inside an existing transcript file
	 * so a rename stays visible in the archive even if the session is never
	 * continued (no turn-end save would refresh it). The index entry is
	 * authoritative while it exists; failures are silently ignored and the
	 * snapshot self-heals on the next turn-end save.
	 */
	private async syncTranscriptTitle(
		sessionId: string,
		newTitle: string,
	): Promise<void> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (!(await adapter.exists(filePath))) return;
			const data = JSON.parse(
				await adapter.read(filePath),
			) as SessionMessagesFile;
			if (!data || typeof data !== "object") return;
			data.title = newTitle;
			await adapter.write(filePath, JSON.stringify(data, null, 2));
		} catch (error) {
			getLogger().debug(
				`[SessionStorage] Failed to sync transcript title: ${error}`,
			);
		}
	}

	/**
	 * Delete message history file for a session.
	 * Silently succeeds if file doesn't exist.
	 */
	async deleteSessionMessages(sessionId: string): Promise<void> {
		const filePath = this.getSessionFilePath(sessionId);
		const adapter = this.plugin.app.vault.adapter;

		if (await adapter.exists(filePath)) {
			await adapter.remove(filePath);
		}
	}
}
