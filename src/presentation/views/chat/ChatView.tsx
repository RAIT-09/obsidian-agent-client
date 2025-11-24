import { ItemView, WorkspaceLeaf, Platform, Notice } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";

// Component imports
import { ChatHeader } from "../../components/chat/ChatHeader";
import { ChatMessages } from "../../components/chat/ChatMessages";
import { ChatInput } from "../../components/chat/ChatInput";

// Service imports
import { NoteMentionService } from "../../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../../shared/logger";
import { ChatExporter } from "../../../shared/chat-exporter";

// Adapter imports
import { AcpAdapter, type IAcpClient } from "../../../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../../../adapters/obsidian/vault.adapter";

// Use Case imports
import { SendMessageUseCase } from "../../../core/use-cases/send-message.use-case";
import { ManageSessionUseCase } from "../../../core/use-cases/manage-session.use-case";

// Hooks imports
import { useSettings } from "../../../hooks/useSettings";
import { useMentions } from "../../../hooks/useMentions";
import { useSlashCommands } from "../../../hooks/useSlashCommands";
import { useAutoMention } from "../../../hooks/useAutoMention";
import { useAgentSession } from "../../../hooks/useAgentSession";
import { useChat } from "../../../hooks/useChat";
import { usePermission } from "../../../hooks/usePermission";

// ViewModel imports (temporary - will be removed)
import { ChatViewModel } from "../../../adapters/view-models/chat.view-model";

// Type definitions for Obsidian internal APIs
interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

function ChatComponent({
	plugin,
	view,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
}) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	const acpAdapter = useMemo(() => new AcpAdapter(plugin), [plugin]);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin);
	}, [plugin]);

	// ============================================================
	// Use Cases (temporary - will be inlined into hooks)
	// ============================================================
	const sendMessageUseCase = useMemo(() => {
		return new SendMessageUseCase(
			acpAdapter,
			vaultAccessAdapter,
			plugin.settingsStore,
			noteMentionService,
		);
	}, [acpAdapter, vaultAccessAdapter, plugin, noteMentionService]);

	const manageSessionUseCase = useMemo(() => {
		return new ManageSessionUseCase(acpAdapter, plugin.settingsStore);
	}, [acpAdapter, plugin]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const agentSession = useAgentSession(
		manageSessionUseCase,
		plugin.settingsStore,
		vaultPath,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chat = useChat(
		sendMessageUseCase,
		{
			sessionId: session.sessionId,
			authMethods: session.authMethods,
		},
		{
			windowsWslMode: settings.windowsWslMode,
		},
	);

	const { messages, isSending } = chat;

	const permission = usePermission(acpAdapter, messages);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const autoMention = useAutoMention(vaultAccessAdapter);
	const slashCommands = useSlashCommands(
		session.availableCommands || [],
		autoMention.toggle,
	);

	// Combined error info (session errors take precedence)
	const errorInfo =
		sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// ViewModel (temporary - for cleanup on close)
	// ============================================================
	const viewModel = useMemo(() => {
		return new ChatViewModel(
			plugin,
			sendMessageUseCase,
			manageSessionUseCase,
			plugin.settingsStore,
			vaultAccessAdapter,
			vaultPath,
		);
	}, [
		plugin,
		sendMessageUseCase,
		manageSessionUseCase,
		vaultAccessAdapter,
		vaultPath,
	]);

	useEffect(() => {
		view.viewModel = viewModel;
		return () => {
			view.viewModel = null;
		};
	}, [view, viewModel]);

	// ============================================================
	// Local State
	// ============================================================
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
			);
		}
		if (activeId === plugin.settings.codex.id) {
			return (
				plugin.settings.codex.displayName || plugin.settings.codex.id
			);
		}
		if (activeId === plugin.settings.gemini.id) {
			return (
				plugin.settings.gemini.displayName || plugin.settings.gemini.id
			);
		}
		const custom = plugin.settings.customAgents.find(
			(agent) => agent.id === activeId,
		);
		return custom?.displayName || custom?.id || activeId;
	}, [session.agentId, plugin.settings]);

	// ============================================================
	// Callbacks
	// ============================================================
	const handleNewChat = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] Already a new session");
			return;
		}

		logger.log("[Debug] Creating new session via useAgentSession...");
		autoMention.toggle(false);
		chat.clearMessages();
		await agentSession.restartSession();
	}, [messages.length, logger, autoMention, chat, agentSession]);

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

	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleSendMessage = useCallback(
		async (content: string) => {
			await chat.sendMessage(content, {
				activeNote: autoMention.activeNote,
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
				isAutoMentionDisabled: autoMention.isDisabled,
			});
		},
		[chat, autoMention, plugin],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		// Save last user message before cancel (to restore it)
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		// Restore the last user message to input field
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chat.lastUserMessage]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount or when agent changes
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession();
	}, [session.agentId, agentSession.createSession]);

	// Cleanup ViewModel on unmount
	useEffect(() => {
		return () => {
			viewModel.dispose();
		};
	}, [viewModel]);

	// Monitor agent changes from settings when messages are empty
	useEffect(() => {
		const newActiveAgentId = settings.activeAgentId || settings.claude.id;
		if (messages.length === 0 && newActiveAgentId !== session.agentId) {
			void agentSession.switchAgent(newActiveAgentId);
		}
	}, [
		settings.activeAgentId,
		messages.length,
		session.agentId,
		agentSession.switchAgent,
	]);

	// ============================================================
	// Effects - ACP Adapter Callbacks
	// ============================================================
	useEffect(() => {
		acpAdapter.setMessageCallbacks(
			chat.addMessage,
			chat.updateLastMessage,
			chat.updateMessage,
			agentSession.updateAvailableCommands,
		);
	}, [
		acpAdapter,
		chat.addMessage,
		chat.updateLastMessage,
		chat.updateMessage,
		agentSession.updateAvailableCommands,
	]);

	// ============================================================
	// Effects - Update Check
	// ============================================================
	useEffect(() => {
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((error) => {
				console.error("Failed to check for updates:", error);
			});
	}, [plugin]);

	// ============================================================
	// Effects - Auto-mention Active Note Tracking
	// ============================================================
	useEffect(() => {
		let isMounted = true;

		const refreshActiveNote = async () => {
			if (!isMounted) return;
			await autoMention.updateActiveNote();
		};

		const unsubscribe = vaultAccessAdapter.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [autoMention.updateActiveNote, vaultAccessAdapter]);

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = workspace.on(
			"agent-client:toggle-auto-mention" as "quit",
			() => {
				autoMention.toggle();
			},
		);

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, autoMention.toggle]);

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const approveRef = workspace.on(
			"agent-client:approve-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		const rejectRef = workspace.on(
			"agent-client:reject-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
	]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div className="chat-view-container">
			<ChatHeader
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				onNewChat={handleNewChat}
				onExportChat={handleExportChat}
				onOpenSettings={handleOpenSettings}
			/>

			<ChatMessages
				messages={messages}
				isSending={isSending}
				isSessionReady={isSessionReady}
				agentLabel={activeAgentLabel}
				errorInfo={errorInfo}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
				onClearError={handleClearError}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				autoMentionEnabled={settings.autoMentionActiveNote}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
			/>
		</div>
	);
}

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	public viewModel: ChatViewModel | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = new Logger(plugin);
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Agent client";
	}

	getIcon() {
		return "bot-message-square";
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatComponent plugin={this.plugin} view={this} />);
		return Promise.resolve();
	}

	async onClose() {
		this.logger.log("[ChatView] onClose() called");
		if (this.viewModel) {
			this.logger.log("[ChatView] Disposing ViewModel...");
			await this.viewModel.dispose();
			this.viewModel = null;
		} else {
			this.logger.log("[ChatView] No ViewModel to dispose");
		}
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
