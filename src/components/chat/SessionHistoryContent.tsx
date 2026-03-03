import * as React from "react";
import type { SessionInfo } from "../../domain/models/session-info";
import { DebugForm, SessionItem } from "./session-history-sections";

export interface SessionHistoryContentProps {
	sessions: SessionInfo[];
	loading: boolean;
	error: string | null;
	hasMore: boolean;
	currentCwd: string;
	currentSessionId?: string | null;
	canList: boolean;
	canRestore: boolean;
	canFork: boolean;
	isUsingLocalSessions: boolean;
	localSessionIds: Set<string>;
	isAgentReady: boolean;
	debugMode: boolean;
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onDeleteSession: (sessionId: string) => void;
	onLoadMore: () => void;
	onFetchSessions: (cwd?: string) => void;
	onClose: () => void;
}

export function SessionHistoryContent({
	sessions,
	loading,
	error,
	hasMore,
	currentCwd,
	currentSessionId,
	canList,
	canRestore,
	canFork,
	isUsingLocalSessions,
	localSessionIds,
	isAgentReady,
	debugMode,
	onRestoreSession,
	onForkSession,
	onDeleteSession,
	onLoadMore,
	onFetchSessions,
	onClose,
}: SessionHistoryContentProps) {
	const handleRetry = React.useCallback(() => {
		onFetchSessions(currentCwd);
	}, [currentCwd, onFetchSessions]);

	const filteredSessions = React.useMemo(() => {
		if (isUsingLocalSessions) {
			return sessions;
		}
		return sessions.filter((session) => localSessionIds.has(session.sessionId));
	}, [sessions, isUsingLocalSessions, localSessionIds]);

	if (!isAgentReady) {
		return (
			<div className="obsius-session-history-loading">
				<p>Preparing agent...</p>
			</div>
		);
	}

	const canPerformAnyOperation = canRestore || canFork;
	const canShowList =
		canList || isUsingLocalSessions || !canPerformAnyOperation;

	return (
		<>
			{debugMode && (
				<DebugForm
					currentCwd={currentCwd}
					onRestoreSession={onRestoreSession}
					onForkSession={onForkSession}
					onClose={onClose}
				/>
			)}

			{!canPerformAnyOperation && (
				<div className="obsius-session-history-warning-banner">
					<p>This agent does not support session restoration.</p>
				</div>
			)}

			{(isUsingLocalSessions || !canPerformAnyOperation) && (
				<div className="obsius-session-history-local-banner">
					<span>These sessions are saved in the plugin.</span>
				</div>
			)}

			{!canShowList && !debugMode && (
				<div className="obsius-session-history-empty">
					<p className="obsius-session-history-empty-text">
						Session list is not available for this agent.
					</p>
					<p className="obsius-session-history-empty-text">
						Enable Debug Mode in settings to manually enter session IDs.
					</p>
				</div>
			)}

			{canShowList && (
				<>
					{error && (
						<div className="obsius-session-history-error">
							<p className="obsius-session-history-error-text">{error}</p>
							<button
								className="obsius-session-history-retry-button"
								onClick={handleRetry}
							>
								Retry
							</button>
						</div>
					)}

					{!error && loading && filteredSessions.length === 0 && (
						<div className="obsius-session-history-loading">
							<p>Loading sessions...</p>
						</div>
					)}

					{!error && !loading && filteredSessions.length === 0 && (
						<div className="obsius-session-history-empty">
							<p className="obsius-session-history-empty-text">
								No previous sessions
							</p>
						</div>
					)}

					{!error && filteredSessions.length > 0 && (
						<div className="obsius-session-history-list">
							{filteredSessions.map((session) => (
								<SessionItem
									key={session.sessionId}
									session={session}
									isCurrent={session.sessionId === currentSessionId}
									canRestore={canRestore}
									canFork={canFork}
									onRestoreSession={onRestoreSession}
									onForkSession={onForkSession}
									onDeleteSession={onDeleteSession}
									onClose={onClose}
								/>
							))}
						</div>
					)}

					{!error && hasMore && (
						<div className="obsius-session-history-load-more">
							<button
								className="obsius-session-history-load-more-button"
								disabled={loading}
								onClick={onLoadMore}
							>
								{loading ? "Loading..." : "Load more"}
							</button>
						</div>
					)}
				</>
			)}
		</>
	);
}
