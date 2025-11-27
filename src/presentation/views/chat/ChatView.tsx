import { ItemView, WorkspaceLeaf, setIcon, Platform, Notice } from "obsidian";
import type { EventRef } from "obsidian";
import * as React from "react";
const {
	useState,
	useRef,
	useEffect,
	useSyncExternalStore,
	useMemo,
	useCallback,
} = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";

// Component imports
import { SuggestionDropdown } from "../../components/chat/SuggestionDropdown";
import { MessageRenderer } from "../../components/chat/MessageRenderer";
import { VirtualMessageList } from "../../components/chat/VirtualMessageList";
import { SessionHistoryPanel } from "../../components/chat/SessionHistoryPanel";
import { HeaderButton } from "../../components/shared/HeaderButton";
import { TabBar, type TabId } from "../../components/shared/TabBar";
import { TerminalPanel } from "../../components/terminal";
import { SettingsPanel } from "../../components/settings";
import { PtyManager } from "../../../infrastructure/pty";
import { ClaudeConfigService } from "../../../adapters/claude-config";

// Service imports
import { NoteMentionService } from "../../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../../shared/logger";
import { ChatExporter } from "../../../shared/chat-exporter";

// Type imports
import type { NoteMetadata } from "../../../core/domain/ports/vault-access.port";
import type { SlashCommand } from "../../../core/domain/models/chat-session";

// Adapter imports
import { AcpAdapter, type IAcpClient } from "../../../adapters/acp/acp.adapter";
import { ObsidianVaultAdapter } from "../../../adapters/obsidian/vault.adapter";
import { IndexedDBAdapter } from "../../../adapters/persistence/indexed-db.adapter";

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

/**
 * Represents an image pasted into the chat input.
 */
export interface PastedImage {
	id: string;
	data: string; // Base64 encoded image data (without data URI prefix)
	mimeType: string;
	previewUrl: string; // Data URI for preview display
}

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
		plugin
			.checkForUpdates()
			.then(setIsUpdateAvailable)
			.catch((error) => {
				console.error("Failed to check for updates:", error);
			});
	}, [plugin]);

	const [inputValue, setInputValue] = useState("");
	const [lastActiveNote, setLastActiveNote] = useState<NoteMetadata | null>(
		null,
	);
	// Hint overlay state for slash commands
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");
	// Pasted images state
	const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const acpClientRef = useRef<IAcpClient | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	// Tab state
	const [activeTab, setActiveTab] = useState<TabId>("chat");

	// PTY Manager for terminal
	const ptyManager = useMemo(() => new PtyManager(plugin), [plugin]);
	const [isPythonAvailable, setIsPythonAvailable] = useState(false);

	// Claude config service
	const claudeConfigService = useMemo(
		() => new ClaudeConfigService(plugin),
		[plugin],
	);
	const [settingsDirty, setSettingsDirty] = useState(false);

	// Detect Python on mount
	useEffect(() => {
		ptyManager.warmUp().then(() => {
			ptyManager.isPythonAvailable().then(setIsPythonAvailable);
		});

		return () => {
			ptyManager.dispose();
		};
	}, [ptyManager]);

	// Cleanup config service on unmount
	useEffect(() => {
		return () => {
			claudeConfigService.dispose();
		};
	}, [claudeConfigService]);

	// Listen for tab switch events from commands
	useEffect(() => {
		const handleTabSwitch = (tabId: TabId) => {
			setActiveTab(tabId);
		};

		const workspace = plugin.app.workspace as unknown as {
			on: (event: string, callback: (tabId: TabId) => void) => EventRef;
		};

		const eventRef = workspace.on(
			"agent-client:switch-tab",
			handleTabSwitch,
		);

		return () => {
			plugin.app.workspace.offref(eventRef);
		};
	}, [plugin.app.workspace]);

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

	// Create IndexedDB persistence adapter
	const persistenceAdapter = useMemo(() => {
		return new IndexedDBAdapter();
	}, []);

	const updateActiveNote = useCallback(async () => {
		const activeNote = await vaultAccessAdapter.getActiveNote();
		setLastActiveNote(activeNote);
	}, [vaultAccessAdapter]);

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
			persistenceAdapter,
		);
	}, [
		plugin,
		sendMessageUseCase,
		manageSessionUseCase,
		handlePermissionUseCase,
		switchAgentUseCase,
		vaultAccessAdapter,
		vaultPath,
		persistenceAdapter,
	]);

	// Store ViewModel reference in ChatView for cleanup on close
	useEffect(() => {
		view.viewModel = viewModel;
		return () => {
			view.viewModel = null;
		};
	}, [view, viewModel]);

	// Set AcpAdapter callbacks to ViewModel methods
	// This connects the adapter's message updates to the ViewModel's state management
	useEffect(() => {
		acpAdapter.setMessageCallbacks(
			viewModel.addMessage,
			viewModel.updateLastMessage,
			viewModel.updateMessage,
			viewModel.updateAvailableCommands,
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

	// Slash command dropdown state from ViewModel
	const showSlashCommandDropdown = vmState.showSlashCommandDropdown;
	const slashCommandSuggestions = vmState.slashCommandSuggestions;
	const selectedSlashCommandIndex = vmState.selectedSlashCommandIndex;

	// Session history state from ViewModel
	const showSessionHistory = vmState.showSessionHistory;

	// Helper to check if agent is currently processing a request
	const isSending = isSendingFromVM; // Use ViewModel state

	// Helper to check if session is ready for user input
	const isSessionReady = session.state === "ready";

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

	// Auto-scroll functions
	const checkIfAtBottom = useCallback(() => {
		const container = messagesContainerRef.current;
		if (!container) return true;

		const threshold = 50;
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	}, []);

	const scrollToBottom = useCallback(() => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	/**
	 * Common logic for setting cursor position after text replacement.
	 */
	const setTextAndFocus = useCallback((newText: string) => {
		setInputValue(newText);

		// Set cursor position to end of text
		window.setTimeout(() => {
			const textarea = textareaRef.current;
			if (textarea) {
				const cursorPos = newText.length;
				textarea.selectionStart = cursorPos;
				textarea.selectionEnd = cursorPos;
				textarea.focus();
			}
		}, 0);
	}, []);

	// Mention handling - delegate to ViewModel
	const selectMention = useCallback(
		(suggestion: NoteMetadata) => {
			const newText = viewModel.selectMention(inputValue, suggestion);
			setTextAndFocus(newText);
		},
		[viewModel, inputValue, setTextAndFocus],
	);

	// Slash command handling - delegate to ViewModel
	const selectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const newText = viewModel.selectSlashCommand(inputValue, command);
			setInputValue(newText);

			// Setup hint overlay if command has hint
			if (command.hint) {
				const cmdText = `/${command.name} `;
				setCommandText(cmdText);
				setHintText(command.hint);
			} else {
				// No hint - clear hint state
				setHintText(null);
				setCommandText("");
			}

			// Place cursor right after command name (before hint text)
			window.setTimeout(() => {
				const textarea = textareaRef.current;
				if (textarea) {
					const cursorPos = command.hint
						? `/${command.name} `.length
						: newText.length;
					textarea.selectionStart = cursorPos;
					textarea.selectionEnd = cursorPos;
					textarea.focus();
				}
			}, 0);
		},
		[viewModel, inputValue],
	);

	const adjustTextareaHeight = useCallback(() => {
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
	}, []);

	// Initialize session on mount or when agent changes
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via ViewModel...");
		viewModel.createNewSession();

		// Note: No cleanup here - disconnect() during agent switching would kill
		// the new process. Final cleanup is handled by dispose() on unmount.
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

	// Auto-focus textarea on mount
	useEffect(() => {
		window.setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
			}
		}, 0);
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
	}, [inputValue, isSending, pastedImages]);

	// Show auto-mention notes and track selection
	useEffect(() => {
		let isMounted = true;

		const refreshActiveNote = async () => {
			if (!isMounted) return;
			await updateActiveNote();
		};

		const unsubscribe = vaultAccessAdapter.subscribeSelectionChanges(() => {
			void refreshActiveNote();
		});

		void refreshActiveNote();

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [updateActiveNote, vaultAccessAdapter]);

	const updateIconColor = (svg: SVGElement) => {
		// Remove all state classes
		svg.classList.remove("icon-sending", "icon-active", "icon-inactive");

		if (isSending) {
			// Stop button - always active when sending
			svg.classList.add("icon-sending");
		} else {
			// Send button - active when has input (text or images)
			const hasContent = inputValue.trim() !== "" || pastedImages.length > 0;
			svg.classList.add(hasContent ? "icon-active" : "icon-inactive");
		}
	};

	const createNewSession = useCallback(async () => {
		if (messages.length === 0) {
			new Notice("[Agent Client] Already a new session");
			return;
		}

		logger.log("[Debug] Creating new session via ViewModel...");
		setInputValue("");
		viewModel.toggleAutoMention(false);
		await viewModel.restartSession();
	}, [messages.length, logger, viewModel]);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		// Get last user message before cancel (to restore it)
		const lastMessage = viewModel.getSnapshot().lastUserMessage;
		await viewModel.cancelCurrentOperation();

		// Restore the last user message to input field
		if (lastMessage) {
			setInputValue(lastMessage);
		}
	}, [logger, viewModel]);

	const handleSendMessage = useCallback(async () => {
		// Allow sending if there's text OR images
		const hasContent = inputValue.trim() !== "" || pastedImages.length > 0;
		if (!hasContent || isSendingFromVM) return;

		// Save input value and images before clearing
		const messageToSend = inputValue;
		const imagesToSend = [...pastedImages];

		// Clear input, hint state, and images immediately (before sending)
		setInputValue("");
		setHintText(null);
		setCommandText("");
		setPastedImages([]);
		setIsAtBottom(true);

		// Send message via ViewModel with images
		await viewModel.sendMessage(messageToSend, {
			activeNote: lastActiveNote,
			vaultBasePath:
				(plugin.app.vault.adapter as VaultAdapterWithBasePath)
					.basePath || "",
			isAutoMentionDisabled: isAutoMentionTemporarilyDisabled,
			images: imagesToSend.map((img) => ({
				data: img.data,
				mimeType: img.mimeType,
			})),
		});

		// Scroll after sending
		window.setTimeout(() => {
			scrollToBottom();
		}, 0);
	}, [
		inputValue,
		pastedImages,
		isSendingFromVM,
		viewModel,
		lastActiveNote,
		plugin.app.vault.adapter,
		isAutoMentionTemporarilyDisabled,
		scrollToBottom,
	]);

	/**
	 * Handle dropdown keyboard navigation.
	 * Common logic for both mention and slash command dropdowns.
	 */
	const handleDropdownKeyPress = useCallback(
		(e: React.KeyboardEvent): boolean => {
			// Check which dropdown is active
			const isSlashCommandActive = showSlashCommandDropdown;
			const isMentionActive = showMentionDropdown;

			if (!isSlashCommandActive && !isMentionActive) {
				return false; // No dropdown active
			}

			// Arrow navigation
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isSlashCommandActive) {
					viewModel.navigateSlashCommandDropdown("down");
				} else {
					viewModel.navigateMentionDropdown("down");
				}
				return true;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isSlashCommandActive) {
					viewModel.navigateSlashCommandDropdown("up");
				} else {
					viewModel.navigateMentionDropdown("up");
				}
				return true;
			}

			// Select item (Enter or Tab)
			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				if (isSlashCommandActive) {
					const selectedCommand =
						slashCommandSuggestions[selectedSlashCommandIndex];
					if (selectedCommand) {
						selectSlashCommand(selectedCommand);
					}
				} else {
					const selectedSuggestion =
						mentionSuggestions[selectedMentionIndex];
					if (selectedSuggestion) {
						selectMention(selectedSuggestion);
					}
				}
				return true;
			}

			// Close dropdown (Escape)
			if (e.key === "Escape") {
				e.preventDefault();
				if (isSlashCommandActive) {
					viewModel.closeSlashCommandDropdown();
				} else {
					viewModel.closeMentionDropdown();
				}
				return true;
			}

			return false;
		},
		[
			showSlashCommandDropdown,
			showMentionDropdown,
			viewModel,
			slashCommandSuggestions,
			selectedSlashCommandIndex,
			selectSlashCommand,
			mentionSuggestions,
			selectedMentionIndex,
			selectMention,
		],
	);

	const handleKeyPress = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle dropdown navigation first (both mention and slash command)
			if (handleDropdownKeyPress(e)) {
				return; // Handled by dropdown
			}

			// Normal input handling
			if (
				e.key === "Enter" &&
				!e.shiftKey &&
				!e.nativeEvent.isComposing
			) {
				e.preventDefault();
				// Only send if send button would not be disabled (same condition as button)
				const hasContent = inputValue.trim() !== "" || pastedImages.length > 0;
				const buttonDisabled = !isSending && (!hasContent || !isSessionReady);
				if (!buttonDisabled && !isSending) {
					handleSendMessage();
				}
			}
		},
		[
			handleDropdownKeyPress,
			isSending,
			inputValue,
			pastedImages,
			isSessionReady,
			handleSendMessage,
		],
	);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPosition = e.target.selectionStart || 0;

			setInputValue(newValue);

			// Hide hint overlay when user modifies the input
			// (hint should only show right after command selection)
			if (hintText) {
				// Check if user changed the hint text
				const expectedText = commandText + hintText;
				if (newValue !== expectedText) {
					setHintText(null);
					setCommandText("");
				}
			}

			// Update mention suggestions via ViewModel
			viewModel.updateMentionSuggestions(newValue, cursorPosition);

			// Update slash command suggestions via ViewModel
			viewModel.updateSlashCommandSuggestions(newValue, cursorPosition);
		},
		[hintText, commandText, viewModel],
	);

	/**
	 * Handle paste events to extract images from clipboard.
	 */
	const handlePaste = useCallback(
		(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			const imageItems: DataTransferItem[] = [];
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item.type.startsWith("image/")) {
					imageItems.push(item);
				}
			}

			// If no images, let default paste behavior handle it (text)
			if (imageItems.length === 0) return;

			// Prevent default paste behavior for images
			e.preventDefault();

			// Process each image
			for (const item of imageItems) {
				const file = item.getAsFile();
				if (!file) continue;

				const reader = new FileReader();
				reader.onload = (event) => {
					const result = event.target?.result;
					if (typeof result !== "string") return;

					// result is a data URI: "data:image/png;base64,..."
					const [prefix, base64Data] = result.split(",");
					const mimeType = prefix.split(":")[1]?.split(";")[0] || "image/png";

					const newImage: PastedImage = {
						id: crypto.randomUUID(),
						data: base64Data,
						mimeType,
						previewUrl: result,
					};

					setPastedImages((prev) => [...prev, newImage]);
				};
				reader.readAsDataURL(file);
			}
		},
		[],
	);

	/**
	 * Remove a pasted image from the preview.
	 */
	const removePastedImage = useCallback((imageId: string) => {
		setPastedImages((prev) => prev.filter((img) => img.id !== imageId));
	}, []);

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
	}, [messages, plugin, session, logger]);

	const openSettings = useCallback(() => {
		// Open plugin settings
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const openInNewPane = useCallback(() => {
		plugin.openInNewPane();
	}, [plugin]);

	const closeMentionDropdown = useCallback(() => {
		viewModel.closeMentionDropdown();
	}, [viewModel]);

	const closeSlashCommandDropdown = useCallback(() => {
		viewModel.closeSlashCommandDropdown();
	}, [viewModel]);

	// Session history handlers
	const handleOpenHistory = useCallback(() => {
		viewModel.openSessionHistory();
	}, [viewModel]);

	const handleCloseHistory = useCallback(() => {
		viewModel.closeSessionHistory();
	}, [viewModel]);

	const handleSelectSession = useCallback(async (sessionId: string) => {
		await viewModel.restoreFromHistory(sessionId);
	}, [viewModel]);

	// Get session history use case for the panel
	const sessionHistoryUseCase = viewModel.getSessionHistoryUseCase();

	return (
		<div className="chat-view-container">
			<TabBar
				activeTab={activeTab}
				onTabChange={setActiveTab}
				terminalStatus={ptyManager.status}
				settingsDirty={settingsDirty}
			/>

			{activeTab === "chat" && (
				<>
					<div className="chat-view-header">
						<h3 className="chat-view-header-title">
							{activeAgentLabel}
						</h3>
						{isUpdateAvailable && (
							<p className="chat-view-header-update">
								Update available!
							</p>
						)}
						<div className="chat-view-header-actions">
							<HeaderButton
								iconName="plus"
								tooltip="New chat"
								onClick={createNewSession}
							/>
							{sessionHistoryUseCase && (
								<HeaderButton
									iconName="history"
									tooltip="Session history"
									onClick={handleOpenHistory}
								/>
							)}
							<HeaderButton
								iconName="save"
								tooltip="Export chat to Markdown"
								onClick={handleExportChat}
							/>
							<HeaderButton
								iconName="split-square-horizontal"
								tooltip="Open in new pane"
								onClick={openInNewPane}
							/>
							<HeaderButton
								iconName="settings"
								tooltip="Settings"
								onClick={openSettings}
							/>
						</div>
					</div>

					<div
						ref={messagesContainerRef}
						className="chat-view-messages"
					>
						{errorInfo ? (
							<div
								className="chat-error-container"
								role="alert"
								aria-live="assertive"
							>
								<h4 className="chat-error-title">
									{errorInfo.title}
								</h4>
								<p className="chat-error-message">
									{errorInfo.message}
								</p>
								{errorInfo.suggestion && (
									<p className="chat-error-suggestion">
										<span aria-hidden="true">
											&#128161;
										</span>
										<span className="sr-only">
											Suggestion:
										</span>{" "}
										{errorInfo.suggestion}
									</p>
								)}
								<button
									type="button"
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
							<VirtualMessageList
								messages={messages}
								plugin={plugin}
								acpClient={acpClientRef.current || undefined}
								handlePermissionUseCase={
									handlePermissionUseCase
								}
								containerRef={messagesContainerRef}
								isAtBottom={isAtBottom}
								onScrollChange={setIsAtBottom}
								isSending={isSending}
							/>
						)}
					</div>

					<div className="chat-input-container">
						<div className="chat-input-wrapper">
							{/* Mention Dropdown - overlay positioned */}
							{showMentionDropdown && (
								<SuggestionDropdown
									type="mention"
									items={mentionSuggestions}
									selectedIndex={selectedMentionIndex}
									onSelect={selectMention}
									onClose={closeMentionDropdown}
									plugin={plugin}
									view={view}
									searchQuery={inputValue}
								/>
							)}
							{showSlashCommandDropdown && (
								<SuggestionDropdown
									type="slash-command"
									items={slashCommandSuggestions}
									selectedIndex={selectedSlashCommandIndex}
									onSelect={selectSlashCommand}
									onClose={closeSlashCommandDropdown}
									plugin={plugin}
									view={view}
									searchQuery={inputValue}
								/>
							)}
							{settings.autoMentionActiveNote &&
								lastActiveNote && (
									<div className="auto-mention-inline">
										<span
											className={`mention-badge ${isAutoMentionTemporarilyDisabled ? "disabled" : ""}`}
										>
											@{lastActiveNote.name}
											{lastActiveNote.selection && (
												<span className="selection-indicator">
													{":"}
													{lastActiveNote.selection
														.from.line + 1}
													-
													{lastActiveNote.selection
														.to.line + 1}
												</span>
											)}
										</span>
										<button
											type="button"
											className="auto-mention-toggle-btn"
											onClick={(e) => {
												const newDisabledState =
													!isAutoMentionTemporarilyDisabled;
												viewModel.toggleAutoMention(
													newDisabledState,
												);
												const iconName =
													newDisabledState
														? "x"
														: "plus";
												setIcon(
													e.currentTarget,
													iconName,
												);
											}}
											title={
												isAutoMentionTemporarilyDisabled
													? "Enable auto-mention"
													: "Temporarily disable auto-mention"
											}
											aria-label={
												isAutoMentionTemporarilyDisabled
													? "Enable auto-mention"
													: "Temporarily disable auto-mention"
											}
											aria-pressed={
												!isAutoMentionTemporarilyDisabled
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
							{/* Image Preview - shown above textarea when images are pasted */}
							{pastedImages.length > 0 && (
								<div
									className="pasted-images-preview"
									role="list"
									aria-label="Pasted images"
								>
									{pastedImages.map((img) => (
										<div
											key={img.id}
											className="pasted-image-item"
											role="listitem"
										>
											<img
												src={img.previewUrl}
												alt="Pasted image preview"
												className="pasted-image-thumbnail"
											/>
											<button
												type="button"
												className="pasted-image-remove"
												onClick={() =>
													removePastedImage(img.id)
												}
												title="Remove image"
												aria-label="Remove image"
												ref={(el) => {
													if (el) {
														setIcon(el, "x");
													}
												}}
											/>
										</div>
									))}
								</div>
							)}
							<div className="textarea-wrapper">
								<textarea
									ref={textareaRef}
									value={inputValue}
									onChange={handleInputChange}
									onKeyDown={handleKeyPress}
									onPaste={handlePaste}
									placeholder={`Message ${activeAgentLabel} - @ to mention notes${session.availableCommands && session.availableCommands.length > 0 ? ", / for commands" : ""}`}
									className={`chat-input-textarea ${settings.autoMentionActiveNote && lastActiveNote ? "has-auto-mention" : ""} ${pastedImages.length > 0 ? "has-images" : ""}`}
									rows={1}
								/>
								{hintText && (
									<div
										className="hint-overlay"
										aria-hidden="true"
									>
										<span className="invisible">
											{commandText}
										</span>
										<span className="hint-text">
											{hintText}
										</span>
									</div>
								)}
							</div>
							<button
								ref={sendButtonRef}
								type="button"
								onClick={
									isSending
										? handleStopGeneration
										: handleSendMessage
								}
								disabled={
									!isSending &&
									((inputValue.trim() === "" &&
										pastedImages.length === 0) ||
										!isSessionReady)
								}
								className={`chat-send-button ${isSending ? "sending" : ""} ${!isSending && ((inputValue.trim() === "" && pastedImages.length === 0) || !isSessionReady) ? "disabled" : ""}`}
								title={
									!isSessionReady
										? "Connecting..."
										: isSending
											? "Stop generation"
											: "Send message"
								}
								aria-label={
									!isSessionReady
										? "Connecting to agent"
										: isSending
											? "Stop generation"
											: "Send message"
								}
							></button>
						</div>
					</div>

					{/* Session History Panel - overlay when open */}
					{showSessionHistory && sessionHistoryUseCase && (
						<SessionHistoryPanel
							historyUseCase={sessionHistoryUseCase}
							onSelectSession={handleSelectSession}
							onClose={handleCloseHistory}
							currentSessionId={session.sessionId}
						/>
					)}
				</>
			)}

			{activeTab === "terminal" && (
				<TerminalPanel
					plugin={plugin}
					ptyManager={ptyManager}
					isActive={activeTab === "terminal"}
					isPythonAvailable={isPythonAvailable}
					claudePath={plugin.settings.claude.command || "claude"}
					workingDirectory={vaultPath}
				/>
			)}

			{activeTab === "settings" && (
				<SettingsPanel
					plugin={plugin}
					configService={claudeConfigService}
					onDirtyChange={setSettingsDirty}
				/>
			)}
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
		this.registerPermissionEvents();
		return Promise.resolve();
	}

	async onClose() {
		this.logger.log("[ChatView] onClose() called");
		// Cleanup ViewModel and disconnect agent before unmounting
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

	private registerPermissionEvents(): void {
		const approveHandler = async () => {
			const viewModel = this.viewModel;
			if (!viewModel) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const success = await viewModel.approveActivePermission();
			if (!success) {
				new Notice("[Agent Client] No active permission request");
			}
		};

		const rejectHandler = async () => {
			const viewModel = this.viewModel;
			if (!viewModel) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const success = await viewModel.rejectActivePermission();
			if (!success) {
				new Notice("[Agent Client] No active permission request");
			}
		};

		const workspace = this.app.workspace as unknown as {
			on: (event: string, callback: () => void) => EventRef;
		};

		const toggleAutoMentionHandler = () => {
			const viewModel = this.viewModel;
			if (!viewModel) {
				new Notice("[Agent Client] Chat view is not ready");
				return;
			}
			const currentState = viewModel.getSnapshot();
			const newState = !currentState.isAutoMentionTemporarilyDisabled;
			viewModel.toggleAutoMention(newState);
		};

		this.registerEvent(
			workspace.on("agent-client:approve-active-permission", () => {
				void approveHandler();
			}),
		);
		this.registerEvent(
			workspace.on("agent-client:reject-active-permission", () => {
				void rejectHandler();
			}),
		);
		this.registerEvent(
			workspace.on("agent-client:toggle-auto-mention", () => {
				toggleAutoMentionHandler();
			}),
		);
	}
}
