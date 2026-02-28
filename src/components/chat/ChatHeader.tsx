import * as React from "react";
import { HeaderButton } from "./HeaderButton";
import { getUiLanguage, t } from "../../shared/i18n";
import type AgentClientPlugin from "../../plugin";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Plugin instance for language detection */
	plugin: AgentClientPlugin;
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether a plugin update is available */
	isUpdateAvailable: boolean;
	/** Whether session history is supported (show History button) */
	hasHistoryCapability?: boolean;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to show the header menu at the click position */
	onShowMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
	/** Callback to open session history */
	onOpenHistory?: () => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Update notification (if available)
 * - Action buttons (new chat, history, export, settings)
 */
export function ChatHeader({
	plugin,
	agentLabel,
	isUpdateAvailable,
	hasHistoryCapability = false,
	onNewChat,
	onExportChat,
	onShowMenu,
	onOpenHistory,
}: ChatHeaderProps) {
	const language = getUiLanguage(plugin.app);

	return (
		<div className="agent-client-chat-view-header">
			<div className="agent-client-chat-view-header-main">
				<h3 className="agent-client-chat-view-header-title">
					{agentLabel}
				</h3>
			</div>
			{isUpdateAvailable && (
				<p className="agent-client-chat-view-header-update">
					{t(language, "pluginUpdateAvailable")}
				</p>
			)}
			<div className="agent-client-chat-view-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip={t(language, "newChat")}
					onClick={onNewChat}
				/>
				{onOpenHistory && (
					<HeaderButton
						iconName="history"
						tooltip={t(language, "sessionHistory")}
						onClick={onOpenHistory}
					/>
				)}
				<HeaderButton
					iconName="save"
					tooltip={t(language, "exportChatToMarkdown")}
					onClick={onExportChat}
				/>
				<HeaderButton
					iconName="more-vertical"
					tooltip={t(language, "more")}
					onClick={onShowMenu}
				/>
			</div>
		</div>
	);
}
