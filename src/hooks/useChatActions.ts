/**
 * Hook for ChatPanel business callbacks.
 *
 * Encapsulates message sending, new chat, export, agent switching/restart,
 * config changes, and related UI state (restoredMessage, agentUpdateNotification).
 */

import { useState, useCallback } from "react";
import { Notice, Platform } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { UseAgentReturn } from "./useAgent";
import type { UseSessionHistoryReturn } from "./useSessionHistory";
import type { UseSuggestionsReturn } from "./useSuggestions";
import type { ChatSession } from "../types/session";
import type {
	ChatMessage,
	AttachedFile,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../types/chat";
import type { AgentClientPluginSettings } from "../plugin";
import type { AgentUpdateNotification } from "../services/update-checker";
import { ChatExporter } from "../services/chat-exporter";
import { getLogger } from "../utils/logger";
import { buildFileUri } from "../utils/paths";
import { convertWindowsPathToWsl } from "../utils/platform";

// ============================================================================
// Types
// ============================================================================

export interface UseChatActionsReturn {
	// Message actions
	handleSendMessage: (
		content: string,
		attachments?: AttachedFile[],
	) => Promise<void>;
	handleStopGeneration: () => Promise<void>;
	handleNewChat: (requestedAgentId?: string) => Promise<void>;
	handleExportChat: () => Promise<void>;
	handleSwitchAgent: (agentId: string) => Promise<void>;
	handleRestartAgent: () => Promise<void>;

	// Config actions
	handleSetMode: (modeId: string) => Promise<void>;
	handleSetModel: (modelId: string) => Promise<void>;
	handleSetConfigOption: (configId: string, value: string) => Promise<void>;

	// UI state actions
	handleClearError: () => void;
	handleClearAgentUpdate: () => void;
	handleRestoredMessageConsumed: () => void;

	// State (moved from ChatPanel)
	restoredMessage: string | null;
	agentUpdateNotification: AgentUpdateNotification | null;
	setAgentUpdateNotification: (n: AgentUpdateNotification | null) => void;

	// Auto-export (needed by ChatPanel cleanup)
	autoExportIfEnabled: (
		trigger: "newChat" | "closeChat",
		triggerMessages: ChatMessage[],
		triggerSession: ChatSession,
	) => Promise<void>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useChatActions(
	plugin: AgentClientPlugin,
	agent: UseAgentReturn,
	sessionHistory: UseSessionHistoryReturn,
	suggestions: UseSuggestionsReturn,
	session: ChatSession,
	messages: ChatMessage[],
	settings: AgentClientPluginSettings,
	vaultPath: string,
): UseChatActionsReturn {
	const logger = getLogger();

	// ============================================================
	// State (moved from ChatPanel)
	// ============================================================

	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
	const [agentUpdateNotification, setAgentUpdateNotification] =
		useState<AgentUpdateNotification | null>(null);

	// ============================================================
	// Auto-export
	// ============================================================

	const autoExportIfEnabled = useCallback(
		async (
			trigger: "newChat" | "closeChat",
			triggerMessages: ChatMessage[],
			triggerSession: ChatSession,
		): Promise<void> => {
			const isEnabled =
				trigger === "newChat"
					? plugin.settings.exportSettings.autoExportOnNewChat
					: plugin.settings.exportSettings.autoExportOnCloseChat;
			if (!isEnabled) return;
			if (triggerMessages.length === 0) return;
			if (!triggerSession.sessionId) return;

			try {
				const exporter = new ChatExporter(plugin);
				const filePath = await exporter.exportToMarkdown(
					triggerMessages,
					triggerSession.agentDisplayName,
					triggerSession.agentId,
					triggerSession.sessionId,
					triggerSession.createdAt,
					false,
				);
				if (filePath) {
					const context =
						trigger === "newChat" ? "new session" : "closing chat";
					new Notice(`[Agent Client] Chat exported to ${filePath}`);
					logger.log(`Chat auto-exported before ${context}`);
				}
			} catch {
				new Notice("[Agent Client] Failed to export chat");
			}
		},
		[plugin, logger],
	);

	// ============================================================
	// Message Actions
	// ============================================================

	const shouldConvertToWsl = Platform.isWin && settings.windowsWslMode;

	const handleSendMessage = useCallback(
		async (content: string, attachments?: AttachedFile[]) => {
			// Dismiss overlays on send
			agent.clearError();
			setAgentUpdateNotification(null);

			const isFirstMessage = messages.length === 0;

			// Split attachments by kind
			const images: ImagePromptContent[] = [];
			const resourceLinks: ResourceLinkPromptContent[] = [];

			if (attachments) {
				for (const file of attachments) {
					if (file.kind === "image" && file.data) {
						images.push({
							type: "image",
							data: file.data,
							mimeType: file.mimeType,
						});
					} else if (file.kind === "file" && file.path) {
						let filePath = file.path;
						if (shouldConvertToWsl) {
							filePath = convertWindowsPathToWsl(filePath);
						}
						resourceLinks.push({
							type: "resource_link",
							uri: buildFileUri(filePath),
							name:
								file.name ??
								file.path.split("/").pop() ??
								"file",
							mimeType: file.mimeType || undefined,
							size: file.size,
						});
					}
				}
			}

			await agent.sendMessage(content, {
				activeNote: settings.autoMentionActiveNote
					? suggestions.mentions.activeNote
					: null,
				vaultBasePath: vaultPath,
				isAutoMentionDisabled:
					suggestions.mentions.isAutoMentionDisabled,
				images: images.length > 0 ? images : undefined,
				resourceLinks:
					resourceLinks.length > 0 ? resourceLinks : undefined,
			});

			// Save session metadata locally on first message
			if (isFirstMessage && session.sessionId) {
				await sessionHistory.saveSessionLocally(
					session.sessionId,
					content,
				);
				logger.log(
					`[ChatPanel] Session saved locally: ${session.sessionId}`,
				);
			}
		},
		[
			agent.clearError,
			agent.sendMessage,
			messages.length,
			session.sessionId,
			sessionHistory.saveSessionLocally,
			logger,
			settings.autoMentionActiveNote,
			suggestions.mentions.activeNote,
			suggestions.mentions.isAutoMentionDisabled,
			shouldConvertToWsl,
			vaultPath,
		],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		const lastMessage = agent.lastUserMessage;
		await agent.cancelOperation();
		// Discard stale streaming state so the next send starts clean (Issue #200)
		agent.clearPendingUpdates();
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agent.cancelOperation, agent.clearPendingUpdates, agent.lastUserMessage]);

	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const isAgentSwitch =
				requestedAgentId && requestedAgentId !== session.agentId;

			// Skip if already empty AND not switching agents
			if (messages.length === 0 && !isAgentSwitch) {
				new Notice("[Agent Client] Already a new session");
				return;
			}

			// Cancel ongoing generation before starting new chat
			if (agent.isSending) {
				await agent.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${requestedAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExportIfEnabled("newChat", messages, session);
			}

			suggestions.mentions.toggleAutoMention(false);
			agent.clearMessages();

			const newAgentId = isAgentSwitch
				? requestedAgentId
				: session.agentId;
			await agent.restartSession(newAgentId);

			// Invalidate session history cache when creating new session
			sessionHistory.invalidateCache();
		},
		[
			messages,
			session,
			logger,
			autoExportIfEnabled,
			agent.isSending,
			agent.cancelOperation,
			agent.clearMessages,
			agent.restartSession,
			suggestions.mentions.toggleAutoMention,
			sessionHistory.invalidateCache,
		],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] No messages to export");
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(`[Agent Client] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[Agent Client] Failed to export chat");
			logger.error("Export error:", error);
		}
	}, [messages, session, plugin, logger]);

	const handleSwitchAgent = useCallback(
		async (agentId: string) => {
			if (agentId !== session.agentId) {
				await handleNewChat(agentId);
			}
		},
		[session.agentId, handleNewChat],
	);

	const handleRestartAgent = useCallback(async () => {
		logger.log("[ChatPanel] Restarting agent process...");

		// Auto-export current chat before restart (if has messages)
		if (messages.length > 0) {
			await autoExportIfEnabled("newChat", messages, session);
		}

		// Clear messages for fresh start
		agent.clearMessages();

		try {
			await agent.forceRestartAgent();
			new Notice("[Agent Client] Agent restarted");
		} catch (error) {
			new Notice("[Agent Client] Failed to restart agent");
			logger.error("Restart error:", error);
		}
	}, [
		logger,
		messages,
		session,
		autoExportIfEnabled,
		agent.clearMessages,
		agent.forceRestartAgent,
	]);

	// ============================================================
	// Config Actions
	// ============================================================

	const handleSetMode = useCallback(
		async (modeId: string) => {
			await agent.setMode(modeId);
		},
		[agent.setMode],
	);

	const handleSetModel = useCallback(
		async (modelId: string) => {
			await agent.setModel(modelId);
		},
		[agent.setModel],
	);

	const handleSetConfigOption = useCallback(
		async (configId: string, value: string) => {
			await agent.setConfigOption(configId, value);
		},
		[agent.setConfigOption],
	);

	// ============================================================
	// UI State Actions
	// ============================================================

	const handleClearError = useCallback(() => {
		agent.clearError();
	}, [agent.clearError]);

	const handleClearAgentUpdate = useCallback(() => {
		setAgentUpdateNotification(null);
	}, []);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Return
	// ============================================================

	return {
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleSwitchAgent,
		handleRestartAgent,
		handleSetMode,
		handleSetModel,
		handleSetConfigOption,
		handleClearError,
		handleClearAgentUpdate,
		handleRestoredMessageConsumed,
		restoredMessage,
		agentUpdateNotification,
		setAgentUpdateNotification,
		autoExportIfEnabled,
	};
}
