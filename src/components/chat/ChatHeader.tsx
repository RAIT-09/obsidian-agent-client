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
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Update notification (if available)
 * - Action buttons (new chat, export, settings)
 */
export function ChatHeader({
	agentLabel,
	isUpdateAvailable,
	onNewChat,
	onExportChat,
	onOpenSettings,
}: ChatHeaderProps) {
	return (
		<div className="agent-client-chat-view-header">
			<h3 className="agent-client-chat-view-header-title">
				{agentLabel}
			</h3>
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
