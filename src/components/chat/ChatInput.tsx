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
import { ImagePreviewStrip, type AttachedImage } from "./ImagePreviewStrip";
import { Logger } from "../../shared/logger";
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
}: ChatInputProps) {
	const logger = useMemo(() => new Logger(plugin), [plugin]);
	const settings = useSettings(plugin);

	// Local state
	const [inputValue, setInputValue] = useState("");
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");
	const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

	// Refs
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const modeDropdownRef = useRef<HTMLDivElement>(null);
	const modeDropdownInstance = useRef<DropdownComponent | null>(null);
	const modelDropdownRef = useRef<HTMLDivElement>(null);
	const modelDropdownInstance = useRef<DropdownComponent | null>(null);

	// Clear attached images when agent changes
	useEffect(() => {
		setAttachedImages([]);
	}, [agentId]);

	/**
	 * Add an image to the attached images list.
	 * Simple addition - validation is done in handlePaste.
	 */
	const addImage = useCallback((image: AttachedImage) => {
		setAttachedImages((prev) => {
			// Safety check for race conditions
			if (prev.length >= MAX_IMAGE_COUNT) {
				return prev;
			}
			return [...prev, image];
		});
	}, []);

	/**
	 * Remove an image from the attached images list.
	 */
	const removeImage = useCallback((id: string) => {
		setAttachedImages((prev) => prev.filter((img) => img.id !== id));
	}, []);

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
	 * Handle paste event for image attachment.
	 *
	 * v3 design:
	 * - Check file size before Base64 conversion (memory efficiency)
	 * - Use MIME type whitelist (security)
	 * - Track added count locally for multiple image paste
	 */
	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			// Check if clipboard contains any images
			const hasImages = Array.from(items).some((item) =>
				SUPPORTED_IMAGE_TYPES.includes(item.type as SupportedImageType),
			);

			// Show notice if agent doesn't support images but user tried to paste one
			if (hasImages && !supportsImages) {
				new Notice(
					"[Agent Client] This agent does not support image attachments",
				);
				return;
			}

			if (!supportsImages) return;

			// Track added count for multiple image paste
			let addedCount = 0;

			// Convert DataTransferItemList to array for iteration
			const itemsArray = Array.from(items);

			for (const item of itemsArray) {
				// Step 1: Check MIME type whitelist
				if (
					!SUPPORTED_IMAGE_TYPES.includes(
						item.type as SupportedImageType,
					)
				) {
					continue;
				}

				e.preventDefault();

				const file = item.getAsFile();
				if (!file) continue;

				// Step 2: Check image count (before conversion)
				if (attachedImages.length + addedCount >= MAX_IMAGE_COUNT) {
					new Notice(
						`[Agent Client] Maximum ${MAX_IMAGE_COUNT} images allowed`,
					);
					break;
				}

				// Step 3: Check file size (before conversion - key v3 improvement)
				if (file.size > MAX_IMAGE_SIZE_BYTES) {
					new Notice(
						`[Agent Client] Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`,
					);
					continue;
				}

				// Step 4: Convert to Base64 after validation passes
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
		[supportsImages, attachedImages.length, addImage, fileToBase64],
	);

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
		[slashCommands, inputValue],
	);

	/**
	 * Adjust textarea height based on content.
	 */
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
			const minHeight = 80;
			const maxHeight = 300;

			// Calculate height
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

	/**
	 * Update send button icon color based on state.
	 */
	const updateIconColor = useCallback(
		(svg: SVGElement) => {
			// Remove all state classes
			svg.classList.remove(
				"icon-sending",
				"icon-active",
				"icon-inactive",
			);

			if (isSending) {
				// Stop button - always active when sending
				svg.classList.add("icon-sending");
			} else {
				// Send button - active when has input
				const hasInput = inputValue.trim() !== "";
				svg.classList.add(hasInput ? "icon-active" : "icon-inactive");
			}
		},
		[isSending, inputValue],
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
		const messageToSend = inputValue;
		const imagesToSend: ImagePromptContent[] = attachedImages.map(
			(img) => ({
				type: "image",
				data: img.data,
				mimeType: img.mimeType,
			}),
		);

		// Clear input, images, and hint state immediately
		setInputValue("");
		setAttachedImages([]);
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
					const buttonDisabled =
						!isSending &&
						(inputValue.trim() === "" || !isSessionReady);
					if (!buttonDisabled && !isSending) {
						void handleSendOrStop();
					}
				}
				// If not shouldSend, allow default behavior (newline)
			}
		},
		[
			handleDropdownKeyPress,
			isSending,
			inputValue,
			isSessionReady,
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

			setInputValue(newValue);

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
		[logger, hintText, commandText, mentions, slashCommands],
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

	// Update icon color when input changes
	useEffect(() => {
		if (sendButtonRef.current) {
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				updateIconColor(svg);
			}
		}
	}, [inputValue, updateIconColor]);

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
				setInputValue(restoredMessage);
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
	}, [restoredMessage, onRestoredMessageConsumed, inputValue]);

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

	// Button disabled state - also allow sending if images are attached
	const isButtonDisabled =
		!isSending &&
		((inputValue.trim() === "" && attachedImages.length === 0) ||
			!isSessionReady);

	// Placeholder text
	const placeholder = `Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}`;

	return (
		<div className="chat-input-container">
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
			<div className="chat-input-box">
				{/* Auto-mention Badge */}
				{autoMentionEnabled && autoMention.activeNote && (
					<div className="auto-mention-inline">
						<span
							className={`mention-badge ${autoMention.isDisabled ? "disabled" : ""}`}
						>
							@{autoMention.activeNote.name}
							{autoMention.activeNote.selection && (
								<span className="selection-indicator">
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
							className="auto-mention-toggle-btn"
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
				<div className="textarea-wrapper">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyDown}
						onPaste={(e) => void handlePaste(e)}
						placeholder={placeholder}
						className={`chat-input-textarea ${autoMentionEnabled && autoMention.activeNote ? "has-auto-mention" : ""}`}
						rows={1}
					/>
					{hintText && (
						<div className="hint-overlay" aria-hidden="true">
							<span className="invisible">{commandText}</span>
							<span className="hint-text">{hintText}</span>
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
				<div className="chat-input-actions">
					{/* Mode Selector */}
					{modes && modes.availableModes.length > 1 && (
						<div
							ref={modeDropdownRef}
							className="mode-selector"
							title={
								modes.availableModes.find(
									(m) => m.id === modes.currentModeId,
								)?.description ?? "Select mode"
							}
						>
							<span
								className="mode-selector-icon"
								ref={(el) => {
									if (el) setIcon(el, "chevron-down");
								}}
							/>
						</div>
					)}

					{/* Model Selector (experimental) */}
					{models && models.availableModels.length > 1 && (
						<div
							ref={modelDropdownRef}
							className="model-selector"
							title={
								models.availableModels.find(
									(m) => m.modelId === models.currentModelId,
								)?.description ?? "Select model"
							}
						>
							<span
								className="model-selector-icon"
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
						className={`chat-send-button ${isSending ? "sending" : ""} ${isButtonDisabled ? "disabled" : ""}`}
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
