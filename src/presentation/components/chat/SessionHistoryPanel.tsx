import * as React from "react";
const { useState, useEffect, useCallback, memo } = React;
import { setIcon } from "obsidian";

import type { SessionSummary } from "../../../core/domain/ports/persistence.port";
import type { SessionHistoryUseCase } from "../../../core/use-cases/session-history.use-case";

export interface SessionHistoryPanelProps {
	historyUseCase: SessionHistoryUseCase;
	onSelectSession: (sessionId: string) => void;
	onClose: () => void;
	currentSessionId: string | null;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return date.toLocaleDateString();
}

/**
 * Single session item in the history list.
 */
const SessionItem = memo(function SessionItem({
	session,
	isActive,
	onSelect,
	onDelete,
}: {
	session: SessionSummary;
	isActive: boolean;
	onSelect: () => void;
	onDelete: () => void;
}) {
	const deleteButtonRef = React.useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (deleteButtonRef.current) {
			setIcon(deleteButtonRef.current, "trash-2");
		}
	}, []);

	return (
		<div
			className={`session-history-item ${isActive ? "active" : ""}`}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			role="button"
			tabIndex={0}
			aria-current={isActive ? "true" : undefined}
		>
			<div className="session-history-item-header">
				<span className="session-history-agent">{session.agentDisplayName}</span>
				<span className="session-history-time">{formatRelativeTime(session.lastActivityAt)}</span>
			</div>
			<div className="session-history-preview">
				{session.preview || "No messages"}
			</div>
			<div className="session-history-meta">
				<span>{session.messageCount} messages</span>
				<button
					ref={deleteButtonRef}
					type="button"
					className="session-history-delete"
					onClick={(e) => {
						e.stopPropagation();
						onDelete();
					}}
					aria-label="Delete session"
					title="Delete session"
				/>
			</div>
		</div>
	);
});

/**
 * Panel for browsing and restoring past sessions.
 */
export const SessionHistoryPanel = memo(function SessionHistoryPanel({
	historyUseCase,
	onSelectSession,
	onClose,
	currentSessionId,
}: SessionHistoryPanelProps) {
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const closeButtonRef = React.useRef<HTMLButtonElement>(null);

	// Load sessions on mount
	useEffect(() => {
		loadSessions();
	}, []);

	useEffect(() => {
		if (closeButtonRef.current) {
			setIcon(closeButtonRef.current, "x");
		}
	}, []);

	const loadSessions = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const list = await historyUseCase.listSessions({ limit: 50 });
			setSessions(list);
		} catch (err) {
			setError("Failed to load session history");
			console.error("[SessionHistoryPanel] Error loading sessions:", err);
		} finally {
			setLoading(false);
		}
	}, [historyUseCase]);

	const handleDelete = useCallback(async (sessionId: string) => {
		try {
			await historyUseCase.deleteSession(sessionId);
			setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
		} catch (err) {
			console.error("[SessionHistoryPanel] Error deleting session:", err);
		}
	}, [historyUseCase]);

	return (
		<div className="session-history-panel" role="dialog" aria-label="Session History">
			<div className="session-history-header">
				<h4>Session History</h4>
				<button
					ref={closeButtonRef}
					type="button"
					className="session-history-close"
					onClick={onClose}
					aria-label="Close"
				/>
			</div>

			<div className="session-history-content">
				{loading && (
					<div className="session-history-loading">Loading...</div>
				)}

				{error && (
					<div className="session-history-error">{error}</div>
				)}

				{!loading && !error && sessions.length === 0 && (
					<div className="session-history-empty">No saved sessions</div>
				)}

				{!loading && !error && sessions.length > 0 && (
					<div className="session-history-list" role="list">
						{sessions.map((session) => (
							<SessionItem
								key={session.sessionId}
								session={session}
								isActive={session.sessionId === currentSessionId}
								onSelect={() => onSelectSession(session.sessionId)}
								onDelete={() => handleDelete(session.sessionId)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
});

export default SessionHistoryPanel;
