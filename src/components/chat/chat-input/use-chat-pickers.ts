import * as React from "react";
import type { SlashCommand } from "../../../domain/models/chat-session";
import type { IVaultAccess } from "../../../domain/ports/vault-access.port";
import type { UseMentionsReturn } from "../../../hooks/useMentions";
import type { UseSlashCommandsReturn } from "../../../hooks/useSlashCommands";
import { usePicker, type PickerSortFn } from "../../../hooks/usePicker";
import { classifyCommands } from "../../../shared/command-classification";
import { CommandPickerProvider } from "../../picker/command-provider";
import {
	FilePickerProvider,
	FolderPickerProvider,
} from "../../picker/mention-provider";
import type { PickerCategory } from "../../picker/types";
import type AgentClientPlugin from "../../../plugin";
import type { RichTextareaHandle } from "./RichTextarea";

interface UseChatPickersOptions {
	availableCommands: SlashCommand[];
	mentions: UseMentionsReturn;
	slashCommands: UseSlashCommandsReturn;
	vaultAccess: IVaultAccess;
	plugin: AgentClientPlugin;
	richTextareaRef: React.RefObject<RichTextareaHandle | null>;
	onInputChange: (value: string) => void;
}

interface UseChatPickersResult {
	mentionPicker: ReturnType<typeof usePicker>;
	commandPicker: ReturnType<typeof usePicker>;
}

export function useChatPickers({
	availableCommands,
	mentions,
	slashCommands,
	vaultAccess,
	plugin,
	richTextareaRef,
	onInputChange,
}: UseChatPickersOptions): UseChatPickersResult {
	const fileProvider = React.useMemo(
		() =>
			new FilePickerProvider(vaultAccess, (note) => {
				const mentionTarget =
					note.extension.toLowerCase() === "md" ? note.name : note.path;
				const ctx = mentions.context;
				if (ctx) {
					richTextareaRef.current?.insertMentionAtContext(
						mentionTarget,
						ctx.start,
						ctx.end,
					);
					mentions.close();
				}
			}),
		[vaultAccess, mentions, richTextareaRef],
	);

	const folderProvider = React.useMemo(
		() =>
			new FolderPickerProvider(
				() => {
					const seen = new Set<string>();
					for (const file of plugin.app.vault.getAllLoadedFiles()) {
						if ("children" in file && file.path) {
							seen.add(file.path);
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
		[plugin.app.vault, mentions, richTextareaRef],
	);

	const mentionProviders = React.useMemo(
		() => [fileProvider, folderProvider],
		[fileProvider, folderProvider],
	);

	const classified = React.useMemo(
		() => classifyCommands(availableCommands),
		[availableCommands],
	);

	const handleCommandSelect = React.useCallback(
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
		[onInputChange, richTextareaRef, slashCommands],
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
				(provider) => provider.search("").length > 0 || true,
			),
		[cmdProvider, mcpProvider, skillProvider],
	);

	const mentionSort = React.useCallback<PickerSortFn>((items, query) => {
		if (!query) return items;
		const queryLower = query.toLowerCase();
		return [...items].sort((a, b) => {
			const aLower = a.label.toLowerCase();
			const bLower = b.label.toLowerCase();
			const aStart = aLower.startsWith(queryLower)
				? 2
				: aLower.includes(queryLower)
					? 1
					: 0;
			const bStart = bLower.startsWith(queryLower)
				? 2
				: bLower.includes(queryLower)
					? 1
					: 0;
			if (aStart !== bStart) return bStart - aStart;
			const aFolder = a.category === "folder" ? 1 : 0;
			const bFolder = b.category === "folder" ? 1 : 0;
			if (aFolder !== bFolder) return bFolder - aFolder;
			return aLower.localeCompare(bLower);
		});
	}, []);

	const commandSort = React.useCallback<PickerSortFn>((items, query) => {
		if (!query) return items;
		const queryLower = query.toLowerCase();
		return [...items].sort((a, b) => {
			const aLower = a.label.toLowerCase().replace(/^\//, "");
			const bLower = b.label.toLowerCase().replace(/^\//, "");
			const aStart = aLower.startsWith(queryLower)
				? 2
				: aLower.includes(queryLower)
					? 1
					: 0;
			const bStart = bLower.startsWith(queryLower)
				? 2
				: bLower.includes(queryLower)
					? 1
					: 0;
			if (aStart !== bStart) return bStart - aStart;
			return aLower.localeCompare(bLower);
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

	const mentionPickerRef = React.useRef(mentionPicker);
	mentionPickerRef.current = mentionPicker;
	const commandPickerRef = React.useRef(commandPicker);
	commandPickerRef.current = commandPicker;
	const mentionsRef = React.useRef(mentions);
	mentionsRef.current = mentions;
	const slashCommandsRef = React.useRef(slashCommands);
	slashCommandsRef.current = slashCommands;

	const mentionQuery = mentions.context?.query ?? "";
	const hasMentionContext = mentions.context !== null;
	const prevMentionCtx = React.useRef(false);
	React.useEffect(() => {
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
	const prevCommandCtx = React.useRef(false);
	React.useEffect(() => {
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
	const prevMentionPickerOpen = React.useRef(false);
	React.useEffect(() => {
		if (!mentionPickerOpen && prevMentionPickerOpen.current) {
			mentionsRef.current.close();
			richTextareaRef.current?.focus();
		}
		prevMentionPickerOpen.current = mentionPickerOpen;
	}, [mentionPickerOpen, richTextareaRef]);

	const commandPickerOpen = commandPicker.isOpen;
	const prevCommandPickerOpen = React.useRef(false);
	React.useEffect(() => {
		if (!commandPickerOpen && prevCommandPickerOpen.current) {
			slashCommandsRef.current.close();
			richTextareaRef.current?.focus();
		}
		prevCommandPickerOpen.current = commandPickerOpen;
	}, [commandPickerOpen, richTextareaRef]);

	return {
		mentionPicker,
		commandPicker,
	};
}
