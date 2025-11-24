/**
 * Hook Exports
 *
 * Central export point for all custom hooks.
 */

// Settings
export { useSettings, useSettingsValue } from "./useSettings";

// Chat state
export { useMessages, type UseMessagesReturn } from "./useMessages";
export { useSession, type UseSessionReturn } from "./useSession";

// Chat actions
export { useSendMessage, type UseSendMessageReturn } from "./useSendMessage";
export { usePermissions, type UsePermissionsReturn } from "./usePermissions";

// UI state (context-dependent - legacy)
export { useMentions } from "./useMentions";
export { useSlashCommands } from "./useSlashCommands";

// UI state (standalone dropdowns)
export {
	useMentionsDropdown,
	type UseMentionsDropdownOptions,
	type UseMentionsDropdownReturn,
} from "./useMentionsDropdown";
export {
	useSlashCommandsDropdown,
	type UseSlashCommandsDropdownOptions,
	type UseSlashCommandsDropdownReturn,
} from "./useSlashCommandsDropdown";

// Combined chat hook
export { useChat, type UseChatReturn } from "./useChat";
