# Shared Utilities Guide

Pure utility modules with no React dependencies. Business logic extracted from hooks/adapters for reuse and testability.

## Utility Catalog

| File | Lines | Purpose | Consumers |
|------|-------|---------|-----------|
| `message-service.ts` | 8 | Facade re-export for message-service modules | `useChat` |
| `message-service/prompt-preparation.ts` | ~230 | Prompt preparation entry point: mention/image processing, orchestrates context builders | `useChat` |
| `message-service/prompt-context-builders.ts` | ~250 | Extracted context builder functions: explicit context, auto-mention resource/text builders | `prompt-preparation` |
| `message-service/prompt-sending.ts` | 113 | Prompt send path + auth retry + content type mapping | `useChat` |
| `message-service/types.ts` | 51 | Message-service shared types (incl. `supportsImage` flag) | `useChat` |
| `tool-icons.ts` | 490 | Tool title/kind -> Obsidian Lucide icon name mapping | `ToolCallRenderer` |
| `chat-context-token.ts` | 299 | Context reference token parsing, creation, extraction, badge formatting | `ChatInput`, `TextWithMentions`, `editor-context` |
| `terminal-manager.ts` | 277 | Spawn terminal processes, poll output, platform shell wrapping | `AcpAdapter` |
| `settings-schema.ts` | 220 | Zod-based settings validation with schema versioning (v4) | `SettingsStore` |
| `chat-view-registry.ts` | 214 | Multi-view management: register/unregister/focus/broadcast/navigate | `plugin.ts` |
| `acp-error-utils.ts` | 205 | ACP JSON-RPC error extraction, user-friendly `ErrorInfo` generation | `useChat`, `useAgentSession` |
| `settings-utils.ts` | 164 | `sanitizeArgs`, `normalizeEnvVars`, `toAgentConfig` conversion | `useAgentSession`, `AgentClientSettingTab` |
| `mentionable-files.ts` | ~40 | `MENTIONABLE_FILE_EXTENSIONS` set, `isMentionableExtension`, `getImageMimeTypeForExtension`, `getPathExtension` | `mention-service`, `TextWithMentions`, `mention-provider` |
| `mention-utils.ts` | 138 | `detectMention`, `replaceMention`, `extractMentionedNotes` parsing; resolves by full path or basename | `useMentions`, `message-service` |
| `windows-env.ts` | 129 | `getFullWindowsPath`, `getEnhancedWindowsEnv` — registry PATH query | `AcpAdapter`, `TerminalManager` |
| `wsl-utils.ts` | 98 | `convertWindowsPathToWsl`, `wrapCommandForWsl` | `AcpAdapter`, `message-service` |
| `shell-utils.ts` | 91 | `escapeShellArgWindows`, `getLoginShell`, `resolveCommandFromShell` | `AcpAdapter`, `TerminalManager` |
| `command-classification.ts` | 69 | Classify slash commands by category (mode, model, action, etc.) | `usePicker`, `command-provider` |
| `settings-migrations.ts` | 66 | Schema version migration functions for settings upgrades | `SettingsStore` |
| `path-utils.ts` | 63 | `resolveCommandDirectory`, `toRelativePath`, `buildFileUri` | `AcpAdapter`, `ToolCallRenderer` |
| `session-file-restoration.ts` | 54 | Detect and restore orphaned session files from disk | `useSessionRestore` |
| `logger.ts` | 44 | `Logger` class + `getLogger` singleton — debug-mode gated logging | everywhere |
| `completion-sound.ts` | 42 | `playCompletionSound` — two-tone chime via Web Audio API | `useChatController` |
| `session-capability-utils.ts` | 42 | `getSessionCapabilityFlags` — boolean flags from `AgentCapabilities` | `useSessionHistory` |
| `slash-command-token.ts` | 36 | Encode/decode slash commands as inline tokens in message text | `useSlashCommands`, `prompt-preparation` |
| `display-settings.ts` | 36 | `parseChatFontSize` — clamped integer parse (10-30) | `plugin.ts` |
| `agent-display-name.ts` | 20 | Agent display name resolution from config | Settings UI, headers |
| `plugin-notice.ts` | 10 | `pluginNotice` — prefixed `Notice` wrapper | hooks, plugin, components |
| `vault-path.ts` | 9 | Vault path resolution helper | `plugin.ts`, hooks |

## Key Patterns

**message-service modules** (`preparePrompt` + `sendPreparedPrompt`):
- Separates display content (original text + images) from agent content (processed mentions → file paths/URIs)
- Supports `embeddedContext` capability: attaches note content as `resource` type instead of text
- Supports `supportsImage` capability: attaches image files as `image` prompt content (binary read via `IVaultAccess.readBinaryFile`)
- Auth retry: catches `AUTHENTICATION_REQUIRED` error, invokes `authenticate()`, retries once
- WSL mode: converts Windows paths to `/mnt/c/...` format when `convertToWsl` flag set
- Context builder functions (`buildExplicitContextResources`, `buildAutoMentionResource`, etc.) extracted to `prompt-context-builders.ts`

**mentionable-files.ts**:
- `MENTIONABLE_FILE_EXTENSIONS`: `md`, `canvas`, `excalidraw`, `png`, `jpg`, `jpeg`, `gif`, `webp`
- Used by `NoteMentionService`, `TextWithMentions`, and `FilePickerProvider` to consistently determine which files are mentionable
- `getImageMimeTypeForExtension()` returns MIME type string for image files (used when attaching images to prompt)

**chat-context-token.ts**:
- Encodes `ChatContextReference` (selection, file, folder) as inline tokens in message text
- `extractChatContextTokensFromMessage()` separates tokens from user text before sending
- `formatChatContextBadgeLabel()` / `formatChatContextTooltip()` for UI display
- Used by `editor-context.ts` to inject context and by `TextWithMentions` to render badges

**settings-schema.ts**:
- Zod schemas validate persisted settings on load (migration safety net)
- `SETTINGS_SCHEMA_VERSION` (currently 4) tracks breaking changes
- `satisfies z.ZodType<T>` pattern ensures schema stays in sync with TypeScript types

**settings-migrations.ts**:
- Typed migration functions keyed by schema version
- Runs automatically when stored settings have older version than current
- Each migration transforms the settings object to the next version's shape

**slash-command-token.ts**:
- Encodes slash commands (e.g., `/compact`) as inline tokens in message text before sending
- Decoded by prompt preparation to apply command effects during send

**session-file-restoration.ts**:
- Scans session directory for orphaned `.json` files not tracked in settings
- Returns restorable sessions for `useSessionRestore` to offer to the user

**chat-view-registry.ts**:
- Views self-register on mount, unregister on close
- `focusNext`/`focusPrevious` cycles through registered views
- `broadcastTo` sends input state to all views of a type
- Focus order is registration order (not workspace leaf order) — intentional simplification

**terminal-manager.ts**:
- Spawns child processes with platform-specific shell wrapping
- Output accumulation with byte limit, polling via `getTerminalOutput()`
- Auto-cleanup timeout after process exit

**tool-icons.ts**:
- Maps tool titles (Read, Write, Bash, etc.) and `ToolKind` to Obsidian Lucide icon names
- Fallback chain: exact title match -> kind match -> default "wrench"

## Adding a Utility

1. Create `kebab-case.ts` in this directory
2. Export pure functions — no React hooks, no `obsidian` imports if possible
3. Exception: `terminal-manager.ts`, `mention-utils.ts` import from `obsidian` — keep to minimum
4. Document consumers in this table
