import { ItemView, WorkspaceLeaf, setIcon, Platform, Notice } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useSyncExternalStore, useMemo } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";

// Component imports
import { MentionDropdown } from "../../components/chat/MentionDropdown";
import { MessageRenderer } from "../../components/chat/MessageRenderer";
import { HeaderButton } from "../../components/shared/HeaderButton";

// Service imports
import { NoteMentionService } from "../../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../../shared/logger";
import { ChatExporter } from "../../../shared/chat-exporter";

// Type imports
import type { NoteMetadata } from "../../../core/domain/ports/vault-access.port";

// Adapter imports
import { AcpAdapter, type IAcpClient } from "../../../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../../../adapters/obsidian/vault.adapter";

// Use Case imports
import { SendMessageUseCase } from "../../../core/use-cases/send-message.use-case";
import { ManageSessionUseCase } from "../../../core/use-cases/manage-session.use-case";
import { HandlePermissionUseCase } from "../../../core/use-cases/handle-permission.use-case";
import { SwitchAgentUseCase } from "../../../core/use-cases/switch-agent.use-case";

// ViewModel imports
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
	// Create logger instance
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	// Check current platform (Obsidian requires this check for desktop-only plugins)
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// Get the Vault root path (safe to use after platform check)
	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

	// Use the settings store to get reactive settings
	const settings = useSyncExternalStore(
		plugin.settingsStore.subscribe,
		plugin.settingsStore.getSnapshot,
		plugin.settingsStore.getSnapshot,
	);

	// Check for updates asynchronously
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	useEffect(() => {
		plugin.checkForUpdates().then(setIsUpdateAvailable);
	}, []);

	const [inputValue, setInputValue] = useState("");
	const [lastActiveNote, setLastActiveNote] = useState<NoteMetadata | null>(
		null,
	);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const acpClientRef = useRef<IAcpClient | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	// Note mention service for @-mention functionality
	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	// Create AcpAdapter (shared across all use cases)
	// Callbacks will be set after ViewModel creation
	const acpAdapter = useMemo(() => {
		const adapter = new AcpAdapter(plugin);
		// Set acpClientRef for TerminalRenderer access
		acpClientRef.current = adapter;
		return adapter;
	}, [plugin]);

	// Create ObsidianVaultAdapter
	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin);
	}, [plugin]);

	// Create SendMessageUseCase
	const sendMessageUseCase = useMemo(() => {
		return new SendMessageUseCase(
			acpAdapter, // Use AcpAdapter as IAgentClient
			vaultAccessAdapter,
			plugin.settingsStore,
			noteMentionService,
		);
	}, [acpAdapter, vaultAccessAdapter, plugin, noteMentionService]);

	// Create ManageSessionUseCase
	const manageSessionUseCase = useMemo(() => {
		return new ManageSessionUseCase(
			acpAdapter, // Use AcpAdapter as IAgentClient
			plugin.settingsStore,
		);
	}, [acpAdapter, plugin]);

	// Create HandlePermissionUseCase
	const handlePermissionUseCase = useMemo(() => {
		return new HandlePermissionUseCase(
			acpAdapter, // Use AcpAdapter as IAgentClient
			plugin.settingsStore,
		);
	}, [acpAdapter, plugin]);

	// Create SwitchAgentUseCase
	const switchAgentUseCase = useMemo(() => {
		return new SwitchAgentUseCase(plugin.settingsStore);
	}, [plugin]);

	// Create ChatViewModel
	const viewModel = useMemo(() => {
		return new ChatViewModel(
			plugin,
			sendMessageUseCase,
			manageSessionUseCase,
			handlePermissionUseCase,
			switchAgentUseCase,
			vaultAccessAdapter,
			vaultPath,
		);
	}, [
		plugin,
		sendMessageUseCase,
		manageSessionUseCase,
		handlePermissionUseCase,
		switchAgentUseCase,
		vaultAccessAdapter,
		vaultPath,
	]);

	// Set AcpAdapter callbacks to ViewModel methods
	// This connects the adapter's message updates to the ViewModel's state management
	useEffect(() => {
		acpAdapter.setMessageCallbacks(
			viewModel.addMessage,
			viewModel.updateLastMessage,
			viewModel.updateMessage,
		);
	}, [acpAdapter, viewModel]);

	// Subscribe to ViewModel state
	const vmState = useSyncExternalStore(
		viewModel.subscribe,
		viewModel.getSnapshot,
		viewModel.getSnapshot,
	);

	// Extract state from ViewModel for easier access
	const messages = vmState.messages;
	const session = vmState.session;
	const errorInfo = vmState.errorInfo;
	const isSendingFromVM = vmState.isSending;

	// Mention dropdown state from ViewModel
	const showMentionDropdown = vmState.showMentionDropdown;
	const mentionSuggestions = vmState.mentionSuggestions;
	const selectedMentionIndex = vmState.selectedMentionIndex;
	const isAutoMentionTemporarilyDisabled =
		vmState.isAutoMentionTemporarilyDisabled;

	// Helper to check if agent is currently processing a request
	const isSending = isSendingFromVM; // Use ViewModel state

	// Helper to check if session is ready for user input
	const isSessionReady = session.state === "ready";

	const getActiveAgentLabel = () => {
		const activeId = session.agentId;
		if (activeId === plugin.settings.claude.id) {
			return (
				plugin.settings.claude.displayName || plugin.settings.claude.id
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
	};

	const activeAgentLabel = getActiveAgentLabel();

	// Auto-scroll functions
	const checkIfAtBottom = () => {
		const container = messagesContainerRef.current;
		if (!container) return true;

		const threshold = 50;
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	};

	const scrollToBottom = () => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	};

	// Mention handling - delegate to ViewModel
	const selectMention = (suggestion: NoteMetadata) => {
		const newText = viewModel.selectMention(inputValue, suggestion);
		setInputValue(newText);

		// Set cursor position after replacement
		window.setTimeout(() => {
			const textarea = textareaRef.current;
			if (textarea) {
				// Calculate new cursor position (end of replaced mention)
				const cursorPos = newText.length;
				textarea.selectionStart = cursorPos;
				textarea.selectionEnd = cursorPos;
				textarea.focus();
			}
		}, 0);
	};

	const adjustTextareaHeight = () => {
		const textarea = textareaRef.current;
		if (textarea) {
			// Remove previous dynamic height classes
			textarea.classList.remove(
				"textarea-auto-height",
				"textarea-expanded",
			);

			// Temporarily use auto to measure
			textarea.classList.add("textarea-auto-height");
			const scrollHeight = textarea.scrollHeight;
			const maxHeight = 300; // Increased from 120 to 300
			const hasAutoMention =
				textarea.classList.contains("has-auto-mention");
			const minHeight = hasAutoMention ? 116 : 80;

			// Check if expansion is needed
			const calculatedHeight = Math.max(
				minHeight,
				Math.min(scrollHeight, maxHeight),
			);

			// Apply expanded class if needed
			if (calculatedHeight > minHeight) {
				textarea.classList.add("textarea-expanded");
				// Set CSS variable for dynamic height
				textarea.style.setProperty(
					"--textarea-height",
					`${calculatedHeight}px`,
				);
			} else {
				textarea.style.removeProperty("--textarea-height");
			}

			textarea.classList.remove("textarea-auto-height");
		}
	};

	// Initialize session on mount or agent change
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via ViewModel...");
		viewModel.createNewSession();

		return () => {
			// Cleanup will be handled by ViewModel.dispose()
			viewModel.disconnect();
		};
	}, [session.agentId, viewModel]);

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
			// Switch agent via ViewModel
			viewModel.switchAgent(newActiveAgentId);
		}
	}, [settings.activeAgentId, messages.length, session.agentId, viewModel]);

	// Auto-scroll when messages change
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			window.setTimeout(() => {
				scrollToBottom();
			}, 0);
		}
	}, [messages, isAtBottom]);

	// Set up scroll event listener
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;

		const handleScroll = () => {
			checkIfAtBottom();
		};

		view.registerDomEvent(container, "scroll", handleScroll);

		// Initial check
		checkIfAtBottom();
	}, []);

	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue]);

	useEffect(() => {
		if (sendButtonRef.current) {
			// Set icon based on sending state
			const iconName = isSending ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [isSending]);

	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [inputValue, isSending]);

	// Show auto-mention notes
	useEffect(() => {
		const updateActiveNote = async () => {
			const activeNote = await vaultAccessAdapter.getActiveNote();
			if (activeNote) {
				setLastActiveNote(activeNote);
			}
		};

		updateActiveNote();

		const handleActiveLeafChange = () => {
			updateActiveNote();
		};

		view.registerEvent(
			plugin.app.workspace.on(
				"active-leaf-change",
				handleActiveLeafChange,
			),
		);
	}, [vaultAccessAdapter]);

	const updateIconColor = (svg: SVGElement) => {
		// Remove all state classes
		svg.classList.remove("icon-sending", "icon-active", "icon-inactive");

		if (isSending) {
			// Stop button - always active when sending
			svg.classList.add("icon-sending");
		} else {
			// Send button - active when has input
			const hasInput = inputValue.trim() !== "";
			svg.classList.add(hasInput ? "icon-active" : "icon-inactive");
		}
	};

	const createNewSession = async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] Already a new session");
			return;
		}

		logger.log("[Debug] Creating new session via ViewModel...");
		setInputValue("");
		viewModel.toggleAutoMention(false);
		await viewModel.restartSession();
	};

	const handleStopGeneration = async () => {
		logger.log("Cancelling current operation...");
		await viewModel.cancelCurrentOperation();
	};

	const handleSendMessage = async () => {
		if (!inputValue.trim() || isSendingFromVM) return;

		// Save input value before clearing
		const messageToSend = inputValue;

		// Clear input immediately (before sending)
		setInputValue("");
		setIsAtBottom(true);

		// Send message via ViewModel
		await viewModel.sendMessage(messageToSend, {
			activeNote: lastActiveNote,
			vaultBasePath:
				(plugin.app.vault.adapter as VaultAdapterWithBasePath)
					.basePath || "",
			isAutoMentionDisabled: isAutoMentionTemporarilyDisabled,
		});

		// Scroll after sending
		window.setTimeout(() => {
			scrollToBottom();
		}, 0);
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		// Handle mention dropdown navigation first
		if (showMentionDropdown) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				viewModel.navigateMentionDropdown("down");
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				viewModel.navigateMentionDropdown("up");
				return;
			}
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				const selectedSuggestion =
					mentionSuggestions[selectedMentionIndex];
				if (selectedSuggestion) {
					selectMention(selectedSuggestion);
				}
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				viewModel.closeMentionDropdown();
				return;
			}
		}

		// Normal input handling
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			// Only send if send button would not be disabled (same condition as button)
			const buttonDisabled =
				!isSending && (inputValue.trim() === "" || !isSessionReady);
			if (!buttonDisabled && !isSending) {
				handleSendMessage();
			}
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		const cursorPosition = e.target.selectionStart || 0;

		logger.log(
			"[DEBUG] Input changed:",
			newValue,
			"cursor:",
			cursorPosition,
		);

		setInputValue(newValue);

		// Update mention suggestions via ViewModel
		viewModel.updateMentionSuggestions(newValue, cursorPosition);
	};

	const handleExportChat = async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] No messages to export");
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const filePath = await exporter.exportToMarkdown(
				messages,
				activeAgentLabel,
				session.agentId,
				session.sessionId || "unknown",
			);
			new Notice(`[Agent Client] Chat exported to ${filePath}`);
		} catch (error) {
			new Notice("[Agent Client] Failed to export chat");
			logger.error("Export error:", error);
		}
	};

	return (
		<div className="chat-view-container">
			<div className="chat-view-header">
				<h3 className="chat-view-header-title">{activeAgentLabel}</h3>
				{isUpdateAvailable && (
					<p className="chat-view-header-update">Update available!</p>
				)}
				<div className="chat-view-header-actions">
					<HeaderButton
						iconName="plus"
						tooltip="New chat"
						onClick={createNewSession}
					/>
					<HeaderButton
						iconName="save"
						tooltip="Export chat to Markdown"
						onClick={handleExportChat}
					/>
					<HeaderButton
						iconName="settings"
						tooltip="Settings"
						onClick={() => {
							// Open plugin settings
							const appWithSettings =
								plugin.app as unknown as AppWithSettings;
							appWithSettings.setting.open();
							appWithSettings.setting.openTabById(
								plugin.manifest.id,
							);
						}}
					/>
				</div>
			</div>

			<div ref={messagesContainerRef} className="chat-view-messages">
				{errorInfo ? (
					<div className="chat-error-container">
						<h4 className="chat-error-title">{errorInfo.title}</h4>
						<p className="chat-error-message">
							{errorInfo.message}
						</p>
						{errorInfo.suggestion && (
							<p className="chat-error-suggestion">
								💡 {errorInfo.suggestion}
							</p>
						)}
						<button
							onClick={() => viewModel.clearError()}
							className="chat-error-button"
						>
							OK
						</button>
					</div>
				) : messages.length === 0 ? (
					<div className="chat-empty-state">
						{!isSessionReady
							? `Connecting to ${activeAgentLabel}...`
							: `Start a conversation with ${activeAgentLabel}...`}
					</div>
				) : (
					<>
						{messages.map((message) => (
							<MessageRenderer
								key={message.id}
								message={message}
								plugin={plugin}
								acpClient={acpClientRef.current || undefined}
								handlePermissionUseCase={
									handlePermissionUseCase
								}
							/>
						))}
						{isSending && (
							<div className="loading-indicator">
								<div className="loading-dots">
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
									<div className="loading-dot"></div>
								</div>
							</div>
						)}
					</>
				)}
			</div>

			<div className="chat-input-container">
				<div className="chat-input-wrapper">
					{/* Mention Dropdown - overlay positioned */}
					{(() => {
						logger.log("[DEBUG] Dropdown render check:", {
							showMentionDropdown,
							suggestionsCount: mentionSuggestions.length,
							selectedIndex: selectedMentionIndex,
						});
						return null;
					})()}
					{showMentionDropdown && (
						<MentionDropdown
							files={mentionSuggestions}
							selectedIndex={selectedMentionIndex}
							onSelect={selectMention}
							onClose={() => viewModel.closeMentionDropdown()}
							plugin={plugin}
							view={view}
						/>
					)}
					{settings.autoMentionActiveNote && lastActiveNote && (
						<div className="auto-mention-inline">
							<span
								className={`mention-badge ${isAutoMentionTemporarilyDisabled ? "disabled" : ""}`}
							>
								@{lastActiveNote.name}
							</span>
							<button
								className="auto-mention-toggle-btn"
								onClick={(e) => {
									const newDisabledState =
										!isAutoMentionTemporarilyDisabled;
									viewModel.toggleAutoMention(
										newDisabledState,
									);
									const iconName = newDisabledState
										? "x"
										: "plus";
									setIcon(e.currentTarget, iconName);
								}}
								title={
									isAutoMentionTemporarilyDisabled
										? "Enable auto-mention"
										: "Temporarily disable auto-mention"
								}
								ref={(el) => {
									if (el) {
										const iconName =
											isAutoMentionTemporarilyDisabled
												? "plus"
												: "x";
										setIcon(el, iconName);
									}
								}}
							/>
						</div>
					)}
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyPress}
						placeholder={`Message ${activeAgentLabel} - @ to mention notes`}
						className={`chat-input-textarea ${settings.autoMentionActiveNote && lastActiveNote ? "has-auto-mention" : ""}`}
						rows={1}
					/>
					<button
						ref={sendButtonRef}
						onClick={
							isSending ? handleStopGeneration : handleSendMessage
						}
						disabled={
							!isSending &&
							(inputValue.trim() === "" || !isSessionReady)
						}
						className={`chat-send-button ${isSending ? "sending" : ""} ${!isSending && (inputValue.trim() === "" || !isSessionReady) ? "disabled" : ""}`}
						title={
							!isSessionReady
								? "Connecting..."
								: isSending
									? "Stop generation"
									: "Send message"
						}
					></button>
				</div>
			</div>
		</div>
	);
}

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
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

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatComponent plugin={this.plugin} view={this} />);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
