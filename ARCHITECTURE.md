# Architecture Documentation

## Overview

This plugin uses **React Hooks + ChatPanel Architecture**. A central `ChatPanel` component composes hooks and renders children directly. Services are injected via React Context. ACP protocol changes are isolated in the `acp/` layer.

## Directory Structure

```
src/
├── types/                          # Type Definitions (no logic)
│   ├── chat.ts                     # ChatMessage, MessageContent, PromptContent, AttachedFile
│   ├── session.ts                  # ChatSession, SessionUpdate, SessionInfo, Capabilities
│   ├── agent.ts                    # AgentConfig, agent settings (Claude/Gemini/Codex/Custom)
│   └── errors.ts                   # AcpError, ProcessError, ErrorInfo
│
├── acp/                            # ACP Protocol Layer (SDK dependency confined here)
│   ├── acp-client.ts               # ACP communication, process lifecycle, IAgentClient
│   ├── type-converter.ts           # ACP SDK types ↔ internal types
│   ├── permission-handler.ts       # Permission queue, auto-approve, Promise resolution
│   └── terminal-handler.ts         # Terminal process create/output/kill
│
├── services/                       # Business Logic (non-React)
│   ├── vault-service.ts            # Vault access + fuzzy search + CM6 selection tracking
│   ├── settings-service.ts         # Settings persistence, session storage, normalization
│   ├── session-helpers.ts          # Agent config building, API key injection (pure functions)
│   ├── message-sender.ts           # Prompt preparation + sending (pure functions)
│   ├── chat-exporter.ts            # Markdown export with frontmatter
│   ├── view-registry.ts            # Multi-view management, focus, broadcast
│   └── update-checker.ts           # Agent/plugin version checking
│
├── hooks/                          # React Custom Hooks (state + logic)
│   ├── useSession.ts               # Session lifecycle, create/close/restart, config options
│   ├── useMessages.ts              # Message state, send/receive, streaming updates
│   ├── usePermission.ts            # Permission request handling
│   ├── useMentions.ts              # @[[note]] suggestions + auto-mention active note
│   ├── useSlashCommands.ts         # /command suggestions
│   ├── useSessionHistory.ts        # Session list/load/resume/fork
│   └── useSettings.ts              # Settings subscription (useSyncExternalStore)
│
├── ui/                             # React Components
│   ├── ChatContext.ts              # React Context (plugin, acpClient, vaultService)
│   ├── ChatPanel.tsx               # Hook aggregation + rendering (replaces useChatController)
│   ├── ChatView.tsx                # Sidebar view (ItemView + Context Provider)
│   ├── FloatingChatView.tsx        # Floating window (position/drag/resize + Context Provider)
│   ├── FloatingButton.tsx          # Draggable launch button
│   ├── ChatHeader.tsx              # Header (sidebar + floating variants)
│   ├── MessageList.tsx             # Message list with auto-scroll
│   ├── MessageBubble.tsx           # Single message (content type dispatch)
│   ├── ToolCallBlock.tsx           # Tool call display + diff
│   ├── TerminalBlock.tsx           # Terminal output polling
│   ├── InputArea.tsx               # Textarea, attachments, mentions, history
│   ├── InputToolbar.tsx            # Mode/model selectors, usage, send button
│   ├── SuggestionPopup.tsx         # Mention/command dropdown
│   ├── PermissionBanner.tsx        # Permission request buttons
│   ├── ErrorBanner.tsx             # Error/notification overlay
│   ├── SessionHistoryModal.tsx     # Session history modal (list + confirm delete)
│   ├── SettingsTab.ts              # Plugin settings UI
│   ├── types.ts                    # IChatViewHost interface
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
| `chat.ts` | ChatMessage, MessageContent (9-type union), Role, ToolCallStatus, ToolKind, AttachedFile, PromptContent |
| `session.ts` | ChatSession, SessionState, SessionUpdate (11-type union), SessionConfigOption, Capabilities, SessionInfo |
| `agent.ts` | AgentEnvVar, BaseAgentSettings, ClaudeAgentSettings, GeminiAgentSettings, CodexAgentSettings |
| `errors.ts` | AcpErrorCode, AcpError, ProcessError, ErrorInfo |

---

### 2. ACP Layer (`src/acp/`)

**Purpose**: Isolate ACP protocol dependency. All `@agentclientprotocol/sdk` imports are confined here.

| File | Purpose |
|------|---------|
| `acp-client.ts` | Process spawn/kill, JSON-RPC communication, session management. Defines `IAgentClient` and `ITerminalClient` interfaces. |
| `type-converter.ts` | Converts ACP SDK types to internal types (change buffer for protocol updates) |
| `permission-handler.ts` | Permission request queue, auto-approve, Promise-based resolution |
| `terminal-handler.ts` | Terminal process create/output/kill, stdout/stderr buffering |

**Key design**: When the ACP protocol changes, only files in this directory need updating.

---

### 3. Services Layer (`src/services/`)

**Purpose**: Non-React business logic. Classes and pure functions.

| File | Purpose |
|------|---------|
| `vault-service.ts` | `VaultService` class — vault note access, fuzzy search, CM6 selection tracking. Exports `IVaultAccess`, `NoteMetadata`, `EditorPosition`. |
| `settings-service.ts` | `SettingsService` class — settings persistence (data.json), session storage (sessions/*.json), observer pattern. Exports `ISettingsAccess`. |
| `session-helpers.ts` | Pure functions — agent config building, API key injection, agent settings resolution |
| `message-sender.ts` | Pure functions — prompt preparation (mention expansion, context building), sending with auth retry |
| `chat-exporter.ts` | `ChatExporter` class — markdown export with frontmatter, image handling |
| `view-registry.ts` | `ChatViewRegistry` class — multi-view focus tracking, broadcast commands. Exports `IChatViewContainer`. |
| `update-checker.ts` | Agent version checking via npm registry |

---

### 4. Hooks Layer (`src/hooks/`)

**Purpose**: React state management. Each hook owns a specific domain of state.

| Hook | Responsibility |
|------|---------------|
| `useSession` | Session lifecycle (create/close/restart), mode/model/configOption, optimistic updates |
| `useMessages` | Message state, streaming updates (agent_message_chunk, tool_call, etc.), send/receive |
| `usePermission` | Permission request detection, approve/reject |
| `useMentions` | @[[note]] dropdown + auto-mention active note tracking (merged) |
| `useSlashCommands` | /command dropdown filtering and selection |
| `useSessionHistory` | Session list/load/resume/fork, local session storage, 5-min cache |
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
  acpClient: AcpAdapter;
  vaultService: VaultService;
  settingsService: SettingsService;
}
```

**ChatPanel** is the central orchestrator:
- Calls all hooks (useSession, useMessages, usePermission, useMentions, useSlashCommands, useSessionHistory, useSettings)
- Manages session update routing (ACP → hooks)
- Handles workspace events, message persistence, cleanup
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
              ├── MessageList
              │     └── MessageBubble (per message)
              │           ├── ToolCallBlock → PermissionBanner
              │           ├── TerminalBlock
              │           └── MarkdownRenderer
              ├── InputArea
              │     ├── SuggestionPopup (mentions / commands)
              │     ├── ErrorBanner
              │     ├── AttachmentStrip
              │     └── InputToolbar (mode/model/usage/send)
              └── SessionHistoryModal (imperative, via ref)
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
│  useSession, useMessages, usePermission, useMentions,        │
│  useSlashCommands, useSessionHistory, useSettings            │
└───────────┬─────────────────────────────┬───────────────────┘
            ↓ calls                       ↓ reads types
┌───────────┴───────────┐   ┌─────────────┴───────────────────┐
│   Services Layer      │   │        Types Layer               │
│   VaultService        │   │   chat.ts, session.ts,           │
│   SettingsService     │   │   agent.ts, errors.ts            │
│   session-helpers     │   └─────────────────────────────────┘
│   message-sender      │
│   chat-exporter       │
│   view-registry       │
└───────────┬───────────┘
            ↓ communicates
┌───────────┴───────────┐
│     ACP Layer         │
│   acp-client.ts       │
│   type-converter.ts   │
│   permission-handler  │
│   terminal-handler    │
└───────────────────────┘
            ↑
    @agentclientprotocol/sdk
```

---

## Design Patterns

### 1. ChatPanel Pattern (Component-as-Orchestrator)
- Central component calls all hooks and renders children directly
- Replaces the "god hook" pattern (useChatController)
- No massive return object — props flow directly to JSX

### 2. React Context for Services
- `ChatContext` provides plugin, acpClient, vaultService, settingsService
- Value is stable (service instances don't change)
- Eliminates prop drilling for shared dependencies

### 3. Custom Hooks for State
- Each hook owns a specific state domain
- Composable and independently testable
- No inter-hook dependencies (communication via ChatPanel)

### 4. ACP Isolation
- All `@agentclientprotocol/sdk` imports confined to `acp/`
- `type-converter.ts` is the change buffer for protocol updates
- Interface types (`IAgentClient`) defined alongside implementation

### 5. Observer Pattern
- `SettingsService` notifies subscribers on change
- React components use `useSyncExternalStore`

### 6. Ref Pattern for Callbacks
- IChatViewContainer callbacks use refs for latest values
- Prevents stale closures in broadcast command handlers
- Unmount cleanup uses refs to access latest state

---

## Key Benefits

### 1. Flat and Readable
- 4 layers (types → acp/services → hooks → ui) instead of 5
- No port/adapter indirection
- File names reflect functionality (MessageBubble, ToolCallBlock, ErrorBanner)

### 2. ACP Change Resistance
- Only `acp/` directory needs changes for protocol updates
- `type-converter.ts` localizes type mapping changes

### 3. Easy Feature Addition
- New hook: create in `hooks/`, call in `ChatPanel`, pass to child
- New message type: add to `types/session.ts`, handle in `useMessages`, render in `MessageBubble`
- New agent: add settings in `plugin.ts`, configure in `SettingsTab`

### 4. Maintainability
- ~20,400 lines across 50 files
- Services testable without React
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

### Adding a New Session Update Type
1. Add interface to `types/session.ts`, add to `SessionUpdate` union
2. Handle in `hooks/useMessages.ts` `handleSessionUpdate()` (for message-level) or `hooks/useSession.ts` (for session-level)
3. Convert from ACP type in `acp/type-converter.ts`
4. Render in `ui/MessageBubble.tsx` if needed

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
