import * as React from "react";
import type AgentClientPlugin from "../../main";
import type { ChatSession } from "../../types/acp-types";

interface HistoryOverlayProps {
	sessions: ChatSession[];
	plugin: AgentClientPlugin;
	onClose: () => void;
	onSelectSession: (sessionId: string) => void;
}

export function HistoryOverlay({
	sessions,
	plugin,
	onClose,
	onSelectSession,
}: HistoryOverlayProps) {
	// Get agent name from agentId
	const getAgentName = (agentId: string) => {
		if (agentId === plugin.settings.claude.id) {
			return plugin.settings.claude.displayName || "Claude Code";
		}
		if (agentId === plugin.settings.gemini.id) {
			return plugin.settings.gemini.displayName || "Gemini CLI";
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === agentId,
		);
		return custom?.displayName || agentId;
	};

	// Format timestamp to relative time
	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return "Just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString();
	};

	return (
		<div className="history-overlay" onClick={onClose}>
			<div
				className="history-overlay-content"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="history-overlay-header">
					<h3>Chat History</h3>
					<button className="history-overlay-close" onClick={onClose}>
						×
					</button>
				</div>

				<div className="history-overlay-list">
					{sessions.length === 0 ? (
						<div className="history-overlay-empty">
							No chat history yet
						</div>
					) : (
						sessions.map((session) => (
							<div
								key={session.sessionId}
								className="history-overlay-item"
								onClick={() => onSelectSession(session.sessionId)}
							>
								<div className="history-item-main">
									{session.firstMessage}
								</div>
								<div className="history-item-meta">
									<span className="history-item-agent">
										{getAgentName(session.agentId)}
									</span>
									<span className="history-item-date">
										{formatDate(session.timestamp)}
									</span>
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
