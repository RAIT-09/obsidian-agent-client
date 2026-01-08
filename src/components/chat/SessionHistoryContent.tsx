import * as React from "react";
const { useState, useCallback } = React;
import { setIcon } from "obsidian";
import type { SessionInfo } from "../../domain/models/session-info";

/**
 * Props for SessionHistoryContent component.
 */
export interface SessionHistoryContentProps {
	/** List of sessions to display */
	sessions: SessionInfo[];
	/** Whether sessions are being fetched */
	loading: boolean;
	/** Error message if fetch fails */
	error: string | null;
	/** Whether there are more sessions to load */
	hasMore: boolean;
	/** Current working directory for filtering */
	currentCwd: string;

	// Capability flags (from useSessionHistory)
	/** Whether session/list is supported (unstable) */
	canList: boolean;
	/** Whether session/load is supported (stable) */
	canLoad: boolean;
	/** Whether session/resume is supported (unstable) */
	canResume: boolean;
	/** Whether session/fork is supported (unstable) */
	canFork: boolean;

	/** Whether using locally saved sessions (instead of agent session/list) */
	isUsingLocalSessions: boolean;

	/** Whether the agent is ready (initialized) */
	isAgentReady: boolean;

	/** Whether debug mode is enabled (shows manual input form) */
	debugMode: boolean;

	/** Callback when a session is selected for loading (with history replay) */
	onLoadSession: (sessionId: string, cwd: string) => Promise<void>;
	/** Callback when a session is resumed (without history replay) */
	onResumeSession: (sessionId: string, cwd: string) => Promise<void>;
	/** Callback when a session is forked (create new branch) */
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	/** Callback to load more sessions (pagination) */
	onLoadMore: () => void;
	/** Callback to fetch sessions with filter */
	onFetchSessions: (cwd?: string) => void;
	/** Callback to close the modal */
	onClose: () => void;
}

/**
 * Icon button component using Obsidian's setIcon.
 */
function IconButton({
	iconName,
	label,
	className,
	onClick,
}: {
	iconName: string;
	label: string;
	className: string;
	onClick: () => void;
}) {
	const iconRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, iconName);
		}
	}, [iconName]);

	return (
		<div
			ref={iconRef}
			className={className}
			aria-label={label}
			onClick={onClick}
		/>
	);
}

/**
 * Format timestamp as relative time.
 * Examples: "2 hours ago", "yesterday", "3 days ago"
 */
function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const timestamp = date.getTime();
	const diffMs = now - timestamp;
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMinutes < 1) {
		return "just now";
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	} else if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	} else if (diffDays === 1) {
		return "yesterday";
	} else if (diffDays < 7) {
		return `${diffDays} days ago`;
	} else {
		const month = date.toLocaleString("default", { month: "short" });
		const day = date.getDate();
		const year = date.getFullYear();
		return `${month} ${day}, ${year}`;
	}
}

/**
 * Truncate session title to 50 characters with ellipsis.
 */
function truncateTitle(title: string): string {
	if (title.length <= 50) {
		return title;
	}
	return title.slice(0, 50) + "...";
}

/**
 * Debug form for manual session input.
 */
function DebugForm({
	currentCwd,
	onLoadSession,
	onResumeSession,
	onForkSession,
	onClose,
}: {
	currentCwd: string;
	onLoadSession: (sessionId: string, cwd: string) => Promise<void>;
	onResumeSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onClose: () => void;
}) {
	const [sessionId, setSessionId] = useState("");
	const [cwd, setCwd] = useState(currentCwd);

	const handleLoad = useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onLoadSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onLoadSession, onClose]);

	const handleResume = useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onResumeSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onResumeSession, onClose]);

	const handleFork = useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onForkSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onForkSession, onClose]);

	return (
		<div className="agent-client-session-history-debug">
			<h3>Debug: Manual Session Input</h3>

			<div className="agent-client-session-history-debug-group">
				<label htmlFor="debug-session-id">Session ID:</label>
				<input
					id="debug-session-id"
					type="text"
					placeholder="Enter session ID..."
					className="agent-client-session-history-debug-input"
					value={sessionId}
					onChange={(e) => setSessionId(e.target.value)}
				/>
			</div>

			<div className="agent-client-session-history-debug-group">
				<label htmlFor="debug-cwd">Working Directory (cwd):</label>
				<input
					id="debug-cwd"
					type="text"
					placeholder="Enter working directory..."
					className="agent-client-session-history-debug-input"
					value={cwd}
					onChange={(e) => setCwd(e.target.value)}
				/>
			</div>

			<div className="agent-client-session-history-debug-actions">
				<button
					className="agent-client-session-history-debug-button"
					onClick={handleLoad}
				>
					Load
				</button>
				<button
					className="agent-client-session-history-debug-button"
					onClick={handleResume}
				>
					Resume
				</button>
				<button
					className="agent-client-session-history-debug-button"
					onClick={handleFork}
				>
					Fork
				</button>
			</div>

			<hr className="agent-client-session-history-debug-separator" />
		</div>
	);
}

/**
 * Session list item component.
 */
function SessionItem({
	session,
	canLoad,
	canResume,
	canFork,
	onLoadSession,
	onResumeSession,
	onForkSession,
	onClose,
}: {
	session: SessionInfo;
	canLoad: boolean;
	canResume: boolean;
	canFork: boolean;
	onLoadSession: (sessionId: string, cwd: string) => Promise<void>;
	onResumeSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onClose: () => void;
}) {
	const handleLoad = useCallback(() => {
		onClose();
		void onLoadSession(session.sessionId, session.cwd);
	}, [session, onLoadSession, onClose]);

	const handleResume = useCallback(() => {
		onClose();
		void onResumeSession(session.sessionId, session.cwd);
	}, [session, onResumeSession, onClose]);

	const handleFork = useCallback(() => {
		onClose();
		void onForkSession(session.sessionId, session.cwd);
	}, [session, onForkSession, onClose]);

	return (
		<div className="agent-client-session-history-item">
			<div className="agent-client-session-history-item-content">
				<div className="agent-client-session-history-item-title">
					<span>
						{truncateTitle(session.title ?? "Untitled Session")}
					</span>
				</div>
				<div className="agent-client-session-history-item-metadata">
					{session.updatedAt && (
						<span className="agent-client-session-history-item-timestamp">
							{formatRelativeTime(new Date(session.updatedAt))}
						</span>
					)}
				</div>
			</div>

			<div className="agent-client-session-history-item-actions">
				{canLoad && (
					<IconButton
						iconName="file-text"
						label="Load session (with history)"
						className="agent-client-session-history-action-icon agent-client-session-history-load-icon"
						onClick={handleLoad}
					/>
				)}
				{canResume && (
					<IconButton
						iconName="play"
						label="Resume session (without history)"
						className="agent-client-session-history-action-icon agent-client-session-history-resume-icon"
						onClick={handleResume}
					/>
				)}
				{canFork && (
					<IconButton
						iconName="git-branch"
						label="Fork session (create new branch)"
						className="agent-client-session-history-action-icon agent-client-session-history-fork-icon"
						onClick={handleFork}
					/>
				)}
			</div>
		</div>
	);
}

/**
 * Session history content component.
 *
 * Renders the content of the session history modal including:
 * - Debug form (when debug mode enabled)
 * - Local sessions banner
 * - Filter toggle (for agent session/list)
 * - Session list with load/resume/fork actions
 * - Pagination
 */
export function SessionHistoryContent({
	sessions,
	loading,
	error,
	hasMore,
	currentCwd,
	canList,
	canLoad,
	canResume,
	canFork,
	isUsingLocalSessions,
	isAgentReady,
	debugMode,
	onLoadSession,
	onResumeSession,
	onForkSession,
	onLoadMore,
	onFetchSessions,
	onClose,
}: SessionHistoryContentProps) {
	const [filterByCurrentVault, setFilterByCurrentVault] = useState(true);

	const handleFilterChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const checked = e.target.checked;
			setFilterByCurrentVault(checked);
			const cwd = checked ? currentCwd : undefined;
			onFetchSessions(cwd);
		},
		[currentCwd, onFetchSessions],
	);

	const handleRetry = useCallback(() => {
		const cwd = filterByCurrentVault ? currentCwd : undefined;
		onFetchSessions(cwd);
	}, [filterByCurrentVault, currentCwd, onFetchSessions]);

	// Show preparing message if agent is not ready
	if (!isAgentReady) {
		return (
			<div className="agent-client-session-history-loading">
				<p>Preparing agent...</p>
			</div>
		);
	}

	// Check if any session operation is available
	const canPerformAnyOperation = canLoad || canResume || canFork;

	// Show message if no session operations are supported
	if (!canPerformAnyOperation && !debugMode) {
		return (
			<div className="agent-client-session-history-empty">
				<p className="agent-client-session-history-empty-text">
					This agent does not support session restoration.
				</p>
			</div>
		);
	}

	const canShowList = canList || isUsingLocalSessions;

	return (
		<>
			{/* Debug form */}
			{debugMode && (
				<DebugForm
					currentCwd={currentCwd}
					onLoadSession={onLoadSession}
					onResumeSession={onResumeSession}
					onForkSession={onForkSession}
					onClose={onClose}
				/>
			)}

			{/* Local sessions banner */}
			{isUsingLocalSessions && (
				<div className="agent-client-session-history-local-banner">
					<span>
						Locally saved sessions (agent doesn't support
						session/list)
					</span>
				</div>
			)}

			{/* No list capability message */}
			{!canShowList && !debugMode && (
				<div className="agent-client-session-history-empty">
					<p className="agent-client-session-history-empty-text">
						Session list is not available for this agent.
					</p>
					<p className="agent-client-session-history-empty-text">
						Enable Debug Mode in settings to manually enter session
						IDs.
					</p>
				</div>
			)}

			{canShowList && (
				<>
					{/* Filter toggle - only for agent session/list */}
					{canList && !isUsingLocalSessions && (
						<div className="agent-client-session-history-filter">
							<label className="agent-client-session-history-filter-label">
								<input
									type="checkbox"
									checked={filterByCurrentVault}
									onChange={handleFilterChange}
								/>
								<span>Show current vault only</span>
							</label>
						</div>
					)}

					{/* Error state */}
					{error && (
						<div className="agent-client-session-history-error">
							<p className="agent-client-session-history-error-text">
								{error}
							</p>
							<button
								className="agent-client-session-history-retry-button"
								onClick={handleRetry}
							>
								Retry
							</button>
						</div>
					)}

					{/* Loading state */}
					{!error && loading && sessions.length === 0 && (
						<div className="agent-client-session-history-loading">
							<p>Loading sessions...</p>
						</div>
					)}

					{/* Empty state */}
					{!error && !loading && sessions.length === 0 && (
						<div className="agent-client-session-history-empty">
							<p className="agent-client-session-history-empty-text">
								No previous sessions
							</p>
						</div>
					)}

					{/* Session list */}
					{!error && sessions.length > 0 && (
						<div className="agent-client-session-history-list">
							{sessions.map((session) => (
								<SessionItem
									key={session.sessionId}
									session={session}
									canLoad={canLoad}
									canResume={canResume}
									canFork={canFork}
									onLoadSession={onLoadSession}
									onResumeSession={onResumeSession}
									onForkSession={onForkSession}
									onClose={onClose}
								/>
							))}
						</div>
					)}

					{/* Load more button */}
					{!error && hasMore && (
						<div className="agent-client-session-history-load-more">
							<button
								className="agent-client-session-history-load-more-button"
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
