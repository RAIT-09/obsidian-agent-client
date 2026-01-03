import { useState, useCallback, useRef } from "react";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type {
	SessionInfo,
	ListSessionsResult,
	LoadSessionResult,
} from "../domain/models/session-info";
import type {
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";

// ============================================================================
// Types
// ============================================================================

/**
 * Callback invoked when a session is successfully loaded.
 * Provides the loaded session metadata to integrate with chat state.
 */
export interface SessionLoadCallback {
	/**
	 * @param sessionId - ID of the loaded session (or new session ID if different)
	 * @param modes - Available modes from the loaded session
	 * @param models - Available models from the loaded session
	 * @param conversationHistory - Conversation history from the loaded session
	 */
	(
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
		conversationHistory?: Array<{
			role: string;
			content: Array<{ type: string; text: string }>;
			timestamp?: string;
		}>,
	): void;
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
	/** Whether there are more sessions to load */
	hasMore: boolean;

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
	 * Load a specific session by ID.
	 * @param sessionId - Session to load
	 * @param workingDirectory - Working directory for the session
	 */
	loadSession: (sessionId: string, workingDirectory: string) => Promise<void>;

	/**
	 * Delete a session by ID.
	 * @param sessionId - Session to delete
	 * @param workingDirectory - Working directory for the session
	 */
	deleteSession: (sessionId: string, workingDirectory: string) => Promise<void>;

	/**
	 * Rename a session by ID.
	 * @param sessionId - Session to rename
	 * @param newTitle - New title for the session
	 */
	renameSession: (sessionId: string, newTitle: string) => Promise<void>;

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

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing session history.
 *
 * Handles listing, loading, and caching of previous chat sessions.
 * Integrates with the agent client to fetch session metadata and
 * load previous conversations.
 *
 * @param agentClient - Agent client for session operations
 * @param onSessionLoad - Callback invoked when a session is loaded
 */
export function useSessionHistory(
	agentClient: IAgentClient,
	onSessionLoad: SessionLoadCallback,
): UseSessionHistoryReturn {
	// State
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);

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

	/**
	 * Fetch sessions list from agent.
	 * Replaces existing sessions in state.
	 */
	const fetchSessions = useCallback(
		async (cwd?: string) => {
			// Check cache first
			if (isCacheValid(cwd)) {
				setSessions(cacheRef.current!.sessions);
				setNextCursor(cacheRef.current!.nextCursor);
				setError(null);
				return;
			}

			setLoading(true);
			setError(null);
			currentCwdRef.current = cwd;

			try {
				const result: ListSessionsResult =
					await agentClient.listSessions(cwd);

				// Update state
				setSessions(result.sessions);
				setNextCursor(result.nextCursor);

				// Update cache
				cacheRef.current = {
					sessions: result.sessions,
					nextCursor: result.nextCursor,
					cwd,
					timestamp: Date.now(),
				};
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to fetch sessions: ${errorMessage}`);
				setSessions([]);
				setNextCursor(undefined);
			} finally {
				setLoading(false);
			}
		},
		[agentClient, isCacheValid],
	);

	/**
	 * Load more sessions (pagination).
	 * Appends to existing sessions list.
	 */
	const loadMoreSessions = useCallback(async () => {
		// Guard: Check if there's more to load
		if (!nextCursor) {
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const result: ListSessionsResult = await agentClient.listSessions(
				nextCursor,
			);

			// Append new sessions to existing list (use functional setState)
			setSessions((prev) => [...prev, ...result.sessions]);
			setNextCursor(result.nextCursor);

			// Update cache with appended sessions
			if (cacheRef.current) {
				cacheRef.current = {
					...cacheRef.current,
					sessions: [...sessions, ...result.sessions],
					nextCursor: result.nextCursor,
					timestamp: Date.now(),
				};
			}
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : String(err);
			setError(`Failed to load more sessions: ${errorMessage}`);
		} finally {
			setLoading(false);
		}
	}, [agentClient, nextCursor, sessions]);

	/**
	 * Load a specific session by ID.
	 */
	const loadSession = useCallback(
		async (sessionId: string, workingDirectory: string) => {
			setLoading(true);
			setError(null);

			try {
				const result: LoadSessionResult = await agentClient.loadSession(
					sessionId,
					workingDirectory,
				);

				// Call the callback to integrate with chat state
				// Use new session ID if provided (for future prompts)
				onSessionLoad(
					result.newSessionId || sessionId,
					result.modes,
					result.models,
					result.conversationHistory,
				);
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to load session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[agentClient, onSessionLoad],
	);

	/**
	 * Delete a session by ID.
	 */
	const deleteSession = useCallback(
		async (sessionId: string, workingDirectory: string) => {
			setLoading(true);
			setError(null);

			try {
				await agentClient.deleteSession(sessionId, workingDirectory);

				// Remove from local state
				setSessions((prev) =>
					prev.filter((s) => s.sessionId !== sessionId),
				);

				// Invalidate cache
				invalidateCache();
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to delete session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[agentClient, invalidateCache],
	);

	/**
	 * Rename a session by ID.
	 */
	const renameSession = useCallback(
		async (sessionId: string, newTitle: string) => {
			setLoading(true);
			setError(null);

			try {
				await agentClient.renameSession(sessionId, newTitle);

				// Update local state with new title
				setSessions((prev) =>
					prev.map((s) =>
						s.sessionId === sessionId
							? { ...s, title: newTitle }
							: s,
					),
				);

				// Invalidate cache
				invalidateCache();
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to rename session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[agentClient, invalidateCache],
	);

	return {
		sessions,
		loading,
		error,
		hasMore: nextCursor !== undefined,
		fetchSessions,
		loadMoreSessions,
		loadSession,
		deleteSession,
		renameSession,
		invalidateCache,
	};
}
