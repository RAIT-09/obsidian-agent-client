import * as React from "react";
import { HeaderButton } from "./HeaderButton";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Whether session history is supported (show History button) */
	hasHistoryCapability?: boolean;
	/** Current session title (if available) */
	sessionTitle?: string | null;
	/** Current session ID (for renaming) */
	sessionId?: string | null;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
	/** Callback to rename the current session */
	onRenameSession?: (sessionId: string, newTitle: string) => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Session title (editable if session ID and callback provided)
 * - Update notification (if available)
 * - Action buttons (new chat, history, export, settings)
 */
export function ChatHeader({
	agentLabel,
	isUpdateAvailable,
	hasHistoryCapability = false,
	sessionTitle,
	sessionId,
	onNewChat,
	onExportChat,
	onOpenSettings,
	onOpenHistory,
	onRenameSession,
}: ChatHeaderProps) {
	const [isEditing, setIsEditing] = React.useState(false);
	const [editedTitle, setEditedTitle] = React.useState(sessionTitle || "");

	// Update editedTitle when sessionTitle prop changes
	React.useEffect(() => {
		setEditedTitle(sessionTitle || "");
	}, [sessionTitle]);

	const handleRename = () => {
		if (sessionId && onRenameSession && editedTitle.trim() && editedTitle !== sessionTitle) {
			onRenameSession(sessionId, editedTitle.trim());
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleRename();
		} else if (e.key === "Escape") {
			setEditedTitle(sessionTitle || "");
			setIsEditing(false);
		}
	};

	return (
		<div className="agent-client-chat-view-header">
			<div className="agent-client-chat-view-header-main">
				<h3 className="agent-client-chat-view-header-title">
					{agentLabel}
				</h3>
				{sessionTitle && sessionId && onRenameSession && (
					<div className="agent-client-chat-view-header-session">
						{isEditing ? (
							<input
								type="text"
								className="agent-client-chat-view-header-session-input"
								value={editedTitle}
								onChange={(e) => setEditedTitle(e.target.value)}
								onBlur={handleRename}
								onKeyDown={handleKeyDown}
								autoFocus
							/>
						) : (
							<>
								<span className="agent-client-chat-view-header-session-title">
									{sessionTitle}
								</span>
								<HeaderButton
									iconName="pencil"
									tooltip="Rename session"
									onClick={() => setIsEditing(true)}
								/>
							</>
						)}
					</div>
				)}
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					Update available!
				</p>
			)}
			<div className="agent-client-chat-view-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip="New chat"
					onClick={onNewChat}
				/>
				{hasHistoryCapability && onOpenHistory && (
					<HeaderButton
						iconName="history"
						tooltip="Session history"
						onClick={onOpenHistory}
					/>
				)}
				<HeaderButton
					iconName="save"
					tooltip="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<HeaderButton
					iconName="settings"
					tooltip="Settings"
					onClick={onOpenSettings}
				/>
			</div>
		</div>
	);
}
