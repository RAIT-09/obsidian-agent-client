import { useRef, useCallback, useEffect } from "react";
import { Notice } from "obsidian";
import { SessionHistoryModal } from "../ui/SessionHistoryModal";
import { getLogger } from "../utils/logger";
import type AgentClientPlugin from "../plugin";
import type { UseAgentReturn } from "./useAgent";
import type { UseSessionHistoryReturn } from "./useSessionHistory";

/**
 * Hook for managing the session history modal lifecycle.
 *
 * Encapsulates modal creation, props synchronization, and
 * session operation callbacks (restore, fork, delete).
 *
 * @param plugin - Plugin instance for app access
 * @param agent - Agent hook for clearMessages
 * @param sessionHistory - Session history hook for operations
 * @param vaultPath - Current working directory
 * @param isSessionReady - Whether the session is ready
 * @param debugMode - Whether debug mode is enabled
 */
export function useHistoryModal(
	plugin: AgentClientPlugin,
	agent: UseAgentReturn,
	sessionHistory: UseSessionHistoryReturn,
	vaultPath: string,
	isSessionReady: boolean,
	debugMode: boolean,
	onAgentCwdChange?: (cwd: string) => void,
	onLabelChange?: (label: string) => void,
): {
	handleOpenHistory: () => void;
} {
	const logger = getLogger();
	const historyModalRef = useRef<SessionHistoryModal | null>(null);

	// ── Stable refs for values read at call time ──
	// These prevent callbacks from depending on frequently-changing references
	// (like sessionHistory.sessions which is a new array every render),
	// which would cause the callbacks to be recreated every render,
	// which would cause the useEffect syncing modal props to fire every render,
	// which would call updateProps → root.render() → infinite re-render loop (I11/I12).
	const sessionsRef = useRef(sessionHistory.sessions);
	sessionsRef.current = sessionHistory.sessions;
	const onLabelChangeRef = useRef(onLabelChange);
	onLabelChangeRef.current = onLabelChange;
	const onAgentCwdChangeRef = useRef(onAgentCwdChange);
	onAgentCwdChangeRef.current = onAgentCwdChange;

	const handleRestoreSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatPanel] Restoring session: ${sessionId}`);
				agent.clearMessages();
				await sessionHistory.restoreSession(sessionId, cwd);
				onAgentCwdChangeRef.current?.(cwd);
				// Update tab label from saved session title
				const saved = sessionsRef.current.find(
					(s) => s.sessionId === sessionId,
				);
				if (saved?.title && onLabelChangeRef.current) {
					onLabelChangeRef.current(saved.title);
				}
				new Notice("[Agent Client] Session restored");
			} catch (error) {
				new Notice("[Agent Client] Failed to restore session");
				logger.error("Session restore error:", error);
			}
		},
		[logger, agent.clearMessages, sessionHistory.restoreSession],
	);

	const handleForkSession = useCallback(
		async (sessionId: string, cwd: string) => {
			try {
				logger.log(`[ChatPanel] Forking session: ${sessionId}`);
				agent.clearMessages();
				await sessionHistory.forkSession(sessionId, cwd);
				onAgentCwdChangeRef.current?.(cwd);
				// Update tab label from the original session's title
				const saved = sessionsRef.current.find(
					(s) => s.sessionId === sessionId,
				);
				if (saved?.title && onLabelChangeRef.current) {
					onLabelChangeRef.current(saved.title);
				}
				new Notice("[Agent Client] Session forked");
			} catch (error) {
				new Notice("[Agent Client] Failed to fork session");
				logger.error("Session fork error:", error);
			}
		},
		[logger, agent.clearMessages, sessionHistory.forkSession],
	);

	const handleDeleteSession = useCallback(
		async (sessionId: string) => {
			try {
				logger.log(`[ChatPanel] Deleting session: ${sessionId}`);
				await sessionHistory.deleteSession(sessionId);
				new Notice("[Agent Client] Session deleted");
			} catch (error) {
				new Notice("[Agent Client] Failed to delete session");
				logger.error("Session delete error:", error);
			}
		},
		[sessionHistory.deleteSession, logger],
	);

	const handleEditTitle = useCallback(
		async (sessionId: string, newTitle: string, sessionCwd: string) => {
			try {
				await sessionHistory.updateSessionTitle(
					sessionId,
					newTitle,
					sessionCwd,
				);
				new Notice("[Agent Client] Title updated");
			} catch (error) {
				new Notice("[Agent Client] Failed to update title");
				logger.error("Title update error:", error);
			}
		},
		[sessionHistory.updateSessionTitle, logger],
	);

	const handleLoadMore = useCallback(() => {
		void sessionHistory.loadMoreSessions();
	}, [sessionHistory.loadMoreSessions]);

	const handleFetchSessions = useCallback(
		(cwd?: string) => {
			void sessionHistory.fetchSessions(cwd);
		},
		[sessionHistory.fetchSessions],
	);

	const handleOpenHistory = useCallback(() => {
		// Create modal if it doesn't exist
		if (!historyModalRef.current) {
			historyModalRef.current = new SessionHistoryModal(plugin.app, {
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: debugMode,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onEditTitle: handleEditTitle,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			}, () => { historyModalRef.current = null; });
		}
		historyModalRef.current.open();
		void sessionHistory.fetchSessions(vaultPath);
	}, [
		plugin.app,
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.canList,
		sessionHistory.canRestore,
		sessionHistory.canFork,
		sessionHistory.isUsingLocalSessions,
		sessionHistory.localSessionIds,
		sessionHistory.fetchSessions,
		vaultPath,
		isSessionReady,
		debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleEditTitle,
		handleLoadMore,
		handleFetchSessions,
	]);

	// Update modal props when session history state changes
	useEffect(() => {
		if (historyModalRef.current) {
			historyModalRef.current.updateProps({
				sessions: sessionHistory.sessions,
				loading: sessionHistory.loading,
				error: sessionHistory.error,
				hasMore: sessionHistory.hasMore,
				currentCwd: vaultPath,
				canList: sessionHistory.canList,
				canRestore: sessionHistory.canRestore,
				canFork: sessionHistory.canFork,
				isUsingLocalSessions: sessionHistory.isUsingLocalSessions,
				localSessionIds: sessionHistory.localSessionIds,
				isAgentReady: isSessionReady,
				debugMode: debugMode,
				onRestoreSession: handleRestoreSession,
				onForkSession: handleForkSession,
				onDeleteSession: handleDeleteSession,
				onEditTitle: handleEditTitle,
				onLoadMore: handleLoadMore,
				onFetchSessions: handleFetchSessions,
			});
		}
	}, [
		sessionHistory.sessions,
		sessionHistory.loading,
		sessionHistory.error,
		sessionHistory.hasMore,
		sessionHistory.canList,
		sessionHistory.canRestore,
		sessionHistory.canFork,
		sessionHistory.isUsingLocalSessions,
		vaultPath,
		isSessionReady,
		debugMode,
		handleRestoreSession,
		handleForkSession,
		handleDeleteSession,
		handleEditTitle,
		handleLoadMore,
		handleFetchSessions,
	]);

	return { handleOpenHistory };
}
