import { useState, useCallback, useRef, useMemo } from "react";
import type { IAgentClient } from "../domain/ports/agent-client.port";
import type {
	SessionInfo,
	ListSessionsResult,
} from "../domain/models/session-info";
import type {
	ChatSession,
	SessionModeState,
	SessionModelState,
} from "../domain/models/chat-session";
import {
	getSessionCapabilityFlags,
	type SessionCapabilityFlags,
} from "../shared/session-capability-utils";

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
	 * @param models - Available models from the session
	 */
	(
		sessionId: string,
		modes?: SessionModeState,
		models?: SessionModelState,
	): void;
}

/**
 * Options for useSessionHistory hook.
 */
export interface UseSessionHistoryOptions {
	/** Agent client for session operations */
	agentClient: IAgentClient;
	/** Current session (used to access agentCapabilities) */
	session: ChatSession;
	/** Callback invoked when a session is loaded/resumed/forked */
	onSessionLoad: SessionLoadCallback;
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

	// Capability flags (from session.agentCapabilities)
	/** Whether session history UI should be shown (canList) */
	canShowSessionHistory: boolean;
	/** Whether session/load is supported (stable) */
	canLoad: boolean;
	/** Whether session/resume is supported (unstable) */
	canResume: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;
	/** Whether session/list is supported (unstable) */
	canList: boolean;

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
	 * Load a specific session by ID (with history replay).
	 * Only available if canLoad is true.
	 * Conversation history is received via session/update notifications.
	 * @param sessionId - Session to load
	 * @param cwd - Working directory for the session
	 */
	loadSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Resume a specific session by ID (without history replay).
	 * Only available if canResume is true.
	 * @param sessionId - Session to resume
	 * @param cwd - Working directory for the session
	 */
	resumeSession: (sessionId: string, cwd: string) => Promise<void>;

	/**
	 * Fork a specific session to create a new branch.
	 * Only available if canFork is true.
	 * @param sessionId - Session to fork
	 * @param cwd - Working directory for the session
	 */
	forkSession: (sessionId: string, cwd: string) => Promise<void>;

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
	const { agentClient, session, onSessionLoad } = options;

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
			// Guard: Check if list is supported
			if (!capabilities.canList) {
				return;
			}

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
		[agentClient, capabilities.canList, isCacheValid],
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
			const result: ListSessionsResult = await agentClient.listSessions(
				currentCwdRef.current,
				nextCursor,
			);

			// Append new sessions to existing list (use functional setState)
			setSessions((prev) => [...prev, ...result.sessions]);
			setNextCursor(result.nextCursor);

			// Update cache with appended sessions
			if (cacheRef.current) {
				cacheRef.current = {
					...cacheRef.current,
					sessions: [
						...cacheRef.current.sessions,
						...result.sessions,
					],
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
	}, [agentClient, capabilities.canList, nextCursor]);

	/**
	 * Load a specific session by ID (with history replay).
	 * Conversation history is received via session/update notifications.
	 */
	const loadSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				// IMPORTANT: Update session.sessionId BEFORE calling loadSession
				// so that session/update notifications are not ignored
				onSessionLoad(sessionId, undefined, undefined);

				const result = await agentClient.loadSession(sessionId, cwd);

				// Update with modes/models from result
				onSessionLoad(result.sessionId, result.modes, result.models);
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
	 * Resume a specific session by ID (without history replay).
	 */
	const resumeSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				// IMPORTANT: Update session.sessionId BEFORE calling resumeSession
				// so that session/update notifications are not ignored
				onSessionLoad(sessionId, undefined, undefined);

				const result = await agentClient.resumeSession(sessionId, cwd);

				// Update with modes/models from result
				onSessionLoad(result.sessionId, result.modes, result.models);
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to resume session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[agentClient, onSessionLoad],
	);

	/**
	 * Fork a specific session to create a new branch.
	 * Note: For fork, we update sessionId AFTER the call since a new session ID is created.
	 */
	const forkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			setLoading(true);
			setError(null);

			try {
				const result = await agentClient.forkSession(sessionId, cwd);

				// Update with new session ID and modes/models from result
				// For fork, the new session ID is returned in result
				onSessionLoad(result.sessionId, result.modes, result.models);

				// Invalidate cache since a new session was created
				invalidateCache();
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : String(err);
				setError(`Failed to fork session: ${errorMessage}`);
				throw err; // Re-throw to allow caller to handle
			} finally {
				setLoading(false);
			}
		},
		[agentClient, onSessionLoad, invalidateCache],
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
		canLoad: capabilities.canLoad,
		canResume: capabilities.canResume,
		canFork: capabilities.canFork,
		canList: capabilities.canList,

		// Methods
		fetchSessions,
		loadMoreSessions,
		loadSession,
		resumeSession,
		forkSession,
		invalidateCache,
	};
}
