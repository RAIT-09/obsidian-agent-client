/**
 * ChatViewComponent
 *
 * Main React component for the chat view. Handles chat state via hooks
 * and delegates rendering to extracted components.
 */

import * as React from "react";
import { Platform, Notice } from "obsidian";

import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { IAcpClient } from "../../../adapters/acp/acp.adapter";
import type { NoteMetadata } from "../../../types";

import { PluginProvider } from "../../../contexts";
import {
	useSettingsValue,
	useChat,
	useMentionsDropdown,
	useSlashCommandsDropdown,
} from "../../../hooks";

import { ChatHeader } from "../../components/chat/ChatHeader";
import { ChatMessages } from "../../components/chat/ChatMessages";
import { ChatInput } from "../../components/chat/ChatInput";

import { Logger } from "../../../shared/logger";
import { ChatExporter } from "../../../shared/chat-exporter";

import type { ChatBridge } from "./ChatBridge";
import type { ChatView } from "./ChatView";

const { useState, useRef, useEffect, useMemo, useCallback } = React;

interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

interface ChatViewComponentProps {
	plugin: AgentClientPlugin;
	view: ChatView;
}

export function ChatViewComponent({ plugin, view }: ChatViewComponentProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

	const settings = useSettingsValue();

	// Update check
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch(console.error);
	}, [plugin]);

	// Active note tracking
	const [lastActiveNote, setLastActiveNote] = useState<NoteMetadata | null>(
		null,
	);

	// Scroll state
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const acpClientRef = useRef<IAcpClient | null>(null);

	// Initialize Hooks
	const chat = useChat({ plugin, workingDirectory: vaultPath });

	useEffect(() => {
		acpClientRef.current = chat.acpClient;
	}, [chat.acpClient]);

	const mentions = useMentionsDropdown({
		plugin,
		vaultAccess: chat.vaultAdapter,
	});

	const slashCommands = useSlashCommandsDropdown({
		availableCommands: chat.availableCommands,
		onAutoMentionToggle: mentions.toggleAutoMention,
	});

	// Bridge for ChatView Class
	const bridgeRef = useRef<ChatBridge | null>(null);

	useEffect(() => {
		bridgeRef.current = {
			dispose: chat.dispose,
			approveActivePermission: chat.approveActivePermission,
			rejectActivePermission: chat.rejectActivePermission,
			toggleAutoMention: mentions.toggleAutoMention,
			getIsAutoMentionDisabled: () => mentions.isAutoMentionDisabled,
			getSnapshot: () => ({
				messages: chat.messages,
				session: { agentId: chat.session.agentId },
			}),
			restartSession: chat.restartSession,
		};
		view.chatBridge = bridgeRef.current;
		return () => {
			view.chatBridge = null;
		};
	}, [view, chat, mentions]);

	// Session initialization
	useEffect(() => {
		logger.log("[Debug] Starting connection setup...");
		chat.createNewSession();
	}, [chat.session.agentId, chat, logger]);

	// Cleanup
	useEffect(() => {
		return () => {
			chat.dispose();
		};
	}, [chat]);

	// Monitor agent changes
	useEffect(() => {
		const newActiveAgentId = settings.activeAgentId || settings.claude.id;
		if (
			chat.messages.length === 0 &&
			newActiveAgentId !== chat.session.agentId
		) {
			chat.switchAgent(newActiveAgentId);
		}
	}, [settings.activeAgentId, chat]);

	// Active note tracking
	useEffect(() => {
		let isMounted = true;
		const refresh = async () => {
			if (!isMounted) return;
			const note = await chat.vaultAdapter.getActiveNote();
			setLastActiveNote(note);
		};
		const unsub = chat.vaultAdapter.subscribeSelectionChanges(() => {
			void refresh();
		});
		void refresh();
		return () => {
			isMounted = false;
			unsub();
		};
	}, [chat.vaultAdapter]);

	// Auto-scroll
	useEffect(() => {
		if (isAtBottom && chat.messages.length > 0) {
			window.setTimeout(() => {
				messagesContainerRef.current?.scrollTo({
					top: messagesContainerRef.current.scrollHeight,
				});
			}, 0);
		}
	}, [chat.messages, isAtBottom]);

	// Scroll event listener
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		const handleScroll = () => {
			const threshold = 50;
			const isNearBottom =
				container.scrollTop + container.clientHeight >=
				container.scrollHeight - threshold;
			setIsAtBottom(isNearBottom);
		};

		view.registerDomEvent(container, "scroll", handleScroll);
		handleScroll();
	}, [view]);

	// Callbacks
	const getAgentLabel = useCallback(() => {
		const id = chat.session.agentId;
		if (id === plugin.settings.claude.id)
			return plugin.settings.claude.displayName || id;
		if (id === plugin.settings.codex.id)
			return plugin.settings.codex.displayName || id;
		if (id === plugin.settings.gemini.id)
			return plugin.settings.gemini.displayName || id;
		const custom = plugin.settings.customAgents.find((a) => a.id === id);
		return custom?.displayName || custom?.id || id;
	}, [chat.session.agentId, plugin.settings]);

	const handleNewChat = useCallback(async () => {
		if (chat.messages.length === 0) {
			new Notice("[Agent Client] Already a new session");
			return;
		}
		mentions.toggleAutoMention(false);
		await chat.restartSession();
	}, [chat, mentions]);

	const handleExport = useCallback(async () => {
		if (chat.messages.length === 0) {
			new Notice("[Agent Client] No messages to export");
			return;
		}
		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				chat.messages,
				chat.session.agentDisplayName,
				chat.session.agentId,
				chat.session.sessionId || "unknown",
				chat.session.createdAt,
				openFile,
			);
			new Notice(`[Agent Client] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[Agent Client] Failed to export chat");
			logger.error("Export error:", error);
		}
	}, [chat, plugin, logger]);

	const handleSettings = useCallback(() => {
		const appSettings = plugin.app as unknown as AppWithSettings;
		appSettings.setting.open();
		appSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleSendMessage = useCallback(
		async (message: string) => {
			if (!message.trim() || chat.isSending) return;
			setIsAtBottom(true);
			await chat.sendMessage(message, {
				activeNote: lastActiveNote,
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
				isAutoMentionDisabled: mentions.isAutoMentionDisabled,
			});
		},
		[chat, lastActiveNote, plugin, mentions.isAutoMentionDisabled],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		await chat.cancelCurrentOperation();
	}, [chat, logger]);

	const agentLabel = getAgentLabel();
	const isSessionReady = chat.session.state === "ready";

	// Render
	return (
		<div className="chat-view-container">
			<ChatHeader
				agentLabel={agentLabel}
				isUpdateAvailable={isUpdateAvailable}
				onNewChat={handleNewChat}
				onExport={handleExport}
				onSettings={handleSettings}
			/>

			<ChatMessages
				ref={messagesContainerRef}
				messages={chat.messages}
				errorInfo={chat.errorInfo}
				isSending={chat.isSending}
				isSessionReady={isSessionReady}
				agentLabel={agentLabel}
				plugin={plugin}
				acpClient={acpClientRef.current || undefined}
				onApprovePermission={chat.approvePermission}
				onClearError={chat.clearError}
			/>

			<ChatInput
				plugin={plugin}
				view={view}
				agentLabel={agentLabel}
				isSending={chat.isSending}
				isSessionReady={isSessionReady}
				availableCommands={chat.availableCommands}
				autoMentionEnabled={settings.autoMentionActiveNote}
				lastActiveNote={lastActiveNote}
				isAutoMentionDisabled={mentions.isAutoMentionDisabled}
				onToggleAutoMention={mentions.toggleAutoMention}
				showMentionDropdown={mentions.showDropdown}
				mentionSuggestions={mentions.suggestions}
				selectedMentionIndex={mentions.selectedIndex}
				onSelectMention={(s) => mentions.selectMention("", s)}
				onCloseMentionDropdown={mentions.closeDropdown}
				onNavigateMention={mentions.navigate}
				onUpdateMentionSuggestions={mentions.updateSuggestions}
				showSlashCommandDropdown={slashCommands.showDropdown}
				slashCommandSuggestions={slashCommands.suggestions}
				selectedSlashCommandIndex={slashCommands.selectedIndex}
				onSelectSlashCommand={slashCommands.selectCommand}
				onCloseSlashCommandDropdown={slashCommands.closeDropdown}
				onNavigateSlashCommand={slashCommands.navigate}
				onUpdateSlashCommandSuggestions={
					slashCommands.updateSuggestions
				}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
			/>
		</div>
	);
}

export function ChatViewWrapper({
	plugin,
	view,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
}) {
	return (
		<PluginProvider plugin={plugin}>
			<ChatViewComponent plugin={plugin} view={view} />
		</PluginProvider>
	);
}
