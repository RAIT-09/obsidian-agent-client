# Architecture Documentation

## Overview

Obsidian plugin for AI agent interaction via ACP. `useAgent` facade hook composes sub-hooks (`useAgentSession` + `useAgentMessages`) and subscribes to a single `onSessionUpdate` channel. `ChatPanel` orchestrates hooks and renders children directly. Services are injected via React Context. ACP protocol details are isolated in the `acp/` layer.

## Directory Structure

```
src/
├── types/                          # Type Definitions (no logic, no dependencies)
│   ├── chat.ts                     # ChatMessage, MessageContent, PromptContent, AttachedFile, ActivePermission
│   ├── session.ts                  # ChatSession, SessionUpdate (12-type union), SessionInfo, Capabilities
│   ├── agent.ts                    # AgentConfig, agent settings (Claude/Gemini/Codex/Custom)
│   └── errors.ts                   # AcpError, ProcessError, ErrorInfo
│
├── acp/                            # ACP Protocol Layer (SDK dependency confined here)
│   ├── acp-client.ts               # Process lifecycle, UI-facing API (AcpClient class)
│   ├── acp-handler.ts              # SDK event handler + sessionId filter + listener broadcast
│   ├── type-converter.ts           # ACP SDK types ↔ internal types
│   ├── permission-handler.ts       # Permission queue, auto-approve, Promise resolution
│   └── terminal-handler.ts         # Terminal process create/output/kill
│
├── services/                       # Business Logic (non-React, no React imports)
│   ├── vault-service.ts            # Vault access + fuzzy search + CM6 selection tracking + wikilink resolver
│   ├── settings-service.ts         # Reactive settings store (observer pattern only)
│   ├── session-storage.ts          # Session metadata + message file I/O (sessions/*.json)
│   ├── settings-normalizer.ts      # Settings validation helpers (str, bool, num, enumVal, normalizeWorkspacePath, etc.)
│   ├── session-helpers.ts          # Agent config building, API key injection (pure functions)
│   ├── session-state.ts            # Session state updates (legacy mode/model, config restore)
│   ├── message-state.ts            # Message array transforms (upsert, merge, streaming apply)
│   ├── message-sender.ts           # Prompt preparation + sending (pure functions, workspace prelude injection)
│   ├── agent-workspace.ts          # /Agent-Client/ folder bootstrap, vault-event manifest, seed-then-delta prelude builder
│   ├── chat-exporter.ts            # Markdown export with frontmatter
│   ├── view-registry.ts            # Multi-view management, focus, broadcast
│   └── update-checker.ts           # Agent/plugin version checking
│
├── hooks/                          # React Custom Hooks (state + logic)
│   ├── useAgent.ts                 # Facade: composes useAgentSession + useAgentMessages
│   ├── useAgentSession.ts          # Session lifecycle, config options, optimistic updates
│   ├── useAgentMessages.ts         # Message state, streaming (RAF batch), permissions
│   ├── useSuggestions.ts           # @[[note]] mentions + /command suggestions (unified)
│   ├── useSessionHistory.ts        # Session list/load/resume/fork, 5-min cache
│   ├── useChatActions.ts           # Business callbacks (send, newChat, export, restart, etc.)
│   ├── useHistoryModal.ts          # Session history modal lifecycle
│   └── useSettings.ts              # Settings subscription (useSyncExternalStore)
│
├── ui/                             # React Components
│   ├── ChatContext.ts              # React Context (plugin, acpClient, vaultService, settingsService)
│   ├── ChatPanel.tsx               # Orchestrator: calls hooks, workspace events, rendering
│   ├── ChatView.tsx                # Sidebar view (ItemView + Context Provider)
│   ├── FloatingChatView.tsx        # Floating window (position/drag/resize + Context Provider)
│   ├── FloatingButton.tsx          # Draggable launch button
│   ├── ChatHeader.tsx              # Header (sidebar + floating variants)
│   ├── MessageList.tsx             # Virtualized message list (@tanstack/react-virtual)
│   ├── MessageBubble.tsx           # Single message (content dispatch, copy button)
│   ├── ToolCallBlock.tsx           # Tool call display + diff (word-level highlighting)
│   ├── TerminalBlock.tsx           # Terminal output polling
│   ├── InputArea.tsx               # Textarea, attachments, mentions, history
│   ├── InputToolbar.tsx            # Config/mode/model selectors, usage, send button
│   ├── SuggestionPopup.tsx         # Mention/command dropdown
│   ├── PermissionBanner.tsx        # Permission request buttons
│   ├── ErrorBanner.tsx             # Error/notification overlay
│   ├── SessionHistoryModal.tsx     # Session history modal (list + confirm delete)
│   ├── SettingsTab.ts              # Plugin settings UI
│   ├── view-host.ts                # IChatViewHost interface
│   └── shared/
│       ├── IconButton.tsx           # Icon button + Lucide icon wrapper
│       ├── MarkdownRenderer.tsx     # Obsidian markdown rendering
│       └── AttachmentStrip.tsx      # Attachment preview strip
│
├── utils/                          # Shared Utilities (pure functions)
│   ├── platform.ts                 # Shell, WSL, Windows env, command building
│   ├── paths.ts                    # Path resolution, file:// URI
│   ├── error-utils.ts              # ACP error conversion
│   ├── mention-parser.ts           # @[[note]] detection/extraction
│   ├── wikilink-resolver.ts        # `[[wikilink]]` extraction + basename index + ambiguity surfacing
│   ├── wikilink-formatter.ts       # `<obsidian_metadata>` XML prelude builder for resolved links
│   └── logger.ts                   # Debug-mode logger
│
├── plugin.ts                       # Obsidian plugin lifecycle, commands, view management
└── main.ts                         # Entry point (re-exports plugin)
```

## Architectural Layers

### 1. Types Layer (`src/types/`)

**Purpose**: Pure type definitions. No logic, no dependencies.

| File | Contents |
|------|----------|
| `chat.ts` | ChatMessage, MessageContent (8+ type union), Role, ToolCallStatus, ToolKind, AttachedFile, ActivePermission, PromptContent |
| `session.ts` | ChatSession (incl. workspaceSnapshot), SessionState, SessionUpdate (12-type union incl. ProcessErrorUpdate), SessionConfigOption, WorkspaceSnapshot, Capabilities, SessionInfo |
| `agent.ts` | AgentEnvVar, BaseAgentSettings, ClaudeAgentSettings, GeminiAgentSettings, CodexAgentSettings |
| `errors.ts` | AcpErrorCode, AcpError, ProcessError, ErrorInfo |

---

### 2. ACP Layer (`src/acp/`)

**Purpose**: Isolate ACP protocol dependency. All `@agentclientprotocol/sdk` imports are confined here.

| File | Purpose |
|------|---------|
| `acp-client.ts` | UI-facing API: process spawn/kill, JSON-RPC communication, session management. Owns AcpHandler + managers. Single exit point: `onSessionUpdate` (multiple listeners via Set). |
| `acp-handler.ts` | SDK-facing: receives sessionUpdate, requestPermission, terminal ops. Filters by `currentSessionId`. Broadcasts to all listeners. |
| `type-converter.ts` | Converts ACP SDK types to internal types (change buffer for protocol updates) |
| `permission-handler.ts` | Permission request queue, auto-approve, Promise-based resolution. All UI updates via `onSessionUpdate` (no separate callback path). |
| `terminal-handler.ts` | Terminal process create/output/kill, stdout/stderr buffering |

**Key design**: All agent events (messages, session updates, permissions, errors) flow through a single `onSessionUpdate` channel. No special paths.

---

### 3. Services Layer (`src/services/`)

**Purpose**: Non-React business logic. Classes and pure functions. **No React imports.**

| File | Purpose |
|------|---------|
| `vault-service.ts` | `VaultService` class — vault note access, fuzzy search, CM6 selection tracking, wikilink resolver port. Exports `IVaultAccess`, `NoteMetadata`. Implements `IWikilinkResolver`. |
| `settings-service.ts` | `SettingsService` class — reactive settings store (observer pattern). Delegates session storage to `SessionStorage`. Exports `ISettingsAccess`. |
| `session-storage.ts` | `SessionStorage` class — session metadata CRUD (in plugin settings) + message file I/O (sessions/*.json). |
| `settings-normalizer.ts` | Pure functions — settings validation helpers (`str`, `bool`, `num`, `enumVal`, `obj`, `strRecord`, `xyPoint`, `normalizeWorkspacePath`), `toAgentConfig`, `parseChatFontSize`. |
| `session-helpers.ts` | Pure functions — agent config building, API key injection, agent settings resolution |
| `session-state.ts` | Pure functions — legacy mode/model application, config option restoration |
| `message-state.ts` | Pure functions — message array transforms (streaming apply, tool call upsert with O(1) index, permission scanning) |
| `message-sender.ts` | Pure functions — prompt preparation (embedded context vs XML text, shared helpers, workspace prelude prepended to first text block), sending with auth retry |
| `agent-workspace.ts` | `AgentWorkspace` class — bootstraps `/Agent-Client/` (Focus_Context.md, Resources/, Agent_Output/), watches Resources/ via vault events with dirty-flag manifest, builds seed `<obsidian_workspace>` and delta `<obsidian_workspace_update>` preludes, recomputes `WorkspaceSnapshot` post-turn so agent self-edits don't round-trip. Exports `IAgentWorkspace`. |
| `chat-exporter.ts` | `ChatExporter` class — markdown export with frontmatter, image handling |
| `view-registry.ts` | `ChatViewRegistry` class — multi-view focus tracking, broadcast commands. Exports `IChatViewContainer`. |
| `update-checker.ts` | Agent version checking via npm registry |

---

### 4. Hooks Layer (`src/hooks/`)

**Purpose**: React state management. Hook composition via useAgent facade.

| Hook | Responsibility |
|------|---------------|
| `useAgent` | Facade: composes useAgentSession + useAgentMessages. Single `onSessionUpdate` subscription. Return is `useMemo`-wrapped. |
| `useAgentSession` | Session lifecycle (create/close/restart), mode/model/configOption with optimistic updates. Uses `sessionRef` pattern. |
| `useAgentMessages` | Message state, RAF-batched streaming, permissions (activePermission derivation, approve/reject) |
| `useSuggestions` | @[[note]] mentions + /command suggestions (unified). Return is `useMemo`-wrapped. |
| `useSessionHistory` | Session list/load/resume/fork, local session storage, 5-min cache. Return is `useMemo`-wrapped. |
| `useChatActions` | Business callbacks (send, newChat, export, restart, config changes). Individual method deps for stability. |
| `useHistoryModal` | Session history modal lifecycle (lazy creation, props sync) |
| `useSettings` | Settings subscription via useSyncExternalStore |

**Dependency Rule**: Hooks import from `types/`, `acp/`, `services/`, `utils/`. Never from `ui/`.

---

### 5. UI Layer (`src/ui/`)

**Purpose**: React components. Rendering and user interaction.

#### Core Architecture

**ChatContext** provides shared services to the component tree:
```typescript
interface ChatContextValue {
  plugin: AgentClientPlugin;
  acpClient: AcpClient;
  vaultService: VaultService;
  settingsService: SettingsService;
}
```

**ChatPanel** is the central orchestrator:
- Calls hooks: useAgent, useSuggestions, useSessionHistory, useChatActions, useHistoryModal, useSettings
- Does NOT route session updates (useAgent handles that internally)
- Handles workspace events via ref pattern (stable event registration)
- Renders ChatHeader, MessageList, InputArea directly

**ChatView** (sidebar) and **FloatingChatView** (floating window) are thin wrappers:
- Create services (AcpClient, VaultService) in lifecycle methods
- Provide ChatContext
- Render ChatPanel with `variant` prop
- Implement IChatViewContainer for broadcast commands

#### Component Tree

```
ChatView / FloatingChatView
  └── ChatContextProvider
        └── ChatPanel (variant="sidebar" | "floating")
              ├── ChatHeader (variant-based rendering)
              ├── MessageList (virtualized via @tanstack/react-virtual)
              │     └── MessageBubble (per message, React.memo)
              │           ├── ToolCallBlock (React.memo) → PermissionBanner
              │           ├── TerminalBlock (React.memo)
              │           └── MarkdownRenderer
              ├── InputArea
              │     ├── SuggestionPopup (mentions / commands)
              │     ├── ErrorBanner
              │     ├── AttachmentStrip
              │     └── InputToolbar (config/mode/model/usage/send)
              └── SessionHistoryModal (imperative, via useHistoryModal)
```

---

### 6. Utils Layer (`src/utils/`)

**Purpose**: Pure utility functions. No React, no Obsidian dependencies (except `platform.ts`).

| File | Purpose |
|------|---------|
| `platform.ts` | Shell detection, WSL path conversion, Windows PATH from registry, platform-specific command preparation |
| `paths.ts` | Path resolution (which/where), file:// URI building, relative path conversion |
| `error-utils.ts` | ACP error code → user-friendly title/suggestion conversion |
| `mention-parser.ts` | @[[note]] detection, replacement, extraction from text |
| `wikilink-resolver.ts` | `[[wikilink]]` extraction from note content; basename index + `getFirstLinkpathDest` for resolution; surfaces unresolved/ambiguous candidates. Skips `![[embeds]]`. Exports `IWikilinkResolver`. |
| `wikilink-formatter.ts` | Builds `<obsidian_metadata><links>...` XML prelude from resolved metadata (50-link cap, `truncated="N"`) for prepending to mentioned-note bodies and `Focus_Context.md`. |
| `logger.ts` | Singleton logger respecting debugMode setting |

---

## Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                             │
│                                                              │
│  ChatView / FloatingChatView (Context Providers)             │
│    └── ChatPanel (hook composition + rendering)              │
│          ├── ChatHeader, MessageList, InputArea              │
│          └── MessageBubble, ToolCallBlock, etc.              │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ calls hooks
┌─────────────────────────────┴───────────────────────────────┐
│                       Hooks Layer                            │
│  useAgent (facade) → useAgentSession + useAgentMessages      │
│  useSuggestions, useSessionHistory, useChatActions,           │
│  useHistoryModal, useSettings                                │
└───────────┬─────────────────────────────┬───────────────────┘
            ↓ calls                       ↓ reads types
┌───────────┴───────────┐   ┌─────────────┴───────────────────┐
│   Services Layer      │   │        Types Layer               │
│   VaultService        │   │   chat.ts, session.ts,           │
│   SettingsService     │   │   agent.ts, errors.ts            │
│   SessionStorage      │   └─────────────────────────────────┘
│   settings-normalizer │
│   session-helpers      │
│   session-state       │
│   message-state       │
│   message-sender      │
│   chat-exporter       │
│   view-registry       │
└───────────┬───────────┘
            ↓ communicates
┌───────────┴───────────┐
│     ACP Layer         │
│   acp-client.ts       │
│   acp-handler.ts      │
│   type-converter.ts   │
│   permission-handler  │
│   terminal-handler    │
└───────────────────────┘
            ↑
    @agentclientprotocol/sdk
```

---

## Design Patterns

### 1. useAgent Facade Pattern
- `useAgent` composes `useAgentSession` + `useAgentMessages`
- Single `onSessionUpdate` subscription, dispatches to both sub-hooks
- ChatPanel calls useAgent, not sub-hooks directly
- Return is `useMemo`-wrapped for referential stability

### 2. React Context for Services
- `ChatContext` provides plugin, acpClient, vaultService, settingsService
- Value is stable (service instances don't change)
- Eliminates prop drilling for shared dependencies

### 3. Single Event Channel
- All agent events flow through `onSessionUpdate` (messages, session updates, permissions, errors)
- No special callback paths (onUpdateMessage, onError removed)
- AcpHandler filters by `currentSessionId` before broadcasting

### 4. ACP Isolation
- All `@agentclientprotocol/sdk` imports confined to `acp/`
- `AcpClient` (UI-facing) and `AcpHandler` (SDK-facing) separate concerns
- `type-converter.ts` is the change buffer for protocol updates

### 5. Performance Patterns
- **useMemo for return stability**: useAgent, useSuggestions, useSessionHistory wrap returns in useMemo
- **sessionRef pattern**: useAgentSession stores session in useRef, reads in callbacks without adding to deps
- **Individual method deps**: useChatActions uses `agent.sendMessage` not `agent` object in deps
- **Workspace event refs**: ChatPanel stores handler callbacks in refs, keeping useEffect deps minimal
- **RAF batching**: useAgentMessages batches streaming updates per animation frame
- **React.memo**: MessageBubble, ToolCallBlock, TerminalBlock for skip-render optimization
- **Virtual scroll**: MessageList uses @tanstack/react-virtual
- **O(1) tool call index**: Map<string, number> for tool call upsert

### 6. Observer Pattern
- `SettingsService` notifies subscribers on change
- React components use `useSyncExternalStore`

### 7. Ref Pattern for Callbacks
- IChatViewContainer callbacks use refs for latest values
- Workspace event handlers use refs to avoid re-registration
- Unmount cleanup uses refs to access latest state

### 8. Seed-then-Delta Context Economy (Agent Workspace)
- `/Agent-Client/` workspace ships full state once per session (`<obsidian_workspace>` seed)
- Subsequent prompts compare against a `WorkspaceSnapshot` and emit only changed zones (`<obsidian_workspace_update>` delta) — empty when nothing changed
- Post-turn recomputation invariant: after every successful agent turn, snapshot ≡ current workspace state, so agent-self-edits never round-trip
- Resources/ manifest maintained via vault events (`create | modify | delete | rename`) with O(1) dirty-flag check at prompt time
- Hash via cyrb53 (fast, sufficient for change detection — not cryptographic)

### 9. Wikilink Resolution
- `IWikilinkResolver` (implemented by `VaultService`, consumed by `agent-workspace` and `message-sender`) extracts `[[wikilinks]]` and resolves them via Obsidian's `getFirstLinkpathDest` plus a basename index for ambiguity detection
- Resolved metadata is rendered as `<obsidian_metadata><links>` and prepended to note bodies, letting the agent decide which links to read on demand without embedding their content

---

## Key Benefits

### 1. Flat and Readable
- 4 layers (types → acp/services → hooks → ui)
- No port/adapter indirection
- File names reflect functionality

### 2. ACP Change Resistance
- Only `acp/` directory needs changes for protocol updates
- `type-converter.ts` localizes type mapping changes

### 3. Easy Feature Addition
- New hook: create in `hooks/`, call in `ChatPanel`, wrap return in `useMemo`
- New message type: add to `types/session.ts`, handle in `useAgentMessages` or `message-state.ts`, render in `MessageBubble`
- New agent: add settings in `plugin.ts`, configure in `SettingsTab`

### 4. Maintainability
- ~19,800 lines across 56 files
- Services testable without React (zero React imports)
- Clear dependency direction (no circular dependencies)

---

## File Naming Conventions

| Pattern | Example |
|---------|---------|
| Types | `kebab-case.ts` in `types/` |
| ACP | `kebab-case.ts` in `acp/` |
| Services | `kebab-case.ts` in `services/` |
| Hooks | `use*.ts` in `hooks/` |
| Components | `PascalCase.tsx` in `ui/` |
| Utilities | `kebab-case.ts` in `utils/` |

---

## Adding New Features

### Adding a New Hook
1. Create `hooks/use[Feature].ts`
2. Define state with useState/useReducer
3. Call the hook in `ui/ChatPanel.tsx`
4. Pass state/callbacks to child components as props
5. Wrap return object in `useMemo` if passed as dependency to other hooks

### Adding a New Session Update Type
1. Add interface to `types/session.ts`, add to `SessionUpdate` union
2. Handle in `acp/acp-handler.ts` `sessionUpdate()` switch
3. Convert from ACP type in `acp/type-converter.ts` if needed
4. Handle in `hooks/useAgentSession.ts` `handleSessionUpdate()` (for session-level)
5. Or handle via `applySingleUpdate()` in `services/message-state.ts` (for message-level)
6. No routing needed in ChatPanel — useAgent handles dispatch internally

### Adding a New Agent Type
1. Add settings type to `types/agent.ts`
2. Add config in `plugin.ts` settings
3. Add API key injection in `services/session-helpers.ts`
4. Update `ui/SettingsTab.ts` for configuration UI

---

## Migration Notes

### March 2026: Simplified Architecture Refactoring

Refactored from Port/Adapter Architecture to simplified layered architecture:

- **Removed**: `domain/models/` (9 files → `types/` 4 files), `domain/ports/` (5 files → interfaces moved to implementation files), `adapters/` directory, `components/` directory, `shared/` directory
- **Added**: `types/`, `acp/`, `services/`, `ui/`, `utils/` flat directories, `ChatPanel` + `ChatContext`
- **Merged**: VaultAdapter + MentionService → VaultService, useMentions + useAutoMention → useMentions
- **Removed**: useChatController (god hook → ChatPanel component), Port files (no implementation swapping planned)
- **Result**: 76 → 50 files, 5 → 4 layers, flat directory structure

### May 2026: Wikilink Context + Agent Workspace

Added two complementary context features that minimize per-turn token cost:

- **Wikilink Context** (settings: `expandWikilinkContext`, default on): `[[wikilinks]]` inside mentioned notes are surfaced as resolved file paths via a new `<obsidian_metadata><links>` prelude. Agents see *pointers*, not embedded bodies, and decide which to read. Files: `utils/wikilink-resolver.ts`, `utils/wikilink-formatter.ts`; integrated in `vault-service.ts` and `message-sender.ts`.
- **Agent Workspace** (settings group `agentWorkspace`, default on): A fixed `/Agent-Client/` folder at the vault root with `Focus_Context.md` (curated index, wikilink-decorated), `Resources/` (raw materials, manifest only), and `Agent_Output/YYYY-MM-DD/` (dated output). Shipped to the agent on a seed-then-delta cadence with a per-session `WorkspaceSnapshot`. Files: `services/agent-workspace.ts`, `types/session.ts` (WorkspaceSnapshot + ChatSession.workspaceSnapshot), `services/settings-normalizer.ts` (normalizeWorkspacePath); plumbed through `useAgentSession` (setWorkspaceSnapshot), `useAgentMessages` (post-turn snapshot commit), `useAgent` (facade), and `ChatPanel` (passes `plugin.agentWorkspace`). Bootstrap in `plugin.ts onload`, teardown in `onunload`. Settings UI: new "Agent Workspace" section in `SettingsTab.ts`.

### April 2026: Simplification & Performance Refactoring

Refactored data flow, hooks, services, and performance:

- **ACP wiring**: 3 exit points (onSessionUpdate, onError, setUpdateMessageCallback) → 1 (onSessionUpdate only). Multiple listeners via Set. SessionId filter in AcpHandler.
- **Hook consolidation**: 7 hooks → 4 public hooks. useSession + useMessages + usePermission → useAgent (facade) + useAgentSession + useAgentMessages. useMentions + useSlashCommands → useSuggestions. New: useChatActions, useHistoryModal.
- **ChatPanel slimmed**: 1,483 → 936 lines. Session update routing removed (moved to useAgent). Business callbacks extracted to useChatActions. History modal extracted to useHistoryModal. Workspace events stabilized with refs.
- **Services split**: settings-service.ts (722 lines) → settings-service (285) + session-storage (267) + settings-normalizer (264). Pure functions extracted: message-state.ts, session-state.ts.
- **plugin.ts cleaned**: loadSettings compressed with helper functions (370 → 120 lines). Legacy floatingChatInstances removed. Double-save fixed.
- **Performance**: useMemo on hook returns (useAgent, useSuggestions, useSessionHistory). sessionRef pattern in useAgentSession. Individual method deps in useChatActions. Workspace event handler refs in ChatPanel.
- **Result**: 50 → 56 files, ~19,800 lines. Single event channel. All hooks stabilized.
