import { useCallback } from "react";
import type { ChatMessage } from "../domain/models/chat-message";
import type { ChatSession } from "../domain/models/chat-session";
import { ChatExporter } from "../shared/chat-exporter";
import { getLogger } from "../shared/logger";
import { Notice } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { tApp } from "../shared/i18n";

// ============================================================================
// Types
// ============================================================================

/**
 * Export settings from plugin settings.
 */
export interface ExportSettings {
	autoExportOnNewChat: boolean;
	autoExportOnCloseChat: boolean;
	openFileAfterExport: boolean;
}

/**
 * Return type for useAutoExport hook.
 */
export interface UseAutoExportReturn {
	/**
	 * Export chat if auto-export is enabled for the given trigger.
	 * @param trigger - What triggered the export ("newChat" or "closeChat")
	 * @param messages - Current messages to export
	 * @param session - Current session info
	 */
	autoExportIfEnabled: (
		trigger: "newChat" | "closeChat",
		messages: ChatMessage[],
		session: ChatSession,
	) => Promise<void>;

	/**
	 * Manually export chat (always exports, ignores auto-export settings).
	 * @param messages - Messages to export
	 * @param session - Session info
	 */
	exportChat: (
		messages: ChatMessage[],
		session: ChatSession,
	) => Promise<string | null>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing chat export functionality.
 *
 * This hook handles:
 * - Auto-export on new chat (before clearing messages)
 * - Auto-export on close chat (before disconnecting)
 * - Manual export
 *
 * @param plugin - Plugin instance for settings and exporter
 */
export function useAutoExport(plugin: AgentClientPlugin): UseAutoExportReturn {
	const logger = getLogger();

	/**
	 * Export chat to markdown file.
	 */
	const exportChat = useCallback(
		async (
			messages: ChatMessage[],
			session: ChatSession,
		): Promise<string | null> => {
			// Skip if no messages to export
			if (messages.length === 0) {
				return null;
			}

			// Skip if no session ID
			if (!session.sessionId) {
				return null;
			}

			try {
				const exporter = new ChatExporter(plugin);
				const openFile =
					plugin.settings.exportSettings.openFileAfterExport;

				const filePath = await exporter.exportToMarkdown(
					messages,
					session.agentDisplayName,
					session.agentId,
					session.sessionId,
					session.createdAt,
					openFile,
				);

				return filePath;
			} catch (error) {
				logger.error("Export failed:", error);
				throw error;
			}
		},
		[plugin],
	);

	/**
	 * Auto-export if enabled for the given trigger.
	 */
	const autoExportIfEnabled = useCallback(
		async (
			trigger: "newChat" | "closeChat",
			messages: ChatMessage[],
			session: ChatSession,
		): Promise<void> => {
			// Check the appropriate setting based on trigger
			const isEnabled =
				trigger === "newChat"
					? plugin.settings.exportSettings.autoExportOnNewChat
					: plugin.settings.exportSettings.autoExportOnCloseChat;

			// Skip if auto-export is disabled for this trigger
			if (!isEnabled) {
				return;
			}

			// Skip if no messages to export
			if (messages.length === 0) {
				return;
			}

			// Skip if no session ID
			if (!session.sessionId) {
				return;
			}

			try {
				const filePath = await exportChat(messages, session);

				if (filePath) {
					// Show success notification
					new Notice(
						tApp(plugin.app, "chatExportedTo", { path: filePath }),
					);

					// Log success
					const context =
						trigger === "newChat" ? "new session" : "closing chat";
					logger.log(`Chat auto-exported before ${context}`);
				}
			} catch {
				// Show error notification
				new Notice(tApp(plugin.app, "failedExportChat"));
				// Error already logged in exportChat
			}
		},
		[plugin, exportChat],
	);

	return {
		autoExportIfEnabled,
		exportChat,
	};
}
