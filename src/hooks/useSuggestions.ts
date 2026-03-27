import { useMentions, type UseMentionsReturn } from "./useMentions";
import { useSlashCommands, type UseSlashCommandsReturn } from "./useSlashCommands";
import type { IVaultAccess } from "../services/vault-service";
import type { SlashCommand } from "../types/session";
import type AgentClientPlugin from "../plugin";

export interface UseSuggestionsReturn {
	/** Mention dropdown state and operations */
	mentions: UseMentionsReturn;
	/** Slash command dropdown state and operations */
	commands: UseSlashCommandsReturn;
}

/**
 * Hook for managing input suggestions (mentions + slash commands).
 *
 * Combines mention and slash command dropdown logic into a single hook.
 * Handles the auto-mention toggle coordination internally:
 * slash commands disable auto-mention to keep "/" at the start of input.
 *
 * @param vaultAccess - Vault access for note searching
 * @param plugin - Plugin instance for settings and configuration
 * @param availableCommands - Available slash commands from the agent session
 */
export function useSuggestions(
	vaultAccess: IVaultAccess,
	plugin: AgentClientPlugin,
	availableCommands: SlashCommand[],
): UseSuggestionsReturn {
	const mentions = useMentions(vaultAccess, plugin);
	const commands = useSlashCommands(availableCommands, mentions.toggleAutoMention);

	return { mentions, commands };
}
