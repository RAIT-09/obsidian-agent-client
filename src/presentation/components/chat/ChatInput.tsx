/**
 * ChatInput Component
 *
 * Input area with textarea, dropdowns, auto-mention badge, and send button.
 */

import * as React from "react";
const { useState, useRef, useEffect, useCallback } = React;
import { setIcon } from "obsidian";
import type AgentClientPlugin from "../../../infrastructure/obsidian-plugin/plugin";
import type { NoteMetadata, SlashCommand } from "../../../types";
import { SuggestionDropdown } from "./SuggestionDropdown";
import { Logger } from "../../../utils/logger";

// Re-export ChatView type for SuggestionDropdown
import type { ChatView } from "../../views/chat/ChatView";

interface ChatInputProps {
	/** Plugin instance */
	plugin: AgentClientPlugin;

	/** ChatView instance for dropdown positioning */
	view: ChatView;

	/** Active agent display name */
	agentLabel: string;

	/** Whether the agent is currently sending */
	isSending: boolean;

	/** Whether the session is ready */
	isSessionReady: boolean;

	/** Available slash commands */
	availableCommands: SlashCommand[];

	/** Auto-mention settings */
	autoMentionEnabled: boolean;
	lastActiveNote: NoteMetadata | null;
	isAutoMentionDisabled: boolean;
	onToggleAutoMention: (disabled: boolean) => void;

	/** Mention dropdown state */
	showMentionDropdown: boolean;
	mentionSuggestions: NoteMetadata[];
	selectedMentionIndex: number;
	onSelectMention: (suggestion: NoteMetadata) => void;
	onCloseMentionDropdown: () => void;
	onNavigateMention: (direction: "up" | "down") => void;
	onUpdateMentionSuggestions: (input: string, cursor: number) => void;

	/** Slash command dropdown state */
	showSlashCommandDropdown: boolean;
	slashCommandSuggestions: SlashCommand[];
	selectedSlashCommandIndex: number;
	onSelectSlashCommand: (command: SlashCommand) => void;
	onCloseSlashCommandDropdown: () => void;
	onNavigateSlashCommand: (direction: "up" | "down") => void;
	onUpdateSlashCommandSuggestions: (input: string, cursor: number) => void;

	/** Actions */
	onSendMessage: (message: string) => void;
	onStopGeneration: () => void;
}

export function ChatInput({
	plugin,
	view,
	agentLabel,
	isSending,
	isSessionReady,
	availableCommands,
	autoMentionEnabled,
	lastActiveNote,
	isAutoMentionDisabled,
	onToggleAutoMention,
	showMentionDropdown,
	mentionSuggestions,
	selectedMentionIndex,
	onSelectMention,
	onCloseMentionDropdown,
	onNavigateMention,
	onUpdateMentionSuggestions,
	showSlashCommandDropdown,
	slashCommandSuggestions,
	selectedSlashCommandIndex,
	onSelectSlashCommand,
	onCloseSlashCommandDropdown,
	onNavigateSlashCommand,
	onUpdateSlashCommandSuggestions,
	onSendMessage,
	onStopGeneration,
}: ChatInputProps) {
	const logger = new Logger(plugin);
	const [inputValue, setInputValue] = useState("");
	const [hintText, setHintText] = useState<string | null>(null);
	const [commandText, setCommandText] = useState<string>("");

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const sendButtonRef = useRef<HTMLButtonElement>(null);

	// Auto-focus textarea on mount
	useEffect(() => {
		window.setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
			}
		}, 0);
	}, []);

	// Adjust textarea height
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;

		textarea.classList.remove("textarea-auto-height", "textarea-expanded");
		textarea.classList.add("textarea-auto-height");

		const scrollHeight = textarea.scrollHeight;
		const maxHeight = 300;
		const hasAutoMention = textarea.classList.contains("has-auto-mention");
		const minHeight = hasAutoMention ? 116 : 80;
		const calculatedHeight = Math.max(
			minHeight,
			Math.min(scrollHeight, maxHeight),
		);

		if (calculatedHeight > minHeight) {
			textarea.classList.add("textarea-expanded");
			textarea.style.setProperty(
				"--textarea-height",
				`${calculatedHeight}px`,
			);
		} else {
			textarea.style.removeProperty("--textarea-height");
		}

		textarea.classList.remove("textarea-auto-height");
	}, [inputValue]);

	// Update send button icon
	useEffect(() => {
		if (sendButtonRef.current) {
			const iconName = isSending ? "square" : "send-horizontal";
			setIcon(sendButtonRef.current, iconName);
			const svg = sendButtonRef.current.querySelector("svg");
			if (svg) {
				svg.classList.remove(
					"icon-sending",
					"icon-active",
					"icon-inactive",
				);
				if (isSending) {
					svg.classList.add("icon-sending");
				} else {
					const hasInput = inputValue.trim() !== "";
					svg.classList.add(
						hasInput ? "icon-active" : "icon-inactive",
					);
				}
			}
		}
	}, [isSending, inputValue]);

	const handleSelectMention = useCallback(
		(suggestion: NoteMetadata) => {
			onSelectMention(suggestion);
			// Focus will be handled by parent
		},
		[onSelectMention],
	);

	const handleSelectSlashCommand = useCallback(
		(command: SlashCommand) => {
			const newText = `/${command.name} `;
			setInputValue(newText);

			if (command.hint) {
				setCommandText(newText);
				setHintText(command.hint);
			} else {
				setHintText(null);
				setCommandText("");
			}

			onSelectSlashCommand(command);

			window.setTimeout(() => {
				const textarea = textareaRef.current;
				if (textarea) {
					const cursorPos = command.hint
						? newText.length
						: newText.length;
					textarea.selectionStart = cursorPos;
					textarea.selectionEnd = cursorPos;
					textarea.focus();
				}
			}, 0);
		},
		[onSelectSlashCommand],
	);

	const handleDropdownKeyPress = useCallback(
		(e: React.KeyboardEvent): boolean => {
			const isSlashCommandActive = showSlashCommandDropdown;
			const isMentionActive = showMentionDropdown;

			if (!isSlashCommandActive && !isMentionActive) {
				return false;
			}

			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (isSlashCommandActive) {
					onNavigateSlashCommand("down");
				} else {
					onNavigateMention("down");
				}
				return true;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				if (isSlashCommandActive) {
					onNavigateSlashCommand("up");
				} else {
					onNavigateMention("up");
				}
				return true;
			}

			if (e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				if (isSlashCommandActive) {
					const selected =
						slashCommandSuggestions[selectedSlashCommandIndex];
					if (selected) handleSelectSlashCommand(selected);
				} else {
					const selected = mentionSuggestions[selectedMentionIndex];
					if (selected) handleSelectMention(selected);
				}
				return true;
			}

			if (e.key === "Escape") {
				e.preventDefault();
				if (isSlashCommandActive) {
					onCloseSlashCommandDropdown();
				} else {
					onCloseMentionDropdown();
				}
				return true;
			}

			return false;
		},
		[
			showSlashCommandDropdown,
			showMentionDropdown,
			slashCommandSuggestions,
			selectedSlashCommandIndex,
			mentionSuggestions,
			selectedMentionIndex,
			onNavigateSlashCommand,
			onNavigateMention,
			onCloseSlashCommandDropdown,
			onCloseMentionDropdown,
			handleSelectSlashCommand,
			handleSelectMention,
		],
	);

	const handleKeyPress = useCallback(
		(e: React.KeyboardEvent) => {
			if (handleDropdownKeyPress(e)) {
				return;
			}

			if (
				e.key === "Enter" &&
				!e.shiftKey &&
				!e.nativeEvent.isComposing
			) {
				e.preventDefault();
				const buttonDisabled =
					!isSending && (inputValue.trim() === "" || !isSessionReady);
				if (!buttonDisabled && !isSending) {
					onSendMessage(inputValue);
					setInputValue("");
					setHintText(null);
					setCommandText("");
				}
			}
		},
		[
			handleDropdownKeyPress,
			isSending,
			inputValue,
			isSessionReady,
			onSendMessage,
		],
	);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value;
			const cursorPosition = e.target.selectionStart || 0;

			setInputValue(newValue);

			if (hintText) {
				const expectedText = commandText + hintText;
				if (newValue !== expectedText) {
					setHintText(null);
					setCommandText("");
				}
			}

			onUpdateMentionSuggestions(newValue, cursorPosition);
			onUpdateSlashCommandSuggestions(newValue, cursorPosition);
		},
		[
			hintText,
			commandText,
			onUpdateMentionSuggestions,
			onUpdateSlashCommandSuggestions,
		],
	);

	const handleSendClick = useCallback(() => {
		if (isSending) {
			onStopGeneration();
		} else {
			onSendMessage(inputValue);
			setInputValue("");
			setHintText(null);
			setCommandText("");
		}
	}, [isSending, inputValue, onSendMessage, onStopGeneration]);

	const buttonDisabled =
		!isSending && (inputValue.trim() === "" || !isSessionReady);

	return (
		<div className="chat-input-container">
			<div className="chat-input-wrapper">
				{showMentionDropdown && (
					<SuggestionDropdown
						type="mention"
						items={mentionSuggestions}
						selectedIndex={selectedMentionIndex}
						onSelect={handleSelectMention}
						onClose={onCloseMentionDropdown}
						plugin={plugin}
						view={view}
					/>
				)}
				{showSlashCommandDropdown && (
					<SuggestionDropdown
						type="slash-command"
						items={slashCommandSuggestions}
						selectedIndex={selectedSlashCommandIndex}
						onSelect={handleSelectSlashCommand}
						onClose={onCloseSlashCommandDropdown}
						plugin={plugin}
						view={view}
					/>
				)}
				{autoMentionEnabled && lastActiveNote && (
					<div className="auto-mention-inline">
						<span
							className={`mention-badge ${isAutoMentionDisabled ? "disabled" : ""}`}
						>
							@{lastActiveNote.name}
							{lastActiveNote.selection && (
								<span className="selection-indicator">
									{":"}
									{lastActiveNote.selection.from.line + 1}-
									{lastActiveNote.selection.to.line + 1}
								</span>
							)}
						</span>
						<button
							className="auto-mention-toggle-btn"
							onClick={(e) => {
								const newState = !isAutoMentionDisabled;
								onToggleAutoMention(newState);
								const iconName = newState ? "plus" : "x";
								setIcon(e.currentTarget, iconName);
							}}
							title={
								isAutoMentionDisabled
									? "Enable auto-mention"
									: "Temporarily disable auto-mention"
							}
							ref={(el) => {
								if (el) {
									const iconName = isAutoMentionDisabled
										? "plus"
										: "x";
									setIcon(el, iconName);
								}
							}}
						/>
					</div>
				)}
				<div className="textarea-wrapper">
					<textarea
						ref={textareaRef}
						value={inputValue}
						onChange={handleInputChange}
						onKeyDown={handleKeyPress}
						placeholder={`Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}`}
						className={`chat-input-textarea ${autoMentionEnabled && lastActiveNote ? "has-auto-mention" : ""}`}
						rows={1}
					/>
					{hintText && (
						<div className="hint-overlay" aria-hidden="true">
							<span className="invisible">{commandText}</span>
							<span className="hint-text">{hintText}</span>
						</div>
					)}
				</div>
				<button
					ref={sendButtonRef}
					onClick={handleSendClick}
					disabled={buttonDisabled}
					className={`chat-send-button ${isSending ? "sending" : ""} ${buttonDisabled ? "disabled" : ""}`}
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
	);
}
