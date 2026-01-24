import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";
import { Notice } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";

// Component imports
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import type { AttachedImage } from "./ImagePreviewStrip";

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

interface FloatingChatComponentProps {
	plugin: AgentClientPlugin;
}

function FloatingChatComponent({ plugin }: FloatingChatComponentProps) {
	const settings = useSettings(plugin);

	// Input state
	const [inputValue, setInputValue] = useState("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	// ============================================================
	// UI State
	// ============================================================
	const [isExpanded, setIsExpanded] = useState(false);
	const [size, setSize] = useState(settings.floatingWindowSize);
	const [position, setPosition] = useState(() => {
		if (settings.floatingWindowPosition) return settings.floatingWindowPosition;
		return {
			x: window.innerWidth - settings.floatingWindowSize.width - 50,
			y: window.innerHeight - settings.floatingWindowSize.height - 50
		};
	});
	const [isDragging, setIsDragging] = useState(false);
	const dragOffset = useRef({ x: 0, y: 0 });
	const containerRef = useRef<HTMLDivElement>(null);

	// Sync manual resizing with state
	useEffect(() => {
		if (!isExpanded || !containerRef.current) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				// Only update if significantly different to avoid loops
				if (Math.abs(width - size.width) > 5 || Math.abs(height - size.height) > 5) {
					setSize({ width, height });
				}
			}
		});

		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [isExpanded]);

	// Save size to settings
	useEffect(() => {
		const saveSize = async () => {
			if (size.width !== settings.floatingWindowSize.width || size.height !== settings.floatingWindowSize.height) {
				await plugin.saveSettingsAndNotify({
					...plugin.settings,
					floatingWindowSize: size
				});
			}
		};

		const timer = setTimeout(saveSize, 500); // Debounce save
		return () => clearTimeout(timer);
	}, [size, plugin, settings.floatingWindowSize]);

	// Save position to settings
	useEffect(() => {
		const savePosition = async () => {
			if (!settings.floatingWindowPosition ||
				position.x !== settings.floatingWindowPosition.x ||
				position.y !== settings.floatingWindowPosition.y) {
				await plugin.saveSettingsAndNotify({
					...plugin.settings,
					floatingWindowPosition: position
				});
			}
		};

		const timer = setTimeout(savePosition, 500); // Debounce save
		return () => clearTimeout(timer);
	}, [position, plugin, settings.floatingWindowPosition]);

	// ============================================================
	// Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const adapter = plugin.app.vault.adapter as any;
		if (adapter.basePath) return adapter.basePath;
		if (typeof process !== "undefined" && process.cwd) return process.cwd();
		return "/";
	}, [plugin]);

	const noteMentionService = useMemo(() => new NoteMentionService(plugin), [plugin]);

	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const acpAdapter = useMemo(() => plugin.getOrCreateAdapter("floating-chat"), [plugin]);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const agentSession = useAgentSession(acpAdapter, plugin.settingsStore, vaultPath);
	const { session, errorInfo: sessionErrorInfo, isReady: isSessionReady } = agentSession;

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
	const slashCommands = useSlashCommands(session.availableCommands || [], autoMention.toggle);

	// Session History
	const [isLoadingSessionHistory, setIsLoadingSessionHistory] = useState(false);

	const handleSessionLoad = useCallback((sessionId: string, modes?: SessionModeState, models?: SessionModelState) => {
		agentSession.updateSessionFromLoad(sessionId, modes, models);
	}, [agentSession]);

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

	const errorInfo = sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// Mock View
	// ============================================================
	const mockView = useMemo(() => {
		return {
			app: plugin.app,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			registerDomEvent: (target: EventTarget, type: string, callback: any) => {
				target.addEventListener(type, callback);
			},
		} as unknown as ChatView;
	}, [plugin.app]);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => session.agentId, [session.agentId]);

	const availableAgents = useMemo(() => {
		const agents = [
			{ id: settings.claude.id, name: settings.claude.displayName || settings.claude.id },
			{ id: settings.codex.id, name: settings.codex.displayName || settings.codex.id },
			{ id: settings.gemini.id, name: settings.gemini.displayName || settings.gemini.id },
			...settings.customAgents.map((agent) => ({ id: agent.id, name: agent.displayName || agent.id })),
		];
		return agents;
	}, [settings]);

	const floatingButtonImageSrc = useMemo(() => {
		const img = settings.floatingButtonImage;
		if (!img) return null;
		if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) {
			return img;
		}
		// Treat as local path
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (plugin.app.vault.adapter as any).getResourcePath(img);
	}, [settings.floatingButtonImage, plugin.app.vault.adapter]);

	// ============================================================
	// Callbacks
	// ============================================================
	const handleSendMessage = useCallback(async (content: string, images?: ImagePromptContent[]) => {
		const isFirstMessage = messages.length === 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const vaultBasePath = (plugin.app.vault.adapter as any).basePath || "";

		await chat.sendMessage(content, {
			activeNote: autoMention.activeNote,
			vaultBasePath,
			isAutoMentionDisabled: autoMention.isDisabled,
			images,
		});

		if (isFirstMessage && session.sessionId) {
			await sessionHistory.saveSessionLocally(session.sessionId, content);
		}
	}, [chat, autoMention, plugin, messages.length, session.sessionId, sessionHistory]);

	const handleStopGeneration = useCallback(async () => {
		await agentSession.cancelOperation();
	}, [agentSession]);

	const handleNewSession = useCallback(async () => {
		if (chat.isSending) await agentSession.cancelOperation();
		chat.clearMessages();
		await agentSession.restartSession();
		sessionHistory.invalidateCache();
	}, [chat, agentSession, sessionHistory]);

	const handleAgentChange = useCallback(async (agentId: string) => {
		await agentSession.switchAgent(agentId);
		await agentSession.createSession(agentId);
	}, [agentSession]);

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
	// Dragging Logic
	// ============================================================
	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (!containerRef.current) return;
		setIsDragging(true);
		dragOffset.current = {
			x: e.clientX - position.x,
			y: e.clientY - position.y
		};
	}, [position]);

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			setPosition({
				x: e.clientX - dragOffset.current.x,
				y: e.clientY - dragOffset.current.y
			});
		};

		const onMouseUp = () => {
			setIsDragging(false);
		};

		if (isDragging) {
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", onMouseUp);
		}

		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [isDragging]);

	// ============================================================
	// Initialization & Effects
	// ============================================================
	useEffect(() => {
		void agentSession.createSession();
	}, [agentSession.createSession]);

	useEffect(() => {
		if (isSessionReady && session.agentId) {
			void sessionHistory.fetchSessions(vaultPath);
		}
	}, [isSessionReady, session.agentId, sessionHistory.fetchSessions, vaultPath]);

	const prevIsSendingRef = useRef<boolean>(false);
	useEffect(() => {
		const wasSending = prevIsSendingRef.current;
		prevIsSendingRef.current = isSending;
		if (wasSending && !isSending && session.sessionId && messages.length > 0) {
			sessionHistory.saveSessionMessages(session.sessionId, messages);
		}
	}, [isSending, session.sessionId, messages, sessionHistory]);

	useEffect(() => {
		acpAdapter.onSessionUpdate((update) => {
			if (session.sessionId && update.sessionId !== session.sessionId) return;
			if (isLoadingSessionHistory) {
				if (update.type === "available_commands_update") agentSession.updateAvailableCommands(update.commands);
				else if (update.type === "current_mode_update") agentSession.updateCurrentMode(update.currentModeId);
				return;
			}
			chat.handleSessionUpdate(update);
			if (update.type === "available_commands_update") agentSession.updateAvailableCommands(update.commands);
			else if (update.type === "current_mode_update") agentSession.updateCurrentMode(update.currentModeId);
		});
	}, [acpAdapter, session.sessionId, isLoadingSessionHistory, chat.handleSessionUpdate, agentSession.updateAvailableCommands, agentSession.updateCurrentMode]);

	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	// Auto-mention Active Note Tracking
	useEffect(() => {
		if (!settings.autoMentionActiveNote) return;

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
	}, [autoMention.updateActiveNote, vaultAccessAdapter, settings.autoMentionActiveNote]);

	// ============================================================
	// Render
	// ============================================================
	if (!settings.showFloatingButton) return null;

	if (!isExpanded) {
		return (
			<div
				className="agent-client-floating-button"
				onClick={() => setIsExpanded(true)}
				style={floatingButtonImageSrc ? { background: "transparent" } : undefined}
			>
				{floatingButtonImageSrc ? (
					<img src={floatingButtonImageSrc} alt="AI" />
				) : (
					<div className="agent-client-floating-button-fallback">
						<span>AI</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="agent-client-floating-window"
			style={{
				left: position.x,
				top: position.y,
				width: size.width,
				height: size.height
			}}
		>
			<div className="agent-client-floating-header" onMouseDown={onMouseDown}>
				<div className="agent-client-floating-header-title">
					<select
						className="agent-client-agent-selector"
						value={session.agentId}
						onChange={(e) => handleAgentChange(e.target.value)}
						onMouseDown={(e) => e.stopPropagation()}
					>
						{availableAgents.map((agent) => (
							<option key={agent.id} value={agent.id}>
								{agent.name}
							</option>
						))}
					</select>
				</div>
				<div className="agent-client-floating-header-actions">
					<button className="agent-client-floating-close" onClick={() => setIsExpanded(false)}>×</button>
				</div>
			</div>

			<div className="agent-client-floating-content">
				{floatingButtonImageSrc && (
					<div className="agent-client-code-block-image-container">
						<img
							src={floatingButtonImageSrc}
							alt="Agent"
							className="agent-client-code-block-image"
						/>
					</div>
				)}

				<div className="agent-client-code-block-status">
					<div className="agent-client-status-indicator">
						<span className={`agent-client-status-dot ${isSessionReady ? "ready" : "connecting"}`} />
						<span className="agent-client-status-text">{isSessionReady ? "Ready" : "Connecting..."}</span>
					</div>

					<div className="agent-client-code-block-status-actions">
						{sessionHistory.loading && <span className="agent-client-history-loading">↻</span>}

						<select
							className="agent-client-session-selector"
							onChange={(e) => e.target.value && void sessionHistory.restoreSession(e.target.value, vaultPath)}
							value={session.sessionId || ""}
							disabled={sessionHistory.sessions.length === 0}
						>
							<option value="" disabled>{sessionHistory.sessions.length === 0 ? "No saved sessions" : "Restore session..."}</option>
							<option value={session.sessionId || "current"}>Current session</option>
							{sessionHistory.sessions
								.filter((s) => s.sessionId !== session.sessionId)
								.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.title || s.sessionId}</option>)}
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
						<button className="agent-client-new-session-button" onClick={() => void handleNewSession()} title="New session">+</button>
					</div>
				</div>

				<div className="agent-client-floating-messages-container">
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

				<ChatInput
					isSending={isSending}
					isSessionReady={isSessionReady}
					isRestoringSession={false}
					agentLabel={activeAgentLabel}
					availableCommands={session.availableCommands || []}
					autoMentionEnabled={settings.autoMentionActiveNote}
					restoredMessage={null}
					mentions={mentions}
					slashCommands={slashCommands}
					autoMention={autoMention}
					plugin={plugin}
					view={mockView}
					onSendMessage={handleSendMessage}
					onStopGeneration={handleStopGeneration}
					onRestoredMessageConsumed={() => {}}
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
					onClearError={() => chat.clearError()}
				/>							</div>
						</div>
					);
				}
export function mountFloatingChat(plugin: AgentClientPlugin) {
	const container = document.body.createDiv({ cls: "agent-client-floating-root" });
	const root = createRoot(container);
	root.render(<FloatingChatComponent plugin={plugin} />);
	return root;
}
