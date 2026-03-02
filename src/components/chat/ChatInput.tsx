import * as React from "react";
const { useRef, useEffect, useCallback } = React;
import { setIcon } from "obsidian";

import type AgentClientPlugin from "../../plugin";
import type { IChatViewHost } from "./types";
import type {
	SlashCommand,
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import type { ImagePromptContent } from "../../domain/models/prompt-content";
import type { UseMentionsReturn } from "../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../hooks/useSlashCommands";
import type { UseAutoMentionReturn } from "../../hooks/useAutoMention";
import type { ChatMessage } from "../../domain/models/chat-message";
import type { IVaultAccess } from "../../domain/ports/vault-access.port";
import { UnifiedPickerPanel } from "../picker/UnifiedPickerPanel";
import {
	FilePickerProvider,
	FolderPickerProvider,
} from "../picker/mention-provider";
import { CommandPickerProvider } from "../picker/command-provider";
import { usePicker, type PickerSortFn } from "../../hooks/usePicker";
import type { PickerCategory } from "../picker/types";
import { classifyCommands } from "../../shared/command-classification";
import { ErrorOverlay } from "./ErrorOverlay";
import { ImagePreviewStrip, type AttachedImage } from "./ImagePreviewStrip";
import type { ContextUsage } from "./chat-input/ContextUsageMeter";
import { InputActions, type SendButtonState } from "./chat-input/InputActions";
import {
	RichTextarea,
	type RichTextareaHandle,
} from "./chat-input/RichTextarea";
import { useChatInputBehavior } from "./chat-input/use-chat-input-behavior";
import { useImageAttachments } from "./chat-input/use-image-attachments";
import { useInputHistory } from "../../hooks/useInputHistory";
import type { ErrorInfo } from "../../domain/models/agent-error";
import { useSettings } from "../../hooks/useSettings";
import type { ChatContextReference } from "../../shared/chat-context-token";
import { ContextBadgeStrip, type ContextBadgeItem } from "./ContextBadgeStrip";

export interface ChatInputProps {
	isSending: boolean;
	isSessionReady: boolean;
	isRestoringSession: boolean;
	agentLabel: string;
	availableCommands: SlashCommand[];
	restoredMessage: string | null;
	mentions: UseMentionsReturn;
	slashCommands: UseSlashCommandsReturn;
	autoMention: UseAutoMentionReturn;
	plugin: AgentClientPlugin;
	view: IChatViewHost;
	onSendMessage: (
		content: string,
		images?: ImagePromptContent[],
	) => Promise<void>;
	onStopGeneration: () => Promise<void>;
	onRestoredMessageConsumed: () => void;
	modes?: SessionModeState;
	onModeChange?: (modeId: string) => void;
	models?: SessionModelState;
	onModelChange?: (modelId: string) => void;
	supportsImages?: boolean;
	agentId: string;
	inputValue: string;
	onInputChange: (value: string) => void;
	attachedImages: AttachedImage[];
	onAttachedImagesChange: (images: AttachedImage[]) => void;
	errorInfo: ErrorInfo | null;
	onClearError: () => void;
	messages: ChatMessage[];
	vaultAccess: IVaultAccess;
	contextUsage?: ContextUsage | null;
}

export function ChatInput({
	isSending,
	isSessionReady,
	isRestoringSession,
	agentLabel,
	availableCommands,
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
	inputValue,
	onInputChange,
	attachedImages,
	onAttachedImagesChange,
	errorInfo,
	onClearError,
	messages,
	vaultAccess,
	contextUsage,
}: ChatInputProps) {
	const settings = useSettings(plugin);

	const richTextareaRef = useRef<RichTextareaHandle>(null);

	const fileProvider = React.useMemo(
		() =>
			new FilePickerProvider(vaultAccess, (note) => {
				const ctx = mentions.context;
				if (ctx) {
					richTextareaRef.current?.insertMentionAtContext(
						note.name,
						ctx.start,
						ctx.end,
					);
					mentions.close();
				}
			}),
		[vaultAccess, mentions],
	);

	const folderProvider = React.useMemo(
		() =>
			new FolderPickerProvider(
				() => {
					const seen = new Set<string>();
					for (const f of plugin.app.vault.getAllLoadedFiles()) {
						if ("children" in f && f.path) {
							seen.add(f.path);
						}
					}
					return Array.from(seen).sort();
				},
				(folderPath) => {
					const ctx = mentions.context;
					if (ctx) {
						richTextareaRef.current?.insertMentionAtContext(
							folderPath,
							ctx.start,
							ctx.end,
						);
						mentions.close();
					}
				},
			),
		[plugin.app.vault, mentions],
	);

	const mentionProviders = React.useMemo(
		() => [fileProvider, folderProvider],
		[fileProvider, folderProvider],
	);

	const classified = React.useMemo(
		() => classifyCommands(availableCommands),
		[availableCommands],
	);

	const handleCommandSelect = useCallback(
		(cmd: SlashCommand) => {
			const ctx = slashCommands.context;
			if (ctx) {
				richTextareaRef.current?.insertSlashCommandAtContext(
					cmd.name,
					ctx.start,
					ctx.end,
				);
			} else {
				const token = `@[obsius-slash:${cmd.name}] `;
				onInputChange(token);
				richTextareaRef.current?.setContent(token);
			}
			slashCommands.close();
			richTextareaRef.current?.focus();
		},
		[slashCommands, onInputChange],
	);

	const cmdProvider = React.useMemo(
		() =>
			new CommandPickerProvider({
				category: "command",
				icon: "terminal",
				getCommands: () => classified.commands,
				onSelect: handleCommandSelect,
			}),
		[classified.commands, handleCommandSelect],
	);

	const mcpProvider = React.useMemo(
		() =>
			new CommandPickerProvider({
				category: "mcp",
				icon: "globe",
				getCommands: () => classified.mcp,
				onSelect: handleCommandSelect,
			}),
		[classified.mcp, handleCommandSelect],
	);

	const skillProvider = React.useMemo(
		() =>
			new CommandPickerProvider({
				category: "skill",
				icon: "sparkles",
				getCommands: () => classified.skills,
				onSelect: handleCommandSelect,
			}),
		[classified.skills, handleCommandSelect],
	);

	const commandProviders = React.useMemo(
		() =>
			[cmdProvider, mcpProvider, skillProvider].filter(
				(p) => p.search("").length > 0 || true,
			),
		[cmdProvider, mcpProvider, skillProvider],
	);

	const mentionSort = useCallback<PickerSortFn>((items, q) => {
		if (!q) return items;
		const ql = q.toLowerCase();
		return [...items].sort((a, b) => {
			const al = a.label.toLowerCase();
			const bl = b.label.toLowerCase();
			const aStart = al.startsWith(ql) ? 2 : al.includes(ql) ? 1 : 0;
			const bStart = bl.startsWith(ql) ? 2 : bl.includes(ql) ? 1 : 0;
			if (aStart !== bStart) return bStart - aStart;
			const aFolder = a.category === "folder" ? 1 : 0;
			const bFolder = b.category === "folder" ? 1 : 0;
			if (aFolder !== bFolder) return bFolder - aFolder;
			return al.localeCompare(bl);
		});
	}, []);

	const commandSort = useCallback<PickerSortFn>((items, q) => {
		if (!q) return items;
		const ql = q.toLowerCase();
		return [...items].sort((a, b) => {
			const al = a.label.toLowerCase().replace(/^\//, "");
			const bl = b.label.toLowerCase().replace(/^\//, "");
			const aStart = al.startsWith(ql) ? 2 : al.includes(ql) ? 1 : 0;
			const bStart = bl.startsWith(ql) ? 2 : bl.includes(ql) ? 1 : 0;
			if (aStart !== bStart) return bStart - aStart;
			return al.localeCompare(bl);
		});
	}, []);

	const mentionCategoryEntries = React.useMemo<PickerCategory[]>(
		() => ["file", "folder"],
		[],
	);
	const commandCategoryEntries = React.useMemo<PickerCategory[]>(
		() => ["command", "mcp", "skill"],
		[],
	);

	const mentionPicker = usePicker(
		mentionProviders,
		mentionSort,
		mentionCategoryEntries,
	);
	const commandPicker = usePicker(
		commandProviders,
		commandSort,
		commandCategoryEntries,
	);

	const mentionPickerRef = useRef(mentionPicker);
	mentionPickerRef.current = mentionPicker;
	const commandPickerRef = useRef(commandPicker);
	commandPickerRef.current = commandPicker;
	const mentionsRef = useRef(mentions);
	mentionsRef.current = mentions;
	const slashCommandsRef = useRef(slashCommands);
	slashCommandsRef.current = slashCommands;

	const mentionQuery = mentions.context?.query ?? "";
	const hasMentionContext = mentions.context !== null;
	const prevMentionCtx = useRef(false);
	useEffect(() => {
		const picker = mentionPickerRef.current;
		if (hasMentionContext && !prevMentionCtx.current) {
			picker.open(mentionQuery);
		} else if (hasMentionContext && prevMentionCtx.current) {
			picker.setQuery(mentionQuery);
		} else if (!hasMentionContext && prevMentionCtx.current) {
			picker.close();
		}
		prevMentionCtx.current = hasMentionContext;
	}, [hasMentionContext, mentionQuery]);

	const commandQuery = slashCommands.context?.query ?? "";
	const hasCommandContext = slashCommands.context !== null;
	const prevCommandCtx = useRef(false);
	useEffect(() => {
		const picker = commandPickerRef.current;
		if (hasCommandContext && !prevCommandCtx.current) {
			picker.open(commandQuery);
		} else if (hasCommandContext && prevCommandCtx.current) {
			picker.setQuery(commandQuery);
		} else if (!hasCommandContext && prevCommandCtx.current) {
			picker.close();
		}
		prevCommandCtx.current = hasCommandContext;
	}, [hasCommandContext, commandQuery]);

	const mentionPickerOpen = mentionPicker.isOpen;
	const prevMentionPickerOpen = useRef(false);
	useEffect(() => {
		if (!mentionPickerOpen && prevMentionPickerOpen.current) {
			mentionsRef.current.close();
			richTextareaRef.current?.focus();
		}
		prevMentionPickerOpen.current = mentionPickerOpen;
	}, [mentionPickerOpen]);

	const commandPickerOpen = commandPicker.isOpen;
	const prevCommandPickerOpen = useRef(false);
	useEffect(() => {
		if (!commandPickerOpen && prevCommandPickerOpen.current) {
			slashCommandsRef.current.close();
			richTextareaRef.current?.focus();
		}
		prevCommandPickerOpen.current = commandPickerOpen;
	}, [commandPickerOpen]);

	/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
	const obsidianSpellcheck: boolean =
		(plugin.app.vault as any).getConfig("spellcheck") ?? true;
	/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

	const historyInputChange = useCallback(
		(value: string) => {
			onInputChange(value);
			richTextareaRef.current?.setContent(value);
		},
		[onInputChange],
	);

	const { handleHistoryKeyDown, resetHistory } = useInputHistory(
		messages,
		historyInputChange,
		inputValue,
	);

	const sendButtonRef = useRef<HTMLButtonElement>(null);
	const {
		isDraggingOver,
		removeImage,
		handlePaste,
		handleDragOver,
		handleDragEnter,
		handleDragLeave,
		handleDrop,
	} = useImageAttachments({
		supportsImages,
		attachedImages,
		onAttachedImagesChange,
	});

	useEffect(() => {
		onAttachedImagesChange([]);
	}, [agentId, onAttachedImagesChange]);

	const sendButtonState: SendButtonState = isSending
		? "sending"
		: isSessionReady &&
				!isRestoringSession &&
				(inputValue.trim() !== "" || attachedImages.length > 0)
			? "ready"
			: "disabled";

	const handleSendOrStop = useCallback(async () => {
		if (isSending) {
			await onStopGeneration();
			return;
		}

		if (!inputValue.trim() && attachedImages.length === 0) return;

		const messageToSend = inputValue.trim();
		const imagesToSend: ImagePromptContent[] = attachedImages.map((img) => ({
			type: "image",
			data: img.data,
			mimeType: img.mimeType,
		}));

		onInputChange("");
		richTextareaRef.current?.clear();
		onAttachedImagesChange([]);
		setHintText(null);
		setCommandText("");
		resetHistory();

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
		resetHistory,
	]);

	const isButtonDisabled =
		!isSending &&
		((inputValue.trim() === "" && attachedImages.length === 0) ||
			!isSessionReady ||
			isRestoringSession);

	const {
		hintText,
		commandText,
		handleRichInput,
		handleKeyDown,
		setHintText,
		setCommandText,
	} = useChatInputBehavior({
		mentions,
		slashCommands,
		mentionPicker,
		commandPicker,
		inputValue,
		onInputChange,
		richTextareaRef,
		handleHistoryKeyDown,
		sendMessageShortcut: settings.sendMessageShortcut,
		isSending,
		isButtonDisabled,
		handleSendOrStop,
	});

	useEffect(() => {
		if (sendButtonRef.current) {
			const iconMap: Record<SendButtonState, string> = {
				sending: "square",
				ready: "arrow-up",
				disabled: "arrow-up",
			};
			setIcon(sendButtonRef.current, iconMap[sendButtonState]);
		}
	}, [sendButtonState]);

	useEffect(() => {
		window.setTimeout(() => {
			richTextareaRef.current?.focus();
		}, 0);
	}, []);

	useEffect(() => {
		if (restoredMessage) {
			if (!inputValue.trim()) {
				onInputChange(restoredMessage);
				richTextareaRef.current?.setContent(restoredMessage);
				window.setTimeout(() => {
					richTextareaRef.current?.focus();
				}, 0);
			}
			onRestoredMessageConsumed();
		}
	}, [restoredMessage, onRestoredMessageConsumed, inputValue, onInputChange]);

	useEffect(() => {
		const editor = richTextareaRef.current;
		if (!editor) return;

		const currentText = editor.getContentAndCursor().text;
		if (currentText !== inputValue) {
			editor.setContent(inputValue);
		}
	}, [inputValue]);

	const showAutoMention =
		autoMention.activeNote !== null && !autoMention.isDisabled;

	const placeholder = `Message ${agentLabel} - @ to mention notes${availableCommands.length > 0 ? ", / for commands" : ""}`;

	const handleContextBadgeClick = useCallback(
		(reference: ChatContextReference) => {
			void plugin.openContextReference(reference);
		},
		[plugin],
	);

	const contextBadgeItems = React.useMemo<ContextBadgeItem[]>(() => {
		const items: ContextBadgeItem[] = [];

		if (showAutoMention && autoMention.activeNote) {
			const note = autoMention.activeNote;
			items.push({
				id: `auto:${note.path}:${note.selection?.from.line ?? -1}:${note.selection?.from.ch ?? -1}:${note.selection?.to.line ?? -1}:${note.selection?.to.ch ?? -1}`,
				iconName: note.selection ? "list" : "file",
				label: note.selection
					? `${note.name} ${note.selection.from.line + 1}:${note.selection.from.ch + 1}-${note.selection.to.line + 1}:${note.selection.to.ch + 1}`
					: note.name,
				title: note.selection
					? `Selection ${note.selection.from.line + 1}:${note.selection.from.ch + 1}-${note.selection.to.line + 1}:${note.selection.to.ch + 1}\n${note.path}`
					: `Full file\n${note.path}`,
				onClick: () =>
					handleContextBadgeClick({
						type: note.selection ? "selection" : "file",
						notePath: note.path,
						noteName: note.name,
						selection: note.selection,
					}),
				onRemove: () => autoMention.toggle(true),
			});
		}

		for (let i = 0; i < attachedImages.length; i++) {
			const img = attachedImages[i];
			items.push({
				id: img.id,
				iconName: "image",
				label: `Image ${i + 1}`,
				title: `Image context ${i + 1}`,
				onRemove: () => removeImage(img.id),
			});
		}

		return items;
	}, [
		showAutoMention,
		autoMention.activeNote,
		autoMention,
		attachedImages,
		removeImage,
		handleContextBadgeClick,
	]);

	return (
		<div className="obsius-chat-input-container">
			{errorInfo && (
				<ErrorOverlay
					errorInfo={errorInfo}
					onClose={onClearError}
					view={view}
				/>
			)}

			{mentionPicker.isOpen && (
				<UnifiedPickerPanel picker={mentionPicker} mode="mention" />
			)}

			{commandPicker.isOpen && !mentionPicker.isOpen && (
				<UnifiedPickerPanel picker={commandPicker} mode="command" />
			)}

			<div
				className={`obsius-chat-input-box ${isDraggingOver ? "obsius-dragging-over" : ""}`}
				onDragOver={handleDragOver}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDrop={(e) => void handleDrop(e)}
			>
				<ContextBadgeStrip items={contextBadgeItems} />

				<div className="obsius-textarea-wrapper">
					<RichTextarea
						ref={richTextareaRef}
						onContentChange={handleRichInput}
						onKeyDown={handleKeyDown}
						onPaste={(e) =>
							void handlePaste(
								e as unknown as React.ClipboardEvent<HTMLTextAreaElement>,
							)
						}
						placeholder={placeholder}
						spellCheck={obsidianSpellcheck}
						onContextBadgeClick={handleContextBadgeClick}
					/>
					{hintText && (
						<div className="obsius-hint-overlay" aria-hidden="true">
							<span className="obsius-invisible">{commandText}</span>
							<span className="obsius-hint-text">{hintText}</span>
						</div>
					)}
				</div>

				{supportsImages && (
					<ImagePreviewStrip images={attachedImages} onRemove={removeImage} />
				)}

				<InputActions
					modes={modes}
					models={models}
					onModeChange={onModeChange}
					onModelChange={onModelChange}
					sendButtonRef={sendButtonRef}
					sendButtonState={sendButtonState}
					isButtonDisabled={isButtonDisabled}
					buttonTitle={
						!isSessionReady
							? "Connecting..."
							: isSending
								? "Stop generation"
								: "Send message"
					}
					onSendOrStop={() => void handleSendOrStop()}
					contextUsage={contextUsage}
					isSessionReady={isSessionReady}
				/>
			</div>
		</div>
	);
}
