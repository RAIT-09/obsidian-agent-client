/**
 * ChatHeader Component
 *
 * Displays the chat header with agent name and action buttons.
 */

import * as React from "react";
import { HeaderButton } from "../shared/HeaderButton";

interface ChatHeaderProps {
	/** Active agent display name */
	agentLabel: string;

	/** Whether an update is available */
	isUpdateAvailable: boolean;

	/** Callback for new chat button */
	onNewChat: () => void;

	/** Callback for export button */
	onExport: () => void;

	/** Callback for settings button */
	onSettings: () => void;
}

export function ChatHeader({
	agentLabel,
	isUpdateAvailable,
	onNewChat,
	onExport,
	onSettings,
}: ChatHeaderProps) {
	return (
		<div className="chat-view-header">
			<h3 className="chat-view-header-title">{agentLabel}</h3>
			{isUpdateAvailable && (
				<p className="chat-view-header-update">Update available!</p>
			)}
			<div className="chat-view-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip="New chat"
					onClick={onNewChat}
				/>
				<HeaderButton
					iconName="save"
					tooltip="Export chat to Markdown"
					onClick={onExport}
				/>
				<HeaderButton
					iconName="settings"
					tooltip="Settings"
					onClick={onSettings}
				/>
			</div>
		</div>
	);
}
