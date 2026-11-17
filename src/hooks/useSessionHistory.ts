import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { AcpClient } from "../acp/acp-client";
import type { ISettingsAccess } from "../services/settings-service";
import type {
	SessionInfo,
	ListSessionsResult,
	SavedSessionInfo,
	ChatSession,
	SessionModeState,
	SessionConfigOption,
	AgentCapabilities,
} from "../types/session";
import type { ChatMessage } from "../types/chat";
import { extractErrorMessage } from "../utils/error-utils";
import { truncateTitle } from "../utils/text";
import { getLogger } from "../utils/logger";
import { appendUniqueSessions, nextPageCursor } from "../utils/session-list";

// ============================================================================
// Session Capability Helpers (from session-capability-utils.ts)
// ============================================================================

interface SessionCapabilityFlags {
	/** Whether session/load is supported (stable) */
	canLoad: boolean;
	/** Whether session/resume is supported (unstable) */
	canResume: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether session/delete is supported */
	canDelete: boolean;
}

function getSessionCapabilityFlags(
	agentCapabilities?: AgentCapabilities,
): SessionCapabilityFlags {
	const sessionCaps = agentCapabilities?.sessionCapabilities;
	return {
		canLoad: agentCapabilities?.loadSession === true,
		canResume: sessionCaps?.resume !== undefined,
		canFork: sessionCaps?.fork !== undefined,
		canList: sessionCaps?.list !== undefined,
		canDelete: sessionCaps?.delete !== undefined,
	};
}

// ============================================================================
// Types
// ============================================================================

/**
 * Callback invoked when a session is successfully loaded/resumed/forked.
 * Provides the loaded session metadata to integrate with chat state.
 *
 * Note: Conversation history for load is received via session/update notifications,
 * not via this callback.
 */
export interface SessionLoadCallback {
	/**
	 * @param sessionId - ID of the session (new session ID for fork)
	 * @param modes - Available modes from the session
	 * @param configOptions - Config options from the session
	 */
	(
		sessionId: string,
		modes?: SessionModeState,
		configOptions?: SessionConfigOption[],
	): void;
}

/**
 * Callback invoked when messages should be restored from local storage.
 * Used for resume/fork operations where the agent doesn't return history.
 */
export interface MessagesRestoreCallback {
	/**
	 * @param messages - Messages to restore
	 */
	(messages: ChatMessage[]): void;
}

/**
 * Options for useSessionHistory hook.
 */
export interface UseSessionHistoryOptions {
	/** Agent client for session operations */
	agentClient: AcpClient;
	/** Current session (used to access agentCapabilities and agentId) */
	session: ChatSession;
	/** Settings access for local session storage */
	settingsAccess: ISettingsAccess;
	/** Vault root path — used for session list filtering */
	cwd: string;
	/** Agent working directory — used for saving new session metadata */
	agentCwd: string;
	/** Callback invoked when a session is loaded/resumed/forked */
	onSessionLoad: SessionLoadCallback;
	/** Callback invoked when messages should be restored from local storage */
	onMessagesRestore?: MessagesRestoreCallback;
	/** Control whether useMessages ignores incoming updates (for history replay suppression) */
	onIgnoreUpdates?: (ignore: boolean) => void;
	/** Clear messages before restoring from local storage */
	onClearMessages?: () => void;
}

/**
 * Return type for useSessionHistory hook.
 */
export interface UseSessionHistoryReturn {
	/** List of sessions */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/**
	 * Error message if fetching the next page failed. Separate from `error`:
	 * the pages already loaded stay usable.
	 */
	loadMoreError: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;

	// Capability flags (from session.agentCapabilities)
	/** Whether session history UI should be shown */
	canShowSessionHistory: boolean;
	/** Whether session can be restored (load or resume supported) */
	canRestore: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether deleting also deletes the session on the agent side (session/delete) */
	canDelete: boolean;
	/** Whether sessions are from local storage (agent doesn't support list) */
	isUsingLocalSessions: boolean;

	/** Set of session IDs that have local data (for UI filtering) */
	localSessionIds: Set<string>;

	/**
	 * Fetch sessions list from agent.
	 * Replaces existing sessions in state.
	 * @param cwd - Optional working directory filter
	 */
	fetchSessions: (cwd?: string) => Promise<void>;

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	loadMoreSessions: () => Promise<void>;

	/**
	 * Restore a specific session by ID.
	 * Uses load if available (with history replay), otherwise resume (without history replay).
	 * Only available if canRestore is true.
	 * @param sessionId - Session to restore
	 * @param cwd - Working directory for the session
	 */
	restoreSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Fork a specific session to create a new branch.
	 * Only available if canFork is true.
	 * @param sessionId - Session to fork
	 * @param cwd - Working directory for the session
	 */
	forkSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Delete a session: on the agent side when canDelete, then the local
	 * metadata + message file.
	 * @param sessionId - Session to delete
	 */
	deleteSession: (sessionId: string) => Promise<void>;

	/**
	 * Update the title of a saved session.
	 * @param sessionId - Session to update
	 * @param newTitle - New title string
	 * @param sessionCwd - Original cwd of the session (used when creating a new local entry)
	 */
	updateSessionTitle: (
		sessionId: string,
		newTitle: string,
		sessionCwd: string,
	) => Promise<void>;

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 * @param sessionId - Session ID to save
	 * @param messageContent - First message content (used to generate title)
	 */
	saveSessionLocally: (
		sessionId: string,
		messageContent: string,
		embedId?: string,
	) => Promise<void>;

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * @param sessionId - Session ID
	 * @param messages - Messages to save
	 */
	saveSessionMessages: (
		sessionId: string,
		messages: import("../types/chat").ChatMessage[],
	) => void;

	/**
	 * Invalidate the session cache.
	 * Call this when creating a new session to refresh the list.
	 */
	invalidateCache: () => void;
}

/**
 * Cache entry for session list.
 */
interface SessionCache {
	sessions: SessionInfo[];
	nextCursor?: string;
	cwd?: string;
	timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Cache expiry time in milliseconds (5 minutes) */
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Merge agent sessions with locally saved titles.
 * Prefers local titles over agent-provided titles for better UX.
 *
 * Some agents return poor quality titles (e.g., "ACP Session {id}" or
 * system prompt text), so we prefer locally saved titles when available.
 *
 * @param agentSessions - Sessions from agent's session/list
 * @param localSessions - Locally saved session metadata
 * @returns Sessions with local titles merged in
 */
function mergeWithLocalTitles(
	agentSessions: SessionInfo[],
	localSessions: SavedSessionInfo[],
): SessionInfo[] {
	// Create a map for O(1) lookup
	const localMap = new Map(localSessions.map((s) => [s.sessionId, s]));

	return agentSessions.map((s) => {
		const local = localMap.get(s.sessionId);
		return {
			...s,
			title: local?.title ?? s.title,
		};
	});
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing session history.
 *
 * Handles listing, loading, resuming, forking, and caching of previous chat sessions.
 * Integrates with the agent client to fetch session metadata and
 * load previous conversations.
 *
 * Capability detection is based on session.agentCapabilities, which is set
 * during initialization and persists for the session lifetime.
 *
 * @param options - Hook options including agentClient, session, and onSessionLoad
 */
export function useSessionHistory(
	options: UseSessionHistoryOptions,
): UseSessionHistoryReturn {
	const {
		agentClient,
		session,
		settingsAccess,
		agentCwd,
		onSessionLoad,
		onMessagesRestore,
		onIgnoreUpdates,
		onClearMessages,
	} = options;

	// Derive capability flags from session.agentCapabilities
	const capabilities: SessionCapabilityFlags = useMemo(
		() => getSessionCapabilityFlags(session.agentCapabilities),
		[session.agentCapabilities],
	);

	// State
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
	const [localSessionIds, setLocalSessionIds] = useState<Set<string>>(
		new Set(),
	);

	// Cache reference (not state to avoid re-renders)
	const cacheRef = useRef<SessionCache | null>(null);
	const currentCwdRef = useRef<string | undefined>(undefined);
	// Bumped by every fetchSessions: a list response (first page or a later
	// one) that arrives after the list was re-fetched — e.g. the cwd filter
	// was toggled while the modal was paging — belongs to a stale listing
	// and is dropped instead of being merged into the new one.
	const listGenerationRef = useRef(0);
	// The cursor of the listing on show, read by loadMoreSessions instead of
	// the `nextCursor` its closure saw: the modal can call a loadMoreSessions
	// from before a re-fetch (its first render on reopening uses the props it
	// last had), and that must not page on with the replaced listing's cursor.
	const nextCursorRef = useRef<string | undefined>(undefined);
	// Generation of the next-page request in flight, so pages are fetched one
	// at a time
	const loadMoreGenerationRef = useRef<number | null>(null);
	// Cursors already used for the listing on show (see nextPageCursor)
	const usedCursorsRef = useRef(new Set<string>());

	const setCursor = useCallback((cursor: string | undefined) => {
		nextCursorRef.current = cursor;
		setNextCursor(cursor);
	}, []);

	// External rename detection: when `savedSessions` changes (e.g. via Session
	// Manager's Rename), re-merge titles into the currently displayed list
	// without re-fetching from the agent. Subscribe to settings directly (rather
	// than via useSettings) so we don't re-render on unrelated settings slices
	// (windowsWslMode, fontSize, etc.). Reference comparison is sufficient
	// because SessionStorage always writes a fresh `savedSessions` array.
	const lastSavedSessionsRef = useRef<SavedSessionInfo[] | null>(null);

	useEffect(() => {
		return settingsAccess.subscribe(() => {
			const next = settingsAccess.getSnapshot().savedSessions ?? [];
			if (next === lastSavedSessionsRef.current) return;
			lastSavedSessionsRef.current = next;

			const localSessions = settingsAccess.getSavedSessions(
				session.agentId,
			);
			setSessions((prev) => {
				if (prev.length === 0) return prev;
				const merged = mergeWithLocalTitles(prev, localSessions);
				// Skip render if no title actually changed
				const unchanged =
					merged.length === prev.length &&
					merged.every((s, i) => s.title === prev[i].title);
				return unchanged ? prev : merged;
			});
			setLocalSessionIds(new Set(localSessions.map((s) => s.sessionId)));
		});
	}, [settingsAccess, session.agentId]);

	/**
	 * Check if cache is valid.
	 */
	const isCacheValid = useCallback((cwd?: string): boolean => {
		if (!cacheRef.current) return false;

		// Check if cwd matches
		if (cacheRef.current.cwd !== cwd) return false;

		// Check if cache has expired
		const age = Date.now() - cacheRef.current.timestamp;
		return age < CACHE_EXPIRY_MS;
	}, []);

	/**
	 * Invalidate the cache.
	 */
	const invalidateCache = useCallback(() => {
		cacheRef.current = null;
	}, []);

	// Check if any restoration operation is available
	const canPerformAnyOperation =
		capabilities.canLoad || capabilities.canResume || capabilities.canFork;

	/**
	 * Fetch sessions list from agent or local storage.
	 * Uses agent's session/list if supported, otherwise falls back to local storage.
	 * For agents that don't support restoration, local sessions are used for deletion.
	 * Replaces existing sessions in state.
	 */
	const fetchSessions = useCallback(
		async (cwd?: string) => {
			const generation = ++listGenerationRef.current;
			// From here on, the listing being shown is this fetch's: its
			// scope, and no cursor until it has one
			currentCwdRef.current = cwd;
			nextCursorRef.current = undefined;
			usedCursorsRef.current = new Set();
			setLoadMoreError(null);

			// Use local sessions if:
			// - Agent doesn't support session/list, OR
			// - Agent doesn't support any restoration operation (for delete only)
			const shouldUseLocalSessions =
				!capabilities.canList || !canPerformAnyOperation;

			if (shouldUseLocalSessions) {
				// Get locally saved sessions for this agent
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);

				// Convert SavedSessionInfo to SessionInfo format
				const sessionInfos: SessionInfo[] = localSessions.map((s) => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title,
					updatedAt: s.updatedAt,
				}));

				setSessions(sessionInfos);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				setCursor(undefined); // No pagination for local sessions
				setError(null);
				// A superseded in-flight request no longer clears `loading`.
				setLoading(false);
				return;
			}

			// Check cache first
			if (isCacheValid(cwd)) {
				// Update localSessionIds even on cache hit
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				// Re-merge with local titles to pick up newly saved session titles
				const sessionsWithLocalTitles = mergeWithLocalTitles(
					cacheRef.current!.sessions,
					localSessions,
				);
				setSessions(sessionsWithLocalTitles);
				setCursor(cacheRef.current!.nextCursor);
				setError(null);
				setLoading(false);
				return;
			}

			setLoading(true);
			setError(null);

			try {
				const result: ListSessionsResult =
					await agentClient.listSessions(cwd);
				if (generation !== listGenerationRef.current) return;

				// Merge with local titles for better UX
				// (some agents return poor quality titles)
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);
				const sessionsWithLocalTitles = mergeWithLocalTitles(
					result.sessions,
					localSessions,
				);

				// Update state
				setSessions(sessionsWithLocalTitles);
				setLocalSessionIds(
					new Set(localSessions.map((s) => s.sessionId)),
				);
				setCursor(result.nextCursor);

				// Update cache (with merged titles)
				cacheRef.current = {
					sessions: sessionsWithLocalTitles,
					nextCursor: result.nextCursor,
					cwd,
					timestamp: Date.now(),
				};
			} catch (err) {
				if (generation !== listGenerationRef.current) return;
				const errorMessage = extractErrorMessage(err);
				setError(`Failed to fetch sessions: ${errorMessage}`);
				setSessions([]);
				setCursor(undefined);
			} finally {
				if (generation === listGenerationRef.current) {
					setLoading(false);
				}
			}
		},
		[
			agentClient,
			capabilities.canList,
			canPerformAnyOperation,
			isCacheValid,
			settingsAccess,
			session.agentId,
			setCursor,
		],
	);

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	const loadMoreSessions = useCallback(async () => {
		const cursor = nextCursorRef.current;
		const cwd = currentCwdRef.current;
		const generation = listGenerationRef.current;
		// Guard: more to load, and no page of this listing already on its way
		if (
			!cursor ||
			!capabilities.canList ||
			loadMoreGenerationRef.current === generation
		) {
			return;
		}

		loadMoreGenerationRef.current = generation;
		usedCursorsRef.current.add(cursor);
		setLoading(true);
		setLoadMoreError(null);

		try {
			const result: ListSessionsResult = await agentClient.listSessions(
				cwd,
				cursor,
			);
			if (generation !== listGenerationRef.current) return;

			// Merge with local titles for better UX
			// (some agents return poor quality titles)
			const localSessions = settingsAccess.getSavedSessions(
				session.agentId,
				cwd,
			);
			const sessionsWithLocalTitles = mergeWithLocalTitles(
				result.sessions,
				localSessions,
			);
			// A cursor handed back again ends the listing instead of paging
			// in a circle
			const newCursor = nextPageCursor(
				result.nextCursor,
				usedCursorsRef.current,
			);
			if (newCursor === undefined && result.nextCursor !== undefined) {
				getLogger().warn(
					`[useSessionHistory] session/list returned a cursor already used for this listing (${result.nextCursor}); ending the listing`,
				);
			}

			// Append new sessions to existing list (use functional setState)
			setSessions((prev) =>
				appendUniqueSessions(prev, sessionsWithLocalTitles),
			);
			setLocalSessionIds(new Set(localSessions.map((s) => s.sessionId)));
			setCursor(newCursor);

			// Update cache with appended sessions (with merged titles)
			if (cacheRef.current) {
				cacheRef.current = {
					...cacheRef.current,
					sessions: appendUniqueSessions(
						cacheRef.current.sessions,
						sessionsWithLocalTitles,
					),
					nextCursor: newCursor,
					timestamp: Date.now(),
				};
			}
		} catch (err) {
			if (generation !== listGenerationRef.current) return;
			const errorMessage = extractErrorMessage(err);
			setLoadMoreError(`Failed to load more sessions: ${errorMessage}`);
		} finally {
			if (loadMoreGenerationRef.current === generation) {
				loadMoreGenerationRef.current = null;
			}
			if (generation === listGenerationRef.current) {
				setLoading(false);
			}
		}
	}, [
		agentClient,
		capabilities.canList,
		settingsAccess,
		session.agentId,
		setCursor,
	]);

	/**
	 * Restore a specific session by ID.
	 * Uses load if available (with history replay), otherwise resume (without history replay).
	 */
	const restoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				// IMPORTANT: Update session.sessionId BEFORE calling restore
				// so that session/update notifications are not ignored
				onSessionLoad(sessionId, undefined, undefined);

				if (capabilities.canLoad) {
					// Check local messages first to decide whether to use them or agent replay
					const localMessages =
						await settingsAccess.loadSessionMessages(sessionId);

					if (localMessages && onMessagesRestore) {
						// Local messages available: ignore agent replay, restore from local
						onIgnoreUpdates?.(true);
						onClearMessages?.();
						try {
							const result = await agentClient.loadSession(
								sessionId,
								cwd,
							);
							onSessionLoad(
								result.sessionId,
								result.modes,
								result.configOptions,
							);
							onMessagesRestore(localMessages);
						} finally {
							onIgnoreUpdates?.(false);
						}
					} else {
						// No local messages: let agent replay flow through to UI
						const result = await agentClient.loadSession(
							sessionId,
							cwd,
						);
						onSessionLoad(
							result.sessionId,
							result.modes,
							result.configOptions,
						);
					}
				} else if (capabilities.canResume) {
					// Use resume (without history replay, restore from local storage)
					const result = await agentClient.resumeSession(
						sessionId,
						cwd,
					);
					onSessionLoad(
						result.sessionId,
						result.modes,
						result.configOptions,
					);

					// Resume doesn't return history, so restore from local storage
					const localMessages =
						await settingsAccess.loadSessionMessages(sessionId);
					if (localMessages && onMessagesRestore) {
						onMessagesRestore(localMessages);
					}
				} else {
					throw new Error("Session restoration is not supported");
				}
			} catch (err) {
				const errorMessage = extractErrorMessage(err);
				setError(`Failed to restore session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			capabilities.canLoad,
			capabilities.canResume,
			onSessionLoad,
			settingsAccess,
			onMessagesRestore,
			onIgnoreUpdates,
			onClearMessages,
		],
	);

	/**
	 * Fork a specific session to create a new branch.
	 * Note: For fork, we update sessionId AFTER the call since a new session ID is created.
	 * Restores messages from the original session's local storage since agent doesn't return history.
	 */
	const forkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				const result = await agentClient.forkSession(sessionId, cwd);

				// Update with new session ID and modes/models from result
				// For fork, the new session ID is returned in result
				onSessionLoad(
					result.sessionId,
					result.modes,
					result.configOptions,
				);

				// Fork doesn't return history, so restore from original session's local storage
				const localMessages =
					await settingsAccess.loadSessionMessages(sessionId);
				if (localMessages && onMessagesRestore) {
					onMessagesRestore(localMessages);
				}

				// Save forked session to history
				if (session.agentId) {
					const originalSession = sessions.find(
						(s) => s.sessionId === sessionId,
					);
					const originalTitle = originalSession?.title ?? "Session";

					// Keep "Fork: " prefix intact; truncate only the base.
					const prefix = "Fork: ";
					const newTitle = `${prefix}${truncateTitle(originalTitle, 50 - prefix.length)}`;

					const now = new Date().toISOString();

					await settingsAccess.saveSession({
						sessionId: result.sessionId,
						agentId: session.agentId,
						cwd,
						title: newTitle,
						createdAt: now,
						updatedAt: now,
					});

					// Save messages under new session ID for restore after restart
					if (localMessages) {
						void settingsAccess.saveSessionMessages(
							result.sessionId,
							session.agentId,
							localMessages,
						);
					}
				}

				// Invalidate cache since a new session was created
				invalidateCache();
			} catch (err) {
				const errorMessage = extractErrorMessage(err);
				setError(`Failed to fork session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			onSessionLoad,
			settingsAccess,
			onMessagesRestore,
			invalidateCache,
			session.agentId,
			sessions,
		],
	);

	/**
	 * Delete a session (local metadata + message file).
	 * Removes from both local state and persistent storage.
	 *
	 * Failures are thrown for the caller to report, not put in `error`: that
	 * would swap the whole list for an error panel.
	 */
	const deleteSession = useCallback(
		async (sessionId: string) => {
			// Agent side first. The agent keeps listing a session the plugin
			// forgot, so deleting only the local copy would bring it back on
			// the next fetch; and if the agent refuses, nothing is gone yet
			// and the delete can simply be retried.
			if (capabilities.canDelete) {
				await agentClient.deleteSession(sessionId);
			}

			// Delete from persistent storage (metadata + message file)
			await settingsAccess.deleteSession(sessionId);

			// Remove from local state
			setSessions((prev) =>
				prev.filter((s) => s.sessionId !== sessionId),
			);

			// Invalidate cache to ensure consistency
			invalidateCache();
		},
		[agentClient, capabilities.canDelete, settingsAccess, invalidateCache],
	);

	/**
	 * Update the title of a saved session.
	 * Updates both local state and persistent storage.
	 */
	const updateSessionTitle = useCallback(
		async (sessionId: string, newTitle: string, sessionCwd: string) => {
			const savedSessions = settingsAccess.getSavedSessions();
			const existing = savedSessions.find(
				(s) => s.sessionId === sessionId,
			);
			const previousTitle = existing?.title;

			// Optimistic update
			setSessions((prev) =>
				prev.map((s) =>
					s.sessionId === sessionId ? { ...s, title: newTitle } : s,
				),
			);

			try {
				await settingsAccess.updateSessionTitle(sessionId, newTitle, {
					agentId: session.agentId,
					cwd: sessionCwd,
				});
				invalidateCache();
			} catch (err) {
				// Rollback
				setSessions((prev) =>
					prev.map((s) =>
						s.sessionId === sessionId
							? { ...s, title: previousTitle }
							: s,
					),
				);
				const errorMessage = extractErrorMessage(err);
				setError(`Failed to update title: ${errorMessage}`);
				throw err;
			}
		},
		[settingsAccess, session.agentId, invalidateCache],
	);

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 */
	const saveSessionLocally = useCallback(
		async (
			sessionId: string,
			messageContent: string,
			embedId?: string,
		) => {
			if (!session.agentId) return;

			const title = truncateTitle(messageContent);

			await settingsAccess.saveSession({
				sessionId,
				agentId: session.agentId,
				cwd: agentCwd,
				title,
				embedId,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		},
		[session.agentId, agentCwd, settingsAccess],
	);

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * Fire-and-forget (does not block UI).
	 *
	 * Also bumps the session's `updatedAt` metadata so that
	 * `getSavedSessions()` (sorted by updatedAt desc) reflects actual
	 * activity rather than just session-creation time (#257).
	 */
	const saveSessionMessages = useCallback(
		(
			sessionId: string,
			messages: import("../types/chat").ChatMessage[],
		) => {
			if (!session.agentId || messages.length === 0) return;

			// Persist message content (fire-and-forget)
			void settingsAccess.saveSessionMessages(
				sessionId,
				session.agentId,
				messages,
			);

			// Bump updatedAt on session metadata so "last used" ordering
			// reflects real activity. `updateSession` is a no-op if the entry
			// hasn't landed yet — saveSessionLocally will create it on the
			// first-message path.
			void settingsAccess.updateSession(sessionId, {
				updatedAt: new Date().toISOString(),
			});
		},
		[session.agentId, settingsAccess],
	);

	return useMemo(
		() => ({
			sessions,
			loading,
			error,
			loadMoreError,
			hasMore: nextCursor !== undefined,

			// Capability flags
			canShowSessionHistory:
				capabilities.canList ||
				capabilities.canLoad ||
				capabilities.canResume ||
				capabilities.canFork,
			canRestore: capabilities.canLoad || capabilities.canResume,
			canFork: capabilities.canFork,
			canList: capabilities.canList,
			canDelete: capabilities.canDelete,
			isUsingLocalSessions: !capabilities.canList,
			localSessionIds,

			// Methods
			fetchSessions,
			loadMoreSessions,
			restoreSession,
			forkSession,
			deleteSession,
			updateSessionTitle,
			saveSessionLocally,
			saveSessionMessages,
			invalidateCache,
		}),
		[
			sessions,
			loading,
			error,
			loadMoreError,
			nextCursor,
			capabilities.canList,
			capabilities.canLoad,
			capabilities.canResume,
			capabilities.canFork,
			capabilities.canDelete,
			localSessionIds,
			fetchSessions,
			loadMoreSessions,
			restoreSession,
			forkSession,
			deleteSession,
			updateSessionTitle,
			saveSessionLocally,
			saveSessionMessages,
			invalidateCache,
		],
	);
}
