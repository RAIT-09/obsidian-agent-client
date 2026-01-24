import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";
import { parseYaml, Notice } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";

// Component imports
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { AttachedImage } from "./ImagePreviewStrip";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// Service imports
import { NoteMentionService } from "../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../shared/logger";
import { ChatExporter } from "../../shared/chat-exporter";

// Adapter imports
import { ObsidianVaultAdapter } from "../../adapters/obsidian/vault.adapter";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";

// Hooks imports
import { useSettings } from "../../hooks/useSettings";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAutoMention } from "../../hooks/useAutoMention";
import { useAgentSession } from "../../hooks/useAgentSession";
import { useChat } from "../../hooks/useChat";
import { usePermission } from "../../hooks/usePermission";
import { useSessionHistory } from "../../hooks/useSessionHistory";

// Domain model imports
import type { ImagePromptContent } from "../../domain/models/prompt-content";
import type {
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";

interface CodeBlockConfig {
	image?: string;
	agent?: string;
	model?: string;
	height?: string;
}

interface CodeBlockChatComponentProps {
	plugin: AgentClientPlugin;
	config: CodeBlockConfig;
	el: HTMLElement;
}

function CodeBlockChatComponent({
	plugin,
	config,
	el,
}: CodeBlockChatComponentProps) {
	// ============================================================
	// Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const adapter = plugin.app.vault.adapter as any;
		if (adapter.basePath) return adapter.basePath;

		// Safe process.cwd() check
		if (typeof process !== "undefined" && process.cwd) {
			return process.cwd();
		}

		return "/";
	}, [plugin]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const componentId = useMemo(() => "code-block-" + Math.random().toString(36).substr(2, 9), []);
	const acpAdapter = useMemo(() => plugin.getOrCreateAdapter(componentId), [plugin, componentId]);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	// Input state
	const [inputValue, setInputValue] = useState("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	const agentSession = useAgentSession(
		acpAdapter,
		plugin.settingsStore,
		vaultPath,
	);

	const { session, errorInfo: sessionErrorInfo, isReady: isSessionReady } =
		agentSession;

	const chat = useChat(
		acpAdapter,
		vaultAccessAdapter,
		noteMentionService,
		{
			sessionId: session.sessionId,
			authMethods: session.authMethods,
			promptCapabilities: session.promptCapabilities,
		},
		{
			windowsWslMode: settings.windowsWslMode,
			maxNoteLength: settings.displaySettings.maxNoteLength,
			maxSelectionLength: settings.displaySettings.maxSelectionLength,
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

	const errorInfo =
		sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// Local State
	// ============================================================
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] = useState(false);

	// ============================================================
	// Session History
	// ============================================================
	const handleSessionLoad = useCallback(
		(
			sessionId: string,
			modes?: SessionModeState,
			models?: SessionModelState,
		) => {
			agentSession.updateSessionFromLoad(sessionId, modes, models);
		},
		[agentSession],
	);

	const handleLoadStart = useCallback(() => {
		setIsLoadingSessionHistory(true);
		chat.clearMessages();
	}, [chat]);

	const handleLoadEnd = useCallback(() => {
		setIsLoadingSessionHistory(false);
	}, []);

	const sessionHistory = useSessionHistory({
		agentClient: acpAdapter,
		session,
		settingsAccess: plugin.settingsStore,
		cwd: vaultPath,
		onSessionLoad: handleSessionLoad,
		onMessagesRestore: chat.setMessagesFromLocal,
		onLoadStart: handleLoadStart,
		onLoadEnd: handleLoadEnd,
	});

	// ============================================================
	// Mock View
	// ============================================================
	const mockView = useMemo(() => {
		return {
			app: plugin.app,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerDomEvent: (
				target: EventTarget,
				type: string,
				callback: EventListenerOrEventListenerObject,
			) => {
				target.addEventListener(type, callback);
				// Note: We are not cleaning this up automatically here.
				// ChatInput/SuggestionDropdown logic might need adjustment for proper cleanup.
			},
		} as unknown as ChatView;
	}, [plugin.app]);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		const activeId = session.agentId;
		// Simplification for label lookup
		return activeId;
	}, [session.agentId]);

	const availableAgents = useMemo(() => {
		const agents = [
			{ id: settings.claude.id, name: settings.claude.displayName || settings.claude.id },
			{ id: settings.codex.id, name: settings.codex.displayName || settings.codex.id },
			{ id: settings.gemini.id, name: settings.gemini.displayName || settings.gemini.id },
			...settings.customAgents.map((agent) => ({ id: agent.id, name: agent.displayName || agent.id })),
		];
		return agents;
	}, [settings]);

	const codeBlockImageSrc = useMemo(() => {
		const img = config.image;
		if (!img) return null;
		if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) {
			return img;
		}
		// Treat as local path
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (plugin.app.vault.adapter as any).getResourcePath(img);
	}, [config.image, plugin.app.vault.adapter]);

	// ============================================================
	// Callbacks
	// ============================================================
	const handleSendMessage = useCallback(
		async (content: string, images?: ImagePromptContent[]) => {
			const isFirstMessage = messages.length === 0;

			await chat.sendMessage(content, {
				activeNote: autoMention.activeNote,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				vaultBasePath: (plugin.app.vault.adapter as any).basePath || "",
				isAutoMentionDisabled: autoMention.isDisabled,
				images,
			});

			// Save session metadata locally on first message
			if (isFirstMessage && session.sessionId) {
				await sessionHistory.saveSessionLocally(
					session.sessionId,
					content,
				);
				console.log("[CodeBlock] Session saved locally:", session.sessionId);
			}
		},
		[chat, autoMention, plugin, messages.length, session.sessionId, sessionHistory],
	);

	const handleStopGeneration = useCallback(async () => {
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [agentSession, chat.lastUserMessage]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	const handleNewSession = useCallback(async () => {
		if (chat.isSending) {
			await agentSession.cancelOperation();
		}
		chat.clearMessages();
		await agentSession.restartSession();
		sessionHistory.invalidateCache();
	}, [chat, agentSession, sessionHistory]);

	const handleAgentChange = useCallback(
		async (agentId: string) => {
			await agentSession.switchAgent(agentId);
			await agentSession.createSession(agentId);
		},
		[agentSession],
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

	// ============================================================
	// Effects
	// ============================================================
	// Track previous isSending state to detect turn completion
	const prevIsSendingRef = useRef<boolean>(false);

	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;

		// Save when turn ends (isSending: true → false) and has messages
		if (
			wasSending &&
			!isSending &&
			session.sessionId &&
			messages.length > 0
		) {
			// Fire-and-forget save via sessionHistory hook
			sessionHistory.saveSessionMessages(session.sessionId, messages);
			console.log("[CodeBlock] Session messages saved:", session.sessionId);
		}
	}, [isSending, session.sessionId, messages, sessionHistory]);
	// Fetch sessions when agent changes or becomes ready
	useEffect(() => {
		if (isSessionReady && session.agentId) {
			console.log("[CodeBlock] Agent ready, fetching sessions for:", session.agentId);
			void sessionHistory.fetchSessions(vaultPath);
		}
	}, [isSessionReady, session.agentId, sessionHistory.fetchSessions, vaultPath]);

	// Initialize session (run once)
	useEffect(() => {
		console.log("[CodeBlock] Initializing session...");
		void agentSession.createSession();
		// Switch to configured agent if specified
		if (config.agent && config.agent !== session.agentId) {
			void agentSession.restartSession(config.agent);
		}
	}, [agentSession.createSession]); // Run once effectively

	// Log sessions update
	useEffect(() => {
		console.log("[CodeBlock] Sessions available:", sessionHistory.sessions.length);
	}, [sessionHistory.sessions]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			void agentSession.closeSession();
		};
	}, []);

	// Session updates
	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			if (session.sessionId && update.sessionId !== session.sessionId) {
				return;
			}

			// During session/load, ignore history replay messages but process session-level updates
			if (isLoadingSessionHistory) {
				if (update.type === "available_commands_update") {
					agentSession.updateAvailableCommands(update.commands);
				} else if (update.type === "current_mode_update") {
					agentSession.updateCurrentMode(update.currentModeId);
				}
				return;
			}

			chat.handleSessionUpdate(update);
			if (update.type === "available_commands_update") {
				agentSession.updateAvailableCommands(update.commands);
			} else if (update.type === "current_mode_update") {
				agentSession.updateCurrentMode(update.currentModeId);
			}
		});
	}, [
		acpAdapter,
		session.sessionId,
		isLoadingSessionHistory,
		chat.handleSessionUpdate,
		agentSession.updateAvailableCommands,
		agentSession.updateCurrentMode,
	]);

	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div className="agent-client-code-block-container">
			{codeBlockImageSrc && (
				<div className="agent-client-code-block-image-container">
					<img
						src={codeBlockImageSrc}
						alt="Agent"
						className="agent-client-code-block-image"
					/>
				</div>
			)}

			<div className="agent-client-code-block-content">
				<div className="agent-client-code-block-status">
					<div className="agent-client-status-indicator">
						<span
							className={`agent-client-status-dot ${isSessionReady ? "ready" : "connecting"}`}
						/>
						{/* Agent Selector in status bar for code block */}
						<select
							className="agent-client-agent-selector"
							value={session.agentId}
							onChange={(e) => handleAgentChange(e.target.value)}
							style={{ marginLeft: "4px", fontSize: "11px" }}
						>
							{availableAgents.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{agent.name}
								</option>
							))}
						</select>
					</div>
					{autoMention.activeNote && !autoMention.isDisabled && (
						<div className="agent-client-active-note-indicator">
							<span className="agent-client-note-icon">📄</span>
							<span className="agent-client-note-name">
								{autoMention.activeNote.name}
							</span>
						</div>
					)}

					<div className="agent-client-code-block-status-actions">
						{sessionHistory.loading && (
							<span
								className="agent-client-history-loading"
								title="Loading history..."
							>
								↻
							</span>
						)}

						<select
							className="agent-client-session-selector"
							onChange={(e) => {
								if (e.target.value) {
									void sessionHistory.restoreSession(
										e.target.value,
										vaultPath,
									);
								}
							}}
							value={session.sessionId || ""}
							disabled={sessionHistory.sessions.length === 0}
						>
							<option value="" disabled>
								{sessionHistory.sessions.length === 0
									? "No saved sessions"
									: "Restore session..."}
							</option>
							<option value={session.sessionId || "current"}>
								Current session
							</option>
							{sessionHistory.sessions
								.filter(
									(s) => s.sessionId !== session.sessionId,
								)
								.map((s) => (
									<option
										key={s.sessionId}
										value={s.sessionId}
									>
										{s.title || s.sessionId}
									</option>
								))}
						</select>

						<button
							className="agent-client-header-action-button"
							onClick={() => void handleExportChat()}
							title="Export chat to Markdown"
							disabled={messages.length === 0}
						>
							💾
						</button>
						<button
							className="agent-client-header-action-button"
							onClick={() => void agentSession.forceRestartAgent()}
							title="Restart agent"
						>
							🔄
						</button>
						<button
							className="agent-client-new-session-button"
							onClick={() => void handleNewSession()}
							title="New session"
						>
							+
						</button>
					</div>
				</div>
				{messages.length > 0 && (
					<div className="agent-client-code-block-messages">
						<ChatMessages
							messages={messages}
							isSending={isSending}
							isSessionReady={isSessionReady}
							isRestoringSession={false}
							agentLabel={activeAgentLabel}
							plugin={plugin}
							view={mockView}
							acpClient={acpClientRef.current}
							onApprovePermission={permission.approvePermission}
						/>
					</div>
				)}

				<ChatInput
					isSending={isSending}
					isSessionReady={isSessionReady}
					isRestoringSession={false}
					agentLabel={activeAgentLabel}
					availableCommands={session.availableCommands || []}
					autoMentionEnabled={settings.autoMentionActiveNote}
					restoredMessage={restoredMessage}
					mentions={mentions}
					slashCommands={slashCommands}
					autoMention={autoMention}
					plugin={plugin}
					view={mockView}
					onSendMessage={handleSendMessage}
					onStopGeneration={handleStopGeneration}
					onRestoredMessageConsumed={handleRestoredMessageConsumed}
					modes={session.modes}
					onModeChange={(modeId) => void agentSession.setMode(modeId)}
					models={session.models}
					onModelChange={(modelId) => void agentSession.setModel(modelId)}
					supportsImages={session.promptCapabilities?.image ?? false}
					agentId={session.agentId}
					inputValue={inputValue}
					onInputChange={setInputValue}
					attachedImages={attachedImages}
					onAttachedImagesChange={setAttachedImages}
					errorInfo={errorInfo}
					onClearError={handleClearError}
				/>			</div>
		</div>
	);
}

export function mountCodeBlockChat(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	source: string,
) {
	let config: CodeBlockConfig = {};
	try {
		config = (parseYaml(source) as CodeBlockConfig) || {};
	} catch (e) {
		console.warn("Failed to parse code block YAML:", e);
	}

    const container = el.createDiv();
	const root = createRoot(container);
	root.render(
		<CodeBlockChatComponent plugin={plugin} config={config} el={el} />,
	);

	return root;
}
