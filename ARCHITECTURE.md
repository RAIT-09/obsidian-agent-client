# Architecture Documentation

## Overview

This plugin follows **Clean Architecture** principles with clear separation of concerns across multiple layers. The directory structure reflects the architectural boundaries and dependencies flow inward (from outer layers to inner layers).

## Directory Structure

```
src/
├── core/                           # Core Business Logic (innermost layer)
│   ├── domain/                     # Domain Layer
│   │   ├── models/                 # Pure domain models (no dependencies)
│   │   │   ├── agent-config.ts
│   │   │   ├── agent-error.ts
│   │   │   ├── chat-message.ts
│   │   │   └── chat-session.ts
│   │   └── ports/                  # Interfaces (Dependency Inversion)
│   │       ├── agent-client.port.ts
│   │       ├── settings-access.port.ts
│   │       └── vault-access.port.ts
│   └── use-cases/                  # Application Business Rules
│       ├── handle-permission.use-case.ts
│       ├── manage-session.use-case.ts
│       ├── send-message.use-case.ts
│       └── switch-agent.use-case.ts
│
├── adapters/                       # Interface Adapters
│   ├── acp/                        # Agent Client Protocol adapters
│   │   ├── acp.adapter.ts          # Implements IAgentClient port
│   │   └── acp-type-converter.ts   # Converts ACP types to domain types
│   ├── obsidian/                   # Obsidian platform adapters
│   │   ├── vault.adapter.ts        # Implements IVaultAccess port
│   │   ├── settings-store.adapter.ts # Implements ISettingsAccess port
│   │   └── mention-service.ts      # Internal service for file indexing
│   └── view-models/                # Presentation logic (MVVM pattern)
│       └── chat.view-model.ts      # Manages chat UI state
│
├── infrastructure/                 # Frameworks & Drivers (outermost layer)
│   ├── obsidian-plugin/
│   │   └── plugin.ts               # Obsidian plugin entry point
│   └── terminal/
│       └── terminal-manager.ts     # Terminal process management
│
├── presentation/                   # User Interface Layer
│   ├── views/
│   │   └── chat/
│   │       └── ChatView.tsx        # Main chat view component
│   └── components/
│       ├── chat/                   # Chat-specific components
│       │   ├── MessageRenderer.tsx
│       │   ├── ToolCallRenderer.tsx
│       │   ├── TerminalRenderer.tsx
│       │   ├── PermissionRequestSection.tsx
│       │   ├── MentionDropdown.tsx
│       │   └── ... (8 more components)
│       ├── settings/               # Settings UI
│       │   └── AgentClientSettingTab.ts
│       └── shared/                 # Reusable UI components
│           └── HeaderButton.tsx
│
├── shared/                         # Shared Utilities
│   ├── logger.ts                   # Debug logging
│   ├── chat-exporter.ts            # Export functionality
│   ├── mention-utils.ts            # Mention parsing utilities
│   └── settings-utils.ts           # Settings validation
│
└── main.ts                         # Re-exports plugin for Obsidian
```

## Architectural Layers

### 1. Core Layer (`src/core/`)

**Purpose**: Contains pure business logic independent of frameworks and external dependencies.

#### Domain Models (`src/core/domain/models/`)
- **Zero external dependencies** - Pure TypeScript types
- Defines core entities: ChatMessage, ChatSession, AgentError, AgentConfig
- Independent of the ACP protocol library
- Can be used across different implementations

#### Ports (`src/core/domain/ports/`)
- **Interfaces only** - No implementations
- Defines contracts for external dependencies (Dependency Inversion Principle)
- `IAgentClient`: Communication with AI agents
- `IVaultAccess`: File system access
- `ISettingsAccess`: Plugin settings management

#### Use Cases (`src/core/use-cases/`)
- **Application-specific business rules**
- Orchestrates domain models and ports
- Independent of UI and infrastructure
- Examples:
  - `SendMessageUseCase`: Handles message preparation and sending
  - `ManageSessionUseCase`: Manages agent sessions
  - `HandlePermissionUseCase`: Processes permission requests
  - `SwitchAgentUseCase`: Agent switching logic

**Dependency Rule**: Core layer has **zero dependencies** on outer layers.

---

### 2. Adapters Layer (`src/adapters/`)

**Purpose**: Converts between external systems and the core domain.

#### ACP Adapters (`src/adapters/acp/`)
- `acp.adapter.ts`: Implements `IAgentClient` port using ACP library
- `acp-type-converter.ts`: Converts ACP protocol types to domain types
- Isolates ACP library dependency to this directory only

#### Obsidian Adapters (`src/adapters/obsidian/`)
- `vault.adapter.ts`: Implements `IVaultAccess` using Obsidian Vault API
- `settings-store.adapter.ts`: Implements `ISettingsAccess` with reactive store
- `mention-service.ts`: Internal service for file indexing and fuzzy search

#### ViewModels (`src/adapters/view-models/`)
- `chat.view-model.ts`: Presentation logic using MVVM pattern
- Bridges between Use Cases and React UI
- Manages UI state with Observer pattern (useSyncExternalStore)
- Delegates all business logic to Use Cases

**Dependency Rule**: Adapters depend on **Core layer only**.

---

### 3. Infrastructure Layer (`src/infrastructure/`)

**Purpose**: External frameworks and tools.

#### Obsidian Plugin (`src/infrastructure/obsidian-plugin/`)
- `plugin.ts`: Obsidian plugin lifecycle management
- Settings persistence (data.json)
- View registration and ribbon icon
- Update checking

#### Terminal (`src/infrastructure/terminal/`)
- `terminal-manager.ts`: Spawns and manages terminal processes
- Captures stdout/stderr
- Exit code tracking

**Dependency Rule**: Infrastructure depends on **Adapters and Core**.

---

### 4. Presentation Layer (`src/presentation/`)

**Purpose**: User interface components.

#### Views (`src/presentation/views/`)
- `ChatView.tsx`: Main chat interface
- Dependency Injection container (creates Use Cases and ViewModels)
- React hooks for ViewModel integration

#### Components (`src/presentation/components/`)
- **chat/**: Chat-specific UI components (9 components)
- **settings/**: Settings tab UI
- **shared/**: Reusable components (buttons, etc.)

**Dependency Rule**: Presentation depends on **ViewModels and Use Cases**.

---

### 5. Shared Layer (`src/shared/`)

**Purpose**: Cross-cutting utilities used by multiple layers.

- `logger.ts`: Debug logging with settings integration
- `chat-exporter.ts`: Markdown export functionality
- `mention-utils.ts`: Mention parsing (@[[note]] syntax)
- `settings-utils.ts`: Settings validation and normalization

**Dependency Rule**: Shared can be used by **any layer**.

---

## Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Presentation Layer                      │
│  ┌────────────┐  ┌──────────────────────────────────────┐  │
│  │ ChatView   │→ │ ChatViewModel                        │  │
│  │ Components │  │ (adapters/view-models)               │  │
│  └────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              ↓
┌─────────────────────────────┴───────────────────────────────┐
│                     Use Cases Layer                          │
│  ┌─────────────────┐  ┌──────────────────┐                 │
│  │ SendMessage     │  │ ManageSession    │                 │
│  │ HandlePermission│  │ SwitchAgent      │                 │
│  └─────────────────┘  └──────────────────┘                 │
└─────────────────────────────┬───────────────────────────────┘
                              ↓
┌─────────────────────────────┴───────────────────────────────┐
│                      Ports (Interfaces)                     │
│  ┌─────────────────┐  ┌──────────────────┐                 │
│  │ IAgentClient    │  │ IVaultAccess     │                 │
│  │ ISettingsAccess │  └──────────────────┘                 │
│  └─────────────────┘                                        │
└─────────────────────────────┬───────────────────────────────┘
                              ↑ (implements)
┌─────────────────────────────┴───────────────────────────────┐
│                   Adapters (Implementations)                │
│  ┌─────────────────┐  ┌──────────────────┐                 │
│  │ AcpAdapter      │  │ VaultAdapter     │                 │
│  │ SettingsStore   │  │ MentionService   │                 │
│  └─────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────┴───────────────────────────────┐
│                      Domain Models                           │
│  ┌─────────────────┐  ┌──────────────────┐                 │
│  │ ChatMessage     │  │ ChatSession      │                 │
│  │ AgentError      │  │ AgentConfig      │                 │
│  └─────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle**: Dependencies point **inward** (from outer layers to inner layers).

---

## Design Patterns

### 1. Dependency Inversion (Ports & Adapters)
- Core defines interfaces (ports)
- Adapters implement those interfaces
- Core depends on abstractions, not implementations

### 2. MVVM (Model-View-ViewModel)
- **Model**: Domain models + Use Cases
- **ViewModel**: `chat.view-model.ts` (manages UI state)
- **View**: `ChatView.tsx` and components

### 3. Observer Pattern
- `SettingsStore` and `ChatViewModel` use observer pattern
- React components subscribe via `useSyncExternalStore`
- Automatic re-renders on state changes

### 4. Dependency Injection
- `ChatView.tsx` acts as DI container
- Use Cases receive dependencies through constructor
- No global state or singletons

### 5. Strategy Pattern
- Multiple agent adapters (Claude, Gemini, Custom)
- Unified through `IAgentClient` interface

---

## Key Benefits

### 1. Testability
- Each layer can be tested independently
- Mock implementations for ports
- Pure domain logic (no side effects)

### 2. Maintainability
- Clear separation of concerns
- Easy to locate and modify code
- Single Responsibility Principle

### 3. Flexibility
- Swap implementations without changing core logic
- Add new agents by implementing `IAgentClient`
- Replace Obsidian API with minimal changes

### 4. Scalability
- New features added to appropriate layers
- No circular dependencies
- Controlled complexity growth

---

## File Naming Conventions

- **Ports**: `*.port.ts` (e.g., `agent-client.port.ts`)
- **Use Cases**: `*.use-case.ts` (e.g., `send-message.use-case.ts`)
- **Adapters**: `*.adapter.ts` (e.g., `acp.adapter.ts`)
- **ViewModels**: `*.view-model.ts` (e.g., `chat.view-model.ts`)
- **React Components**: PascalCase.tsx (e.g., `ChatView.tsx`)
- **Utilities**: kebab-case.ts (e.g., `mention-utils.ts`)

---

## Adding New Features

### Example: Adding a New Agent

1. **Domain** (if needed): Define new types in `core/domain/models/`
2. **Port**: Use existing `IAgentClient` interface
3. **Adapter**: Create new adapter implementing `IAgentClient`
4. **Settings**: Add configuration to `plugin.ts`
5. **UI**: Update agent selection dropdown

**No changes needed** in Use Cases or Core logic!

---

## Migration Notes

This architecture was established through a major refactoring in October 2025. Key changes:

- **Before**: Monolithic `ChatView.tsx` with mixed concerns
- **After**: Clean separation across 5 layers
- **Result**:
  - Zero legacy code
  - 100% Clean Architecture compliance
  - Improved testability and maintainability

For historical context, see the detailed analysis report in the project documentation.
