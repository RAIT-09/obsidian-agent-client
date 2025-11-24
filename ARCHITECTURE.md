# Architecture Documentation

## Overview

This plugin uses **React Hooks Architecture** with clear separation of concerns. State and logic are managed by custom hooks, UI by components, and external integrations by adapters.

## Directory Structure

```
src/
├── domain/                         # Domain Layer (innermost)
│   ├── models/                     # Pure domain models (no dependencies)
│   │   ├── agent-config.ts
│   │   ├── agent-error.ts
│   │   ├── chat-message.ts
│   │   └── chat-session.ts
│   └── ports/                      # Interfaces (Dependency Inversion)
│       ├── agent-client.port.ts
│       ├── settings-access.port.ts
│       └── vault-access.port.ts
│
├── hooks/                          # React Custom Hooks (state + logic)
│   ├── useAgentSession.ts          # Session lifecycle, agent switching
│   ├── useChat.ts                  # Message sending, callbacks
│   ├── usePermission.ts            # Permission handling
│   ├── useMentions.ts              # @[[note]] suggestions
│   ├── useSlashCommands.ts         # /command suggestions
│   ├── useAutoMention.ts           # Auto-mention active note
│   ├── useAutoExport.ts            # Auto-export on new/close
│   └── useSettings.ts              # Settings subscription
│
├── adapters/                       # Interface Adapters
│   ├── acp/                        # Agent Client Protocol
│   │   ├── acp.adapter.ts          # Implements IAgentClient port
│   │   └── acp-type-converter.ts   # Converts ACP types to domain
│   └── obsidian/                   # Obsidian platform
│       ├── vault.adapter.ts        # Implements IVaultAccess port
│       ├── settings-store.adapter.ts # Implements ISettingsAccess port
│       └── mention-service.ts      # File indexing, fuzzy search
│
├── components/                     # UI Components
│   ├── chat/                       # Chat UI (14 components)
│   │   ├── ChatView.tsx            # Main view, hook composition
│   │   ├── ChatHeader.tsx
│   │   ├── ChatMessages.tsx
│   │   ├── ChatInput.tsx
│   │   ├── MessageRenderer.tsx
│   │   ├── MessageContentRenderer.tsx
│   │   ├── ToolCallRenderer.tsx
│   │   ├── TerminalRenderer.tsx
│   │   ├── PermissionRequestSection.tsx
│   │   ├── SuggestionDropdown.tsx
│   │   ├── CollapsibleThought.tsx
│   │   ├── MarkdownTextRenderer.tsx
│   │   ├── TextWithMentions.tsx
│   │   └── HeaderButton.tsx
│   └── settings/
│       └── AgentClientSettingTab.ts
│
├── shared/                         # Utilities
│   ├── message-service.ts          # prepareMessage, sendPreparedMessage
│   ├── terminal-manager.ts         # Process spawn, stdout/stderr
│   ├── chat-exporter.ts            # Markdown export
│   ├── mention-utils.ts            # Mention parsing
│   ├── settings-utils.ts           # Settings validation
│   ├── logger.ts                   # Debug logging
│   ├── path-utils.ts               # Path resolution
│   └── wsl-utils.ts                # WSL support
│
├── plugin.ts                       # Obsidian plugin entry point
└── main.ts                         # Re-exports plugin
```

## Architectural Layers

### 1. Domain Layer (`src/domain/`)

**Purpose**: Pure types and interfaces, zero external dependencies.

#### Models (`src/domain/models/`)
- `ChatMessage`: Message structure with content types
- `ChatSession`: Session state, available commands
- `AgentError`: Error types
- `AgentConfig`: Agent configuration

#### Ports (`src/domain/ports/`)
- `IAgentClient`: Agent communication interface
- `IVaultAccess`: File system access interface
- `ISettingsAccess`: Settings management interface

**Dependency Rule**: Zero dependencies on other layers.

---

### 2. Hooks Layer (`src/hooks/`)

**Purpose**: State management and business logic using React hooks.

| Hook | Responsibility |
|------|---------------|
| `useAgentSession` | Session lifecycle, create/close/restart, agent switching |
| `useChat` | Messages state, send/receive, callbacks for AcpAdapter |
| `usePermission` | Permission request handling, auto-approve logic |
| `useMentions` | @[[note]] dropdown state, selection |
| `useSlashCommands` | /command dropdown state, filtering |
| `useAutoMention` | Auto-prepend active note to messages |
| `useAutoExport` | Export chat on new/close |
| `useSettings` | Settings subscription with useSyncExternalStore |

**Dependency Rule**: Hooks depend on Domain (ports/models) and Shared utilities.

---

### 3. Adapters Layer (`src/adapters/`)

**Purpose**: Implement ports, bridge external systems to domain.

#### ACP Adapters (`src/adapters/acp/`)
- `acp.adapter.ts`: Implements `IAgentClient`, manages agent process
- `acp-type-converter.ts`: Converts ACP protocol types to domain types

#### Obsidian Adapters (`src/adapters/obsidian/`)
- `vault.adapter.ts`: Implements `IVaultAccess`
- `settings-store.adapter.ts`: Implements `ISettingsAccess` with observer pattern
- `mention-service.ts`: File indexing, fuzzy search

**Dependency Rule**: Adapters depend on Domain only.

---

### 4. Components Layer (`src/components/`)

**Purpose**: UI rendering, receives state from hooks.

#### ChatView.tsx
- **Hook Composition**: Combines all hooks
- **Adapter Instantiation**: Creates AcpAdapter, VaultAdapter via useMemo
- **Rendering**: Delegates to child components

#### Child Components
- Receive data via props
- Call callbacks from hooks
- No direct business logic

**Dependency Rule**: Components depend on Hooks and Adapters.

---

### 5. Shared Layer (`src/shared/`)

**Purpose**: Cross-cutting utilities.

| File | Purpose |
|------|---------|
| `message-service.ts` | Pure functions: prepareMessage, sendPreparedMessage |
| `terminal-manager.ts` | Process spawn, stdout/stderr capture |
| `chat-exporter.ts` | Export chat to markdown |
| `mention-utils.ts` | Parse @[[note]] syntax |
| `settings-utils.ts` | Validate and normalize settings |
| `logger.ts` | Debug logging (respects debugMode) |

**Dependency Rule**: Can be used by any layer.

---

## Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Components Layer                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ChatView.tsx (hook composition + rendering)            │ │
│  │ ├─ ChatHeader, ChatMessages, ChatInput                 │ │
│  │ └─ MessageRenderer, ToolCallRenderer, etc.             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ uses
┌─────────────────────────────┴───────────────────────────────┐
│                       Hooks Layer                            │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ useAgentSession  │  │ useChat          │                 │
│  │ usePermission    │  │ useMentions      │                 │
│  │ useSlashCommands │  │ useAutoExport    │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────┬───────────────────────────────┘
                              ↓ uses ports
┌─────────────────────────────┴───────────────────────────────┐
│                      Ports (Interfaces)                      │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ IAgentClient    │  │ IVaultAccess     │                  │
│  │ ISettingsAccess │  └──────────────────┘                  │
│  └─────────────────┘                                         │
└─────────────────────────────┬───────────────────────────────┘
                              ↑ implements
┌─────────────────────────────┴───────────────────────────────┐
│                   Adapters (Implementations)                 │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ AcpAdapter      │  │ VaultAdapter     │                  │
│  │ SettingsStore   │  │ MentionService   │                  │
│  └─────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────┴───────────────────────────────┐
│                      Domain Models                           │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ ChatMessage     │  │ ChatSession      │                  │
│  │ AgentError      │  │ AgentConfig      │                  │
│  └─────────────────┘  └──────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Patterns

### 1. Custom Hooks Pattern
- State and logic encapsulated in hooks
- Composable and reusable
- Testable in isolation

### 2. Dependency Inversion (Ports & Adapters)
- Domain defines interfaces (ports)
- Adapters implement those interfaces
- ACP protocol changes isolated to adapters

### 3. Observer Pattern
- `SettingsStore` notifies subscribers on change
- React components use `useSyncExternalStore`

### 4. Pure Functions in Shared
- `message-service.ts`: prepareMessage, sendPreparedMessage
- No React dependencies, easy to test

---

## Key Benefits

### 1. React-idiomatic
- Hooks for state management
- No ViewModel classes
- Standard React patterns

### 2. ACP Change Resistance
- `IAgentClient` interface isolates protocol
- Only `adapters/acp/` needs changes for protocol updates

### 3. Testability
- Hooks can be tested with React Testing Library
- Pure functions in shared/ easily unit tested
- Adapters mockable via ports

### 4. Maintainability
- Clear file locations by responsibility
- Single Responsibility Principle
- ~9,100 lines across 45 files

---

## File Naming Conventions

| Pattern | Example |
|---------|---------|
| Ports | `*.port.ts` |
| Adapters | `*.adapter.ts` |
| Hooks | `use*.ts` |
| Components | `PascalCase.tsx` |
| Utilities | `kebab-case.ts` |

---

## Adding New Features

### Adding a New Hook
1. Create `hooks/use[Feature].ts`
2. Define state with useState/useReducer
3. Export state and functions
4. Compose in ChatView.tsx

### Adding a New Agent
1. Implement `IAgentClient` in `adapters/[agent]/`
2. Add settings to `plugin.ts`
3. Update AgentClientSettingTab

**No changes needed** in hooks or components!

---

## Migration Notes

Refactored from Clean Architecture (MVVM) to React Hooks Architecture in November 2025:

- **Removed**: `core/use-cases/`, `adapters/view-models/`, `infrastructure/`
- **Added**: `hooks/` layer with 8 custom hooks
- **Moved**: `plugin.ts` to src root
- **Result**: Simpler, more React-idiomatic codebase
