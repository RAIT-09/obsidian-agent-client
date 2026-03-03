import * as React from "react";
import { setIcon } from "obsidian";
import type { SessionInfo } from "../../domain/models/session-info";

interface SessionActionHandlers {
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onDeleteSession: (sessionId: string) => void;
	onClose: () => void;
}

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
	}
	if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	}
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	}
	if (diffDays === 1) {
		return "yesterday";
	}
	if (diffDays < 7) {
		return `${diffDays} days ago`;
	}
	const month = date.toLocaleString("default", { month: "short" });
	const day = date.getDate();
	const year = date.getFullYear();
	return `${month} ${day}, ${year}`;
}

function truncateTitle(title: string): string {
	if (title.length <= 50) {
		return title;
	}
	return title.slice(0, 50) + "...";
}

function IconButton({
	iconName,
	label,
	className,
	onClick,
}: {
	iconName: string;
	label: string;
	className: string;
	onClick: (e: React.MouseEvent) => void;
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

function RowIcon({
	iconName,
	className,
}: {
	iconName: string;
	className: string;
}) {
	const iconRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, iconName);
		}
	}, [iconName]);

	return <div ref={iconRef} className={className} aria-hidden="true" />;
}

export function DebugForm({
	currentCwd,
	onRestoreSession,
	onForkSession,
	onClose,
}: {
	currentCwd: string;
	onRestoreSession: (sessionId: string, cwd: string) => Promise<void>;
	onForkSession: (sessionId: string, cwd: string) => Promise<void>;
	onClose: () => void;
}) {
	const [sessionId, setSessionId] = React.useState("");
	const [cwd, setCwd] = React.useState(currentCwd);

	const handleRestore = React.useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onRestoreSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onRestoreSession, onClose]);

	const handleFork = React.useCallback(() => {
		if (sessionId.trim()) {
			onClose();
			void onForkSession(sessionId.trim(), cwd.trim() || currentCwd);
		}
	}, [sessionId, cwd, currentCwd, onForkSession, onClose]);

	return (
		<div className="obsius-session-history-debug">
			<h3>Debug: Manual Session Input</h3>

			<div className="obsius-session-history-debug-group">
				<label htmlFor="debug-session-id">Session ID:</label>
				<input
					id="debug-session-id"
					type="text"
					placeholder="Enter session ID..."
					className="obsius-session-history-debug-input"
					value={sessionId}
					onChange={(event) => setSessionId(event.target.value)}
				/>
			</div>

			<div className="obsius-session-history-debug-group">
				<label htmlFor="debug-cwd">Working Directory (cwd):</label>
				<input
					id="debug-cwd"
					type="text"
					placeholder="Enter working directory..."
					className="obsius-session-history-debug-input"
					value={cwd}
					onChange={(event) => setCwd(event.target.value)}
				/>
			</div>

			<div className="obsius-session-history-debug-actions">
				<button
					className="obsius-session-history-debug-button"
					onClick={handleRestore}
				>
					Restore
				</button>
				<button
					className="obsius-session-history-debug-button"
					onClick={handleFork}
				>
					Fork
				</button>
			</div>

			<hr className="obsius-session-history-debug-separator" />
		</div>
	);
}

interface SessionItemProps extends SessionActionHandlers {
	session: SessionInfo;
	isCurrent: boolean;
	canRestore: boolean;
	canFork: boolean;
}

export function SessionItem({
	session,
	isCurrent,
	canRestore,
	canFork,
	onRestoreSession,
	onForkSession,
	onDeleteSession,
	onClose,
}: SessionItemProps) {
	const handleClick = React.useCallback(() => {
		if (!canRestore) return;
		onClose();
		void onRestoreSession(session.sessionId, session.cwd);
	}, [session, canRestore, onRestoreSession, onClose]);

	const handleFork = React.useCallback(
		(event: React.MouseEvent) => {
			event.stopPropagation();
			onClose();
			void onForkSession(session.sessionId, session.cwd);
		},
		[session, onForkSession, onClose],
	);

	const handleDelete = React.useCallback(
		(event: React.MouseEvent) => {
			event.stopPropagation();
			onDeleteSession(session.sessionId);
		},
		[session.sessionId, onDeleteSession],
	);

	return (
		<div
			className={`obsius-session-history-item${canRestore ? " obsius-session-history-item--clickable" : ""}${isCurrent ? " obsius-session-history-item--current" : ""}`}
			onClick={handleClick}
			role={canRestore ? "button" : undefined}
			tabIndex={canRestore ? 0 : undefined}
			onKeyDown={(event) => {
				if (canRestore && (event.key === "Enter" || event.key === " ")) {
					event.preventDefault();
					handleClick();
				}
			}}
		>
			<RowIcon
				iconName={isCurrent ? "message-square-dot" : "message-square"}
				className="obsius-session-history-item-icon"
			/>

			<div className="obsius-session-history-item-content">
				<div className="obsius-session-history-item-title">
					<span>{truncateTitle(session.title ?? "Untitled Session")}</span>
				</div>
				<div className="obsius-session-history-item-metadata">
					{isCurrent ? (
						<span className="obsius-session-history-item-current">
							Current session
						</span>
					) : (
						session.updatedAt && (
							<span className="obsius-session-history-item-timestamp">
								{formatRelativeTime(new Date(session.updatedAt))}
							</span>
						)
					)}
				</div>
			</div>

			<div className="obsius-session-history-item-actions">
				{canFork && (
					<IconButton
						iconName="git-branch"
						label="Branch from this session"
						className="obsius-session-history-action-icon obsius-session-history-fork-icon"
						onClick={handleFork}
					/>
				)}
				<IconButton
					iconName="trash-2"
					label="Delete session"
					className="obsius-session-history-action-icon obsius-session-history-delete-icon"
					onClick={handleDelete}
				/>
			</div>
		</div>
	);
}
