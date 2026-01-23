import * as React from "react";
const { useRef, useState, useEffect, useCallback, useMemo } = React;
import { setIcon, DropdownComponent, Notice } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import type { NoteMetadata } from "../../domain/ports/vault-access.port";
import type {
	SlashCommand,
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { ImagePromptContent } from "../../domain/models/prompt-content";
import type { UseMentionsReturn } from "../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../hooks/useSlashCommands";
import type { UseAutoMentionReturn } from "../../hooks/useAutoMention";
import { SuggestionDropdown } from "./SuggestionDropdown";
import { ErrorOverlay } from "./ErrorOverlay";
import { ImagePreviewStrip, type AttachedImage } from "./ImagePreviewStrip";
import { Logger } from "../../shared/logger";
import type { ErrorInfo } from "../../domain/models/agent-error";
import { useSettings } from "../../hooks/useSettings";

// ============================================================================
// Image Constants
// ============================================================================

/** Maximum image size in MB */
const MAX_IMAGE_SIZE_MB = 5;

/** Maximum image size in bytes */
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** Maximum number of images per message */
const MAX_IMAGE_COUNT = 10;

/** Supported image MIME types (whitelist) */
const SUPPORTED_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
] as const;

type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/**
 * Props for ChatInput component
 */
export interface ChatInputProps {
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Whether a session is being restored (load/resume/fork) */
	isRestoringSession: boolean;
	/** Display name of the active agent */
	agentLabel: string;
	/** Available slash commands */
	availableCommands: SlashCommand[];
	/** Whether auto-mention setting is enabled */
	autoMentionEnabled: boolean;
	/** Message to restore (e.g., after cancellation) */
	restoredMessage: string | null;
	/** Mentions hook state and methods */
	mentions: UseMentionsReturn;
	/** Slash commands hook state and methods */
	slashCommands: UseSlashCommandsReturn;
	/** Auto-mention hook state and methods */
	autoMention: UseAutoMentionReturn;
	/** Plugin instance */
	plugin: AgentClientPlugin;
	/** View instance for event registration */
	view: ChatView;
	/** Callback to send a message with optional images */
	onSendMessage: (
		content: string,
		images?: ImagePromptContent[],
	) => Promise<void>;
	/** Callback to stop the current generation */
	onStopGeneration: () => Promise<void>;
	/** Callback when restored message has been consumed */
	onRestoredMessageConsumed: () => void;
	/** Session mode state (available modes and current mode) */
	modes?: SessionModeState;
	/** Callback when mode is changed */
	onModeChange?: (modeId: string) => void;
	/** Session model state (available models and current model) - experimental */
	models?: SessionModelState;
	/** Callback when model is changed */
	onModelChange?: (modelId: string) => void;
	/** Whether the agent supports image attachments */
	supportsImages?: boolean;
	/** Current agent ID (used to clear images on agent switch) */
	agentId: string;
	// Controlled component props (for broadcast commands)
	/** Current input text value */
	inputValue: string;
	/** Callback when input text changes */
	onInputChange: (value: string) => void;
	/** Currently attached images */
	attachedImages: AttachedImage[];
	/** Callback when attached images change */
	onAttachedImagesChange: (images: AttachedImage[]) => void;
	/** Error information to display as overlay */
	errorInfo: ErrorInfo | null;
	/** Callback to clear the error */
	onClearError: () => void;
}

/**
 * Input component for the chat view.
 *
 * Handles:
 * - Text input with auto-resize
 * - Mention dropdown (@-mentions)
 * - Slash command dropdown (/-commands)
 * - Auto-mention badge
 * - Hint overlay for slash commands
 * - Send/stop button
 * - Keyboard navigation
 */
export function ChatInput({
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	availableCommands,
	autoMentionEnabled,
	restoredMessage,
	mentions,
	slashCommands,
	autoMention,
	plugin,
	view,
	onSendMessage,
	onStopGeneration,
	onRestoredMessageConsumed,
	modes,
	onModeChange,
	models,
	onModelChange,
	supportsImages = false,
	agentId,
	// Controlled component props
	inputValue,
	onInputChange,
	attachedImages,
	onAttachedImagesChange,
	// Error overlay props
	errorInfo,
	onClearError,
}: ChatInputProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);
	const settings = useSettings(plugin);
	const showEmojis = plugin.settings.displaySettings.showEmojis;

	// Unofficial Obsidian API: app.vault.getConfig() is not in the public type definitions
	// but is widely used by the plugin community for accessing editor settings.
	/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
	const obsidianSpellcheck: boolean =
		(plugin.app.vault as any).getConfig("spellcheck") ?? true;
	/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

	// Local state (hint and command are still local - not needed for broadcast)
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");
	const [isDraggingOver, setIsDraggingOver] = useState(false);

	// Refs
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const dragCounterRef = useRef(0);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const modeDropdownRef = useRef<HTMLDivElement>(null);
	const modeDropdownInstance = useRef<DropdownComponent | null>(null);
	const modelDropdownRef = useRef<HTMLDivElement>(null);
	const modelDropdownInstance = useRef<DropdownComponent | null>(null);

	// Clear attached images when agent changes
	useEffect(() => {
		onAttachedImagesChange([]);
	}, [agentId, onAttachedImagesChange]);

	/**
	 * Add an image to the attached images list.
	 * Simple addition - validation is done in handlePaste.
	 */
	const addImage = useCallback(
		(image: AttachedImage) => {
			// Safety check for max count
			if (attachedImages.length >= MAX_IMAGE_COUNT) {
				return;
			}
			onAttachedImagesChange([...attachedImages, image]);
		},
		[attachedImages, onAttachedImagesChange],
	);

	/**
	 * Remove an image from the attached images list.
	 */
	const removeImage = useCallback(
		(id: string) => {
			onAttachedImagesChange(
				attachedImages.filter((img) => img.id !== id),
			);
		},
		[attachedImages, onAttachedImagesChange],
	);

	/**
	 * Convert a File to Base64 string.
	 */
	const fileToBase64 = useCallback(async (file: File): Promise<string> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// Extract base64 part from "data:image/png;base64,..."
				const base64 = result.split(",")[1];
				resolve(base64);
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}, []);

	/**
	 * Process and attach image files.
	 * Common logic for paste and drop handlers.
	 */
	const processImageFiles = useCallback(
		async (files: File[]) => {
			let addedCount = 0;

			for (const file of files) {
				// Check image count
				if (attachedImages.length + addedCount >= MAX_IMAGE_COUNT) {
					new Notice(
						`[Agent Client] Maximum ${MAX_IMAGE_COUNT} images allowed`,
					);
					break;
				}

				// Check file size (before conversion - memory efficiency)
				if (file.size > MAX_IMAGE_SIZE_BYTES) {
					new Notice(
						`[Agent Client] Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`,
					);
					continue;
				}

				// Convert to Base64 and add
				try {
					const base64 = await fileToBase64(file);
					addImage({
						id: crypto.randomUUID(),
						data: base64,
						mimeType: file.type,
					});
					addedCount++;
				} catch (error) {
					console.error("Failed to convert image:", error);
					new Notice("[Agent Client] Failed to attach image");
				}
			}
		},
		[attachedImages.length, addImage, fileToBase64],
	);

	/**
	 * Handle paste event for image attachment.
	 */
	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			// Extract image files from clipboard
			const imageFiles: File[] = [];
			for (const item of Array.from(items)) {
				if (
					SUPPORTED_IMAGE_TYPES.includes(
						item.type as SupportedImageType,
					)
				) {
					const file = item.getAsFile();
					if (file) imageFiles.push(file);
				}
			}

			if (imageFiles.length === 0) return;

			e.preventDefault();

			if (!supportsImages) {
				new Notice(
					"[Agent Client] This agent does not support image attachments",
				);
				return;
			}

			await processImageFiles(imageFiles);
		},
		[supportsImages, processImageFiles],
	);

	/**
	 * Handle drag over event to allow drop.
	 */
	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	/**
	 * Handle drag enter event for visual feedback.
	 * Uses counter to handle child element enter/leave correctly.
	 */
	const handleDragEnter = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			dragCounterRef.current++;
			if (dragCounterRef.current === 1) {
				setIsDraggingOver(true);
			}
		}
	}, []);

	/**
	 * Handle drag leave event to reset visual feedback.
	 */
	const handleDragLeave = useCallback((e: React.DragEvent) => {
		dragCounterRef.current--;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	/**
	 * Handle drop event for image files.
	 */
	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;

			// Filter to supported image types
			const imageFiles = Array.from(files).filter((file) =>
				SUPPORTED_IMAGE_TYPES.includes(file.type as SupportedImageType),
			);

			if (imageFiles.length === 0) return;

			e.preventDefault();

			if (!supportsImages) {
				new Notice(
					"[Agent Client] This agent does not support image attachments",
				);
				return;
			}

			await processImageFiles(imageFiles);
		},
		[supportsImages, processImageFiles],
	);

	/**
	 * Common logic for setting cursor position after text replacement.
	 */
	const setTextAndFocus = useCallback(
		(newText: string) => {
			onInputChange(newText);

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
		},
		[onInputChange],
	);

	/**
	 * Handle mention selection from dropdown.
	 */
	const selectMention = useCallback(
		(suggestion: NoteMetadata) => {
			const newText = mentions.selectSuggestion(inputValue, suggestion);
			setTextAndFocus(newText);
		},
		[mentions, inputValue, setTextAndFocus],
	);

	/**
	 * Handle slash command selection from dropdown.
	 */
	const handleSelectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const newText = slashCommands.selectSuggestion(inputValue, command);
			onInputChange(newText);

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
		[slashCommands, inputValue, onInputChange],
	);

	/**
	 * Adjust textarea height based on content.
	 */
	const adjustTextareaHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			// Remove previous dynamic height classes
			textarea.classList.remove(
				"agent-client-textarea-auto-height",
				"agent-client-textarea-expanded",
			);

			// Temporarily use auto to measure
			textarea.classList.add("agent-client-textarea-auto-height");
			const scrollHeight = textarea.scrollHeight;
			const minHeight = 80;
			const maxHeight = 300;

			// Calculate height
			const calculatedHeight = Math.max(
				minHeight,
				Math.min(scrollHeight, maxHeight),
			);

			// Apply expanded class if needed
			if (calculatedHeight > minHeight) {
				textarea.classList.add("agent-client-textarea-expanded");
				// Set CSS variable for dynamic height
				textarea.style.setProperty(
					"--textarea-height",
					`${calculatedHeight}px`,
				);
			} else {
				textarea.style.removeProperty("--textarea-height");
			}

			textarea.classList.remove("agent-client-textarea-auto-height");
		}
	}, []);

	/**
	 * Update send button icon color based on state.
	 */
	const updateIconColor = useCallback(
		(svg: SVGElement) => {
			// Remove all state classes
			svg.classList.remove(
				"agent-client-icon-sending",
				"agent-client-icon-active",
				"agent-client-icon-inactive",
			);

			if (isSending) {
				// Stop button - always active when sending
				svg.classList.add("agent-client-icon-sending");
			} else {
				// Send button - active when has input (text or images)
				const hasContent =
					inputValue.trim() !== "" || attachedImages.length > 0;
				svg.classList.add(
					hasContent
						? "agent-client-icon-active"
						: "agent-client-icon-inactive",
				);
			}
		},
		[isSending, inputValue, attachedImages.length],
	);

	/**
	 * Handle sending or stopping based on current state.
	 */
	const handleSendOrStop = useCallback(async () => {
		if (isSending) {
			await onStopGeneration();
			return;
		}

		// Allow sending if there's text OR images
		if (!inputValue.trim() && attachedImages.length === 0) return;

		// Save input value and images before clearing
		const messageToSend = inputValue.trim();
		const imagesToSend: ImagePromptContent[] = attachedImages.map(
			(img) => ({
				type: "image",
				data: img.data,
				mimeType: img.mimeType,
			}),
		);

		// Clear input, images, and hint state immediately
		onInputChange("");
		onAttachedImagesChange([]);
		setHintText(null);
		setCommandText("");

		await onSendMessage(
			messageToSend,
			imagesToSend.length > 0 ? imagesToSend : undefined,
		);
	}, [
		isSending,
		inputValue,
		attachedImages,
		onSendMessage,
		onStopGeneration,
		onInputChange,
		onAttachedImagesChange,
	]);

	/**
	 * Handle dropdown keyboard navigation.
	 */
	const handleDropdownKeyPress = useCallback(
		(e: React.KeyboardEvent): boolean => {
			const isSlashCommandActive = slashCommands.isOpen;
			const isMentionActive = mentions.isOpen;

			if (!isSlashCommandActive && !isMentionActive) {
				return false;
			}

			// Arrow navigation
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("down");
				} else {
					mentions.navigate("down");
				}
				return true;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isSlashCommandActive) {
					slashCommands.navigate("up");
				} else {
					mentions.navigate("up");
				}
				return true;
			}

			// Select item (Enter or Tab)
			if (e.key === "Enter" || e.key === "Tab") {
				// Skip Enter during IME composition (allow Tab to still work)
				if (e.key === "Enter" && e.nativeEvent.isComposing) {
					return false;
				}
				e.preventDefault();
				if (isSlashCommandActive) {
					const selectedCommand =
						slashCommands.suggestions[slashCommands.selectedIndex];
					if (selectedCommand) {
						handleSelectSlashCommand(selectedCommand);
					}
				} else {
					const selectedSuggestion =
						mentions.suggestions[mentions.selectedIndex];
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
					slashCommands.close();
				} else {
					mentions.close();
				}
				return true;
			}

			return false;
		},
		[slashCommands, mentions, handleSelectSlashCommand, selectMention],
	);

	// Button disabled state - also allow sending if images are attached
	const isButtonDisabled =
		!isSending &&
		((inputValue.trim() === "" && attachedImages.length === 0) ||
			!isSessionReady ||
			isRestoringSession);

	/**
	 * Handle keyboard events in the textarea.
	 */
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			// Handle dropdown navigation first
			if (handleDropdownKeyPress(e)) {
				return;
			}

			// Normal input handling - check if should send based on shortcut setting
			if (e.key === "Enter" && !e.nativeEvent.isComposing) {
				const shouldSend =
					settings.sendMessageShortcut === "enter"
						? !e.shiftKey // Enter mode: send unless Shift is pressed
						: e.metaKey || e.ctrlKey; // Cmd+Enter mode: send only with Cmd/Ctrl

				if (shouldSend) {
					e.preventDefault();
					if (!isButtonDisabled && !isSending) {
						void handleSendOrStop();
					}
				}
				// If not shouldSend, allow default behavior (newline)
			}
		},
		[
			handleDropdownKeyPress,
			isSending,
			isButtonDisabled,
			handleSendOrStop,
			settings.sendMessageShortcut,
		],
	);

	/**
	 * Handle input changes in the textarea.
	 */
	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPosition = e.target.selectionStart || 0;

			logger.log(
				"[DEBUG] Input changed:",
				newValue,
				"cursor:",
				cursorPosition,
			);

			onInputChange(newValue);

			// Hide hint overlay when user modifies the input
			if (hintText) {
				const expectedText = commandText + hintText;
				if (newValue !== expectedText) {
					setHintText(null);
					setCommandText("");
				}
			}

			// Update mention suggestions
			void mentions.updateSuggestions(newValue, cursorPosition);

			// Update slash command suggestions
			slashCommands.updateSuggestions(newValue, cursorPosition);
		},
		[logger, hintText, commandText, mentions, slashCommands, onInputChange],
	);

	// Adjust textarea height when input changes
	useEffect(() => {
		adjustTextareaHeight();
	}, [inputValue, adjustTextareaHeight]);

	// Update send button icon based on sending state
	useEffect(() => {
		if (sendButtonRef.current) {
			const iconName = isSending ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [isSending, updateIconColor]);

	// Update icon color when input or attached images change
	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [inputValue, attachedImages.length, updateIconColor]);

	// Auto-focus textarea on mount
	useEffect(() => {
		window.setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
			}
		}, 0);
	}, []);

	// Restore message when provided (e.g., after cancellation)
	// Only restore if input is empty to avoid overwriting user's new input
	useEffect(() => {
		if (restoredMessage) {
			if (!inputValue.trim()) {
				onInputChange(restoredMessage);
				// Focus and place cursor at end
				window.setTimeout(() => {
					if (textareaRef.current) {
						textareaRef.current.focus();
						textareaRef.current.selectionStart =
							restoredMessage.length;
						textareaRef.current.selectionEnd =
							restoredMessage.length;
					}
				}, 0);
			}
			onRestoredMessageConsumed();
		}
	}, [restoredMessage, onRestoredMessageConsumed, inputValue, onInputChange]);

	// Stable references for callbacks
	const onModeChangeRef = useRef(onModeChange);
	onModeChangeRef.current = onModeChange;

	// Initialize Mode dropdown (only when availableModes change)
	const availableModes = modes?.availableModes;
	const currentModeId = modes?.currentModeId;

	useEffect(() => {
		const containerEl = modeDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple modes
		if (!availableModes || availableModes.length <= 1) {
			// Clean up existing dropdown if modes become unavailable
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modeDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modeDropdownInstance.current = dropdown;

			// Add options
			for (const mode of availableModes) {
				dropdown.addOption(mode.id, mode.name);
			}

			// Set initial value
			if (currentModeId) {
				dropdown.setValue(currentModeId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModeChangeRef.current) {
					onModeChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModes change
		return () => {
			if (modeDropdownInstance.current) {
				containerEl.empty();
				modeDropdownInstance.current = null;
			}
		};
	}, [availableModes]);

	// Update dropdown value when currentModeId changes (separate effect)
	useEffect(() => {
		if (modeDropdownInstance.current && currentModeId) {
			modeDropdownInstance.current.setValue(currentModeId);
		}
	}, [currentModeId]);

	// Stable references for model callbacks
	const onModelChangeRef = useRef(onModelChange);
	onModelChangeRef.current = onModelChange;

	// Initialize Model dropdown (only when availableModels change)
	const availableModels = models?.availableModels;
	const currentModelId = models?.currentModelId;

	useEffect(() => {
		const containerEl = modelDropdownRef.current;
		if (!containerEl) return;

		// Only show dropdown if there are multiple models
		if (!availableModels || availableModels.length <= 1) {
			// Clean up existing dropdown if models become unavailable
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
			return;
		}

		// Create dropdown if not exists
		if (!modelDropdownInstance.current) {
			const dropdown = new DropdownComponent(containerEl);
			modelDropdownInstance.current = dropdown;

			// Add options
			for (const model of availableModels) {
				dropdown.addOption(model.modelId, model.name);
			}

			// Set initial value
			if (currentModelId) {
				dropdown.setValue(currentModelId);
			}

			// Handle change - use ref to avoid recreating dropdown on callback change
			dropdown.onChange((value) => {
				if (onModelChangeRef.current) {
					onModelChangeRef.current(value);
				}
			});
		}

		// Cleanup on unmount or when availableModels change
		return () => {
			if (modelDropdownInstance.current) {
				containerEl.empty();
				modelDropdownInstance.current = null;
			}
		};
	}, [availableModels]);

	// Update dropdown value when currentModelId changes (separate effect)
	useEffect(() => {
		if (modelDropdownInstance.current && currentModelId) {
			modelDropdownInstance.current.setValue(currentModelId);
		}
	}, [currentModelId]);

	// Placeholder text
	const placeholder = `Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}`;

	return (
		<div className="agent-client-chat-input-container">
			{/* Error Overlay - displayed above input */}
			{errorInfo && (
				<ErrorOverlay
					errorInfo={errorInfo}
					onClose={onClearError}
					showEmojis={showEmojis}
					view={view}
				/>
			)}

			{/* Mention Dropdown */}
			{mentions.isOpen && (
				<SuggestionDropdown
					type="mention"
					items={mentions.suggestions}
					selectedIndex={mentions.selectedIndex}
					onSelect={selectMention}
					onClose={mentions.close}
					plugin={plugin}
					view={view}
				/>
			)}

			{/* Slash Command Dropdown */}
			{slashCommands.isOpen && (
				<SuggestionDropdown
					type="slash-command"
					items={slashCommands.suggestions}
					selectedIndex={slashCommands.selectedIndex}
					onSelect={handleSelectSlashCommand}
					onClose={slashCommands.close}
					plugin={plugin}
					view={view}
				/>
			)}

			{/* Input Box - flexbox container with border */}
			<div
				className={`agent-client-chat-input-box ${isDraggingOver ? "agent-client-dragging-over" : ""}`}
				onDragOver={handleDragOver}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDrop={(e) => void handleDrop(e)}
			>
				{/* Auto-mention Badge */}
				{autoMentionEnabled && autoMention.activeNote && (
					<div className="agent-client-auto-mention-inline">
						<span
							className={`agent-client-mention-badge ${autoMention.isDisabled ? "agent-client-disabled" : ""}`}
						>
							@{autoMention.activeNote.name}
							{autoMention.activeNote.selection && (
								<span className="agent-client-selection-indicator">
									{":"}
									{autoMention.activeNote.selection.from
										.line + 1}
									-
									{autoMention.activeNote.selection.to.line +
										1}
								</span>
							)}
						</span>
						<button
							className="agent-client-auto-mention-toggle-btn"
							onClick={(e) => {
								const newDisabledState =
									!autoMention.isDisabled;
								autoMention.toggle(newDisabledState);
								const iconName = newDisabledState
									? "x"
									: "plus";
								setIcon(e.currentTarget, iconName);
							}}
							title={
								autoMention.isDisabled
									? "Enable auto-mention"
									: "Temporarily disable auto-mention"
							}
							ref={(el) => {
								if (el) {
									const iconName = autoMention.isDisabled
										? "plus"
										: "x";
									setIcon(el, iconName);
								}
							}}
						/>
					</div>
				)}

				{/* Textarea with Hint Overlay */}
				<div className="agent-client-textarea-wrapper">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyDown}
						onPaste={(e) => void handlePaste(e)}
						placeholder={placeholder}
						className={`agent-client-chat-input-textarea ${autoMentionEnabled && autoMention.activeNote ? "has-auto-mention" : ""}`}
						rows={1}
						spellCheck={obsidianSpellcheck}
					/>
					{hintText && (
						<div
							className="agent-client-hint-overlay"
							aria-hidden="true"
						>
							<span className="agent-client-invisible">
								{commandText}
							</span>
							<span className="agent-client-hint-text">
								{hintText}
							</span>
						</div>
					)}
				</div>

				{/* Image Preview Strip (only shown when agent supports images) */}
				{supportsImages && (
					<ImagePreviewStrip
						images={attachedImages}
						onRemove={removeImage}
					/>
				)}

				{/* Input Actions (Mode Selector + Model Selector + Send Button) */}
				<div className="agent-client-chat-input-actions">
					{/* Mode Selector */}
					{modes && modes.availableModes.length > 1 && (
						<div
							className="agent-client-mode-selector"
							title={
								modes.availableModes.find(
									(m) => m.id === modes.currentModeId,
								)?.description ?? "Select mode"
							}
						>
							<div ref={modeDropdownRef} />
							<span
								className="agent-client-mode-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Model Selector (experimental) */}
					{models && models.availableModels.length > 1 && (
						<div
							className="agent-client-model-selector"
							title={
								models.availableModels.find(
									(m) => m.modelId === models.currentModelId,
								)?.description ?? "Select model"
							}
						>
							<div ref={modelDropdownRef} />
							<span
								className="agent-client-model-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Send/Stop Button */}
					<button
						ref={sendButtonRef}
						onClick={() => void handleSendOrStop()}
						disabled={isButtonDisabled}
						className={`agent-client-chat-send-button ${isSending ? "sending" : ""} ${isButtonDisabled ? "agent-client-disabled" : ""}`}
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
