import { useState, useCallback, useRef, useMemo } from "react";
import type { SessionInfo } from "../domain/models/session-info";
import type { ChatMessage } from "../domain/models/chat-message";
import {
	getSessionCapabilityFlags,
	type SessionCapabilityFlags,
} from "../shared/session-capability-utils";
import {
	fetchSessionsOperation,
	forkSessionOperation,
	loadMoreSessionsOperation,
	restoreSessionOperation,
} from "./session-history/session-history-ops";
import {
	CACHE_EXPIRY_MS,
	type SessionCache,
	type UseSessionHistoryOptions,
	type UseSessionHistoryReturn,
} from "./session-history/types";

export type {
	MessagesRestoreCallback,
	SessionLoadCallback,
	UseSessionHistoryOptions,
	UseSessionHistoryReturn,
} from "./session-history/types";

/**
 * Hook for managing session history.
 *
 * Handles listing, loading, resuming, forking, and caching of previous chat sessions.
 * Integrates with the ACP client to fetch session metadata and
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
		cwd,
		onSessionLoad,
		onMessagesRestore,
		onLoadStart,
		onLoadEnd,
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
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
	const [localSessionIds, setLocalSessionIds] = useState<Set<string>>(
		new Set(),
	);

	// Cache reference (not state to avoid re-renders)
	const cacheRef = useRef<SessionCache | null>(null);
	const currentCwdRef = useRef<string | undefined>(undefined);

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
				setLocalSessionIds(new Set(localSessions.map((s) => s.sessionId)));
				setNextCursor(undefined); // No pagination for local sessions
				setError(null);
				return;
			}

			// Check cache first
			if (isCacheValid(cwd)) {
				// Update localSessionIds even on cache hit
				const localSessions = settingsAccess.getSavedSessions(
					session.agentId,
					cwd,
				);
				setLocalSessionIds(new Set(localSessions.map((s) => s.sessionId)));
				const cached = cacheRef.current;
				if (cached) {
					setSessions(cached.sessions);
					setNextCursor(cached.nextCursor);
				}
				setError(null);
				return;
			}

			setLoading(true);
			setError(null);
			currentCwdRef.current = cwd;

			try {
				const result = await fetchSessionsOperation({
					agentClient,
					settingsAccess,
					sessionAgentId: session.agentId,
					cwd,
				});
				setSessions(result.sessions);
				setLocalSessionIds(result.localSessionIds);
				setNextCursor(result.nextCursor);

				// Update cache (with merged titles)
				cacheRef.current = {
					sessions: result.sessions,
					nextCursor: result.nextCursor,
					cwd,
					timestamp: Date.now(),
				};
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				setError(`Failed to fetch sessions: ${errorMessage}`);
				setSessions([]);
				setNextCursor(undefined);
			} finally {
				setLoading(false);
			}
		},
		[
			agentClient,
			capabilities.canList,
			canPerformAnyOperation,
			isCacheValid,
			settingsAccess,
			session.agentId,
		],
	);

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	const loadMoreSessions = useCallback(async () => {
		// Guard: Check if there's more to load
		if (!nextCursor || !capabilities.canList) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const result = await loadMoreSessionsOperation({
				agentClient,
				settingsAccess,
				sessionAgentId: session.agentId,
				cwd: currentCwdRef.current,
				cursor: nextCursor,
			});

			// Append new sessions to existing list (use functional setState)
			setSessions((prev) => [...prev, ...result.sessions]);
			setLocalSessionIds(result.localSessionIds);
			setNextCursor(result.nextCursor);

			// Update cache with appended sessions (with merged titles)
			if (cacheRef.current) {
				cacheRef.current = {
					...cacheRef.current,
					sessions: [...cacheRef.current.sessions, ...result.sessions],
					nextCursor: result.nextCursor,
					timestamp: Date.now(),
				};
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			setError(`Failed to load more sessions: ${errorMessage}`);
		} finally {
			setLoading(false);
		}
	}, [
		agentClient,
		capabilities.canList,
		nextCursor,
		settingsAccess,
		session.agentId,
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
				await restoreSessionOperation({
					agentClient,
					settingsAccess,
					capabilities: {
						canLoad: capabilities.canLoad,
						canResume: capabilities.canResume,
					},
					sessionId,
					cwd,
					onSessionLoad,
					onMessagesRestore,
					onLoadStart,
					onLoadEnd,
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
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
			onLoadStart,
			onLoadEnd,
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
				await forkSessionOperation({
					agentClient,
					settingsAccess,
					session,
					sessions,
					sessionId,
					cwd,
					onSessionLoad,
					onMessagesRestore,
					invalidateCache,
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
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
	 */
	const deleteSession = useCallback(
		async (sessionId: string) => {
			try {
				// Delete from persistent storage (metadata + message file)
				await settingsAccess.deleteSession(sessionId);

				// Remove from local state
				setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));

				// Invalidate cache to ensure consistency
				invalidateCache();
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				setError(`Failed to delete session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			}
		},
		[settingsAccess, invalidateCache],
	);

	/**
	 * Save session metadata locally.
	 * Called when the first message is sent in a new session.
	 */
	const saveSessionLocally = useCallback(
		async (sessionId: string, messageContent: string) => {
			if (!session.agentId) return;

			const title =
				messageContent.length > 50
					? messageContent.substring(0, 50) + "..."
					: messageContent;

			await settingsAccess.saveSession({
				sessionId,
				agentId: session.agentId,
				cwd,
				title,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		},
		[session.agentId, cwd, settingsAccess],
	);

	/**
	 * Save session messages locally.
	 * Called when a turn ends (agent response complete).
	 * Fire-and-forget (does not block UI).
	 */
	const saveSessionMessages = useCallback(
		(
			sessionId: string,
			messages: ChatMessage[],
		) => {
			if (!session.agentId || messages.length === 0) return;

			// Fire-and-forget
			void settingsAccess.saveSessionMessages(
				sessionId,
				session.agentId,
				messages,
			);
		},
		[session.agentId, settingsAccess],
	);

	return {
		sessions,
		loading,
		error,
		hasMore: nextCursor !== undefined,

		// Capability flags
		// Show session history UI if any session capability is available
		canShowSessionHistory:
			capabilities.canList ||
			capabilities.canLoad ||
			capabilities.canResume ||
			capabilities.canFork,
		canRestore: capabilities.canLoad || capabilities.canResume,
		canFork: capabilities.canFork,
		canList: capabilities.canList,
		isUsingLocalSessions: !capabilities.canList,
		localSessionIds,

		// Methods
		fetchSessions,
		loadMoreSessions,
		restoreSession,
		forkSession,
		deleteSession,
		saveSessionLocally,
		saveSessionMessages,
		invalidateCache,
	};
}
