# Chat Components Guide

41 files for the chat UI. Entry point: `ChatView` (sidebar/Obsidian leaf). Includes `chat-input/` subdirectory with 12 files for input-related components and hooks. Picker panel in `components/picker/` (4 files).

## Component Tree

```
ChatView (ItemView, ~531 lines) ─── Obsidian sidebar leaf
  └── ChatComponent (React)
        ├── ChatHeader          ─ agent dropdown, session controls, update badge (~167 lines)
        │     ├── TabBar              ─ numbered tab badges (1,2,3…) (~61 lines)
        │     └── HeaderButton × 4    ─ new tab / new session / history / settings
        └── TabContent          ─ per-tab chat view container (~374 lines)
              ├── SessionHistoryPopover ─ floating session list panel
              │     └── SessionHistoryContent ─ session list + restore/fork/delete (~498 lines)
              │           └── ConfirmDeleteModal (Obsidian Modal)
              ├── ChatMessages        ─ scrollable message list (~262 lines)
              │     └── MessageRenderer (per message)
              │           └── MessageContentRenderer (per content block)
              │                 ├── MarkdownTextRenderer  — markdown → Obsidian renderMarkdown
              │                 ├── TextWithMentions      — @[[note]] + context token rendering; resolves md/canvas/excalidraw/image files (~270 lines)
              │                 ├── ToolCallRenderer      — tool call accordion (~480 lines)
              │                 │     ├── DiffRenderer       — unified diff view (~387 lines)
              │                 │     ├── TerminalRenderer   — polling terminal output (~143 lines)
              │                 │     └── PermissionRequestSection — approve/deny buttons
              │                 ├── CollapsibleThought    — agent reasoning toggle
              │                 └── CollapsibleSection    — generic collapsible wrapper; `collapsible={false}` renders static (non-clickable) header (~55 lines)
              ├── RestoredSessionToolbar ─ session restore accept/discard bar (~87 lines)
              ├── SessionChangesModal   ─ modal showing session file changes (~114 lines)
              ├── DiffViewer            ─ side-by-side diff display for inline edits (~74 lines)
              ├── SuggestionDropdown  ─ @mention + /command dropdown (~140 lines)
              └── ChatInput           ─ input orchestrator (~619 lines)
                    ├── ErrorOverlay        ─ error banner above input
                    ├── SuggestionDropdown  ─ (mentions + slash commands, 2 instances)
                    ├── ContextBadgeStrip   ─ auto-mention + context reference badges
                    ├── RichTextarea        ─ contenteditable input (~550 lines)
                    ├── ImagePreviewStrip   ─ attached image thumbnails
                    ├── ContextUsageMeter   ─ context window usage meter (~93 lines)
                    └── InputActions        ─ mode/model selectors + send/stop (~130 lines)
                          ├── SelectorButton (mode) ─ portal-based popover (~174 lines)
                          ├── SelectorButton (model)
                          └── Send/Stop button

Picker (components/picker/):
  UnifiedPickerPanel  ─ unified picker for mentions + commands (~207 lines)
  mention-provider.ts ─ @mention picker provider (~178 lines)
  command-provider.ts ─ /command picker provider (~70 lines)
  types.ts            ─ PickerProvider, PickerItem interfaces (~80 lines)

Standalone:
  HeaderButton        ─ reusable icon button for header
  ObsidianIcon        ─ Obsidian Lucide icon wrapper (~29 lines)
  ProviderLogo        ─ CDN SVG brand icons (~56 lines)
  MentionBadgeStrip   ─ attached note badges (~105 lines)
  AutoMentionBadge    ─ active note indicator (~68 lines)
```

## Entry Point

**ChatView**: Extends `ItemView`. Manages Obsidian leaf lifecycle, view state persistence (agent ID), `IChatViewContainer` implementation for registry. Creates React root in `onOpen()`, destroys in `onClose()`. Workspace event handling delegated to `useWorkspaceEvents` hook.

`ChatComponent` calls `useTabs()`, `useUpdateCheck()`, and `useWorkspaceEvents()` at the view level. Each tab's `TabContent` calls `useChatController()` — all per-tab logic lives in hooks.

## Picker System

`UnifiedPickerPanel` (in `components/picker/`) provides a unified autocomplete panel triggered by `@` (mentions) or `/` (slash commands) in the input. Pluggable via `PickerProvider` interface — each provider defines trigger character, search logic, and item rendering. `usePicker` hook (called twice in `ChatInput` — once per provider) manages panel open/close and selection state.

## Tab System

`TabBar` renders tab headers; `TabContent` renders per-tab chat. Each tab has its own `useChatController` instance with independent agent session, messages, and state. `useTabs` hook manages tab lifecycle (max 4 tabs), composed in `ChatComponent`.

## Session History

Session history uses a popover pattern (not a modal). `SessionHistoryPopover` wraps `SessionHistoryContent` in a floating panel toggled via the header history button. `useSessionHistoryHandlers` manages the popover open/close state.

## IChatViewHost Interface (`types.ts`)

Components that need DOM event cleanup depend on `IChatViewHost` (not `ChatView` directly). This decouples components from the concrete view implementation.

## chat-input/ Subdirectory

Input-related components extracted from `ChatInput.tsx`. Contains:
- **3 hooks**: `use-chat-input-behavior` (keydown/submit), `use-image-attachments` (paste/drop), `use-obsidian-dropdown` (native Obsidian dropdown bridge)
- **6 components**: `RichTextarea`, `InputActions`, `SelectorButton`, `ProviderLogo`, `ContextUsageMeter`, `MentionBadgeStrip`, `AutoMentionBadge`
- **2 icon maps**: `mode-icons.ts`, `file-icons.ts`

Note: hooks in `chat-input/` use `kebab-case` naming (not `usePascalCase`) since they're input-specific, not controller-level.

## Session Restore

`RestoredSessionToolbar` renders an accept/discard bar when `useSessionRestore` detects orphaned session files on disk. `SessionChangesModal` shows the detailed file changes. `DiffViewer` displays side-by-side diffs for inline edit results.

**Loading spinner**: `ChatMessages` renders an SVG square-dots spinner (`.ac-loading__spinner` with 4 circles + 4 lines) while `isSending` is true. CSS-animated via keyframes in `styles.css`; replaces the former three-dot pulse indicator.

**Markdown**: `MarkdownTextRenderer` calls Obsidian's `MarkdownRenderer.render()` into a `<div ref>`. Must handle async rendering and cleanup.

**Terminal output**: `TerminalRenderer` polls `acpClient.terminalOutput()` on interval. Shows live output + exit status.

**Diff display**: `DiffRenderer` uses `diff` library to generate unified diff view with word-level highlighting. Computes relative paths via `toRelativePath()`.

**Permission UI**: `PermissionRequestSection` renders approve/deny options. Local `selectedOptionId` state for immediate feedback before server confirms.

**Provider logos**: `ProviderLogo` loads SVGs from `@lobehub/icons-static-svg` CDN via CSS `mask-image` — inherits `currentColor` for theme compatibility.

**Context badges**: `ContextBadgeStrip` renders auto-mention and context reference badges above the input. Uses `chat-context-token.ts` for token parsing/formatting.

**Context usage**: `ContextUsageMeter` displays a visual meter showing how much of the agent's context window is consumed, rendered in the input area.

**CollapsibleSection non-collapsible mode**: Pass `collapsible={false}` to render a static header with no click/expand behaviour (adds `.ac-collapsible--static` CSS class). Used by `ToolCallRenderer` when the tool call has no renderable details (no command, no locations, no terminal/diff content, no patch).

**ToolCallRenderer enhancements**: 
- Unknown/generic tool names are shown as `.ac-row__summary` next to the "Tool" display name.
- `hasPlanContent` prop (threaded from `MessageRenderer` via `MessageContentRenderer`): suppresses collapsible expand for TodoWrite/TodoRead tool calls when a plan block is already rendered in the message.
- `hasRenderableDetails` computed boolean controls whether `CollapsibleSection` is in collapsible mode.

**TextWithMentions multi-file support**: Resolves `@[[mention]]` targets by full path first (for non-markdown files like images), then falls back to basename. Uses `isMentionableExtension` from `mentionable-files.ts` to filter candidate files.

## Obsidian Integration Rules

- Use `createEl`/`createDiv` in non-React Obsidian classes (Modal, ItemView methods)
- React components use JSX normally — only raw Obsidian APIs need element helpers
- `registerDomEvent` for event cleanup tied to view lifecycle
- `Platform.isDesktopApp` guard in `ChatComponent` — throws on mobile

## Adding a Component

1. Create `PascalCase.tsx` in this directory (or `chat-input/` for input-related)
2. Accept props from `useChatController` return — not raw plugin/adapter
3. Register DOM events via `IChatViewHost.registerDomEvent` for cleanup
4. Style in `styles.css` (root-level) — no CSS modules, no JS styles
