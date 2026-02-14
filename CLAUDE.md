# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Obsidian **desktop-only** plugin for AI agent interaction via [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). Supports Claude Code, Codex, Gemini CLI, and custom agents.

**Tech Stack**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)
**Architecture**: React Hooks (no ViewModels, no Use Cases classes)

## Development Commands

```bash
# Development (watch mode with esbuild)
npm run dev

# Production build (type-check + bundle + minify)
npm run build

# Code quality
npm run lint          # ESLint check
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format with Prettier
npm run format:check  # Check formatting

# Testing
npm run test          # Run all tests once (vitest run)
npm run test:watch    # Run tests in watch mode (vitest)

# Documentation site (VitePress)
npm run docs:dev      # Dev server
npm run docs:build    # Build docs
npm run docs:preview  # Preview built docs

# Version management
npm run version       # Bump version in manifest.json and versions.json
```

**Hot Reload**: During `npm run dev`, Obsidian will auto-reload when `main.js` changes. Use Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux) for DevTools.

## Architecture

**Ports & Adapters with React Hooks**:
- `domain/` - Pure types, zero dependencies (no `obsidian`, no `@agentclientprotocol/sdk`)
- `adapters/` - Platform integrations (ACP, Obsidian vault, settings)
- `hooks/` - State + logic (compose in ChatView.tsx)
- `components/` - UI rendering
- `shared/` - Pure utility functions

```
src/
├── domain/                   # Pure domain models + ports (interfaces)
│   ├── models/               # agent-config, agent-error, chat-message, chat-session,
│   │                         # session-update, chat-input-state, prompt-content, session-info
│   └── ports/                # IAgentClient, ISettingsAccess, IVaultAccess, IChatViewContainer
├── adapters/                 # Interface implementations
│   ├── acp/                  # ACP protocol (acp.adapter.ts, acp-type-converter.ts)
│   └── obsidian/             # Platform adapters (vault, settings, mention-service)
├── hooks/                    # React custom hooks (state + logic)
│   ├── useAgentSession.ts    # Session lifecycle, agent switching
│   ├── useChat.ts            # Message state, streaming updates, session update handling
│   ├── useChatController.ts  # Controller hook for floating chat
│   ├── usePermission.ts      # Permission handling
│   ├── useMentions.ts        # @[[note]] suggestions
│   ├── useSlashCommands.ts   # /command suggestions
│   ├── useAutoMention.ts     # Auto-mention active note
│   ├── useAutoExport.ts      # Auto-export on new/close
│   ├── useInputHistory.ts    # Navigate input history with arrow keys
│   ├── useSessionHistory.ts  # Session history management
│   └── useSettings.ts        # Settings subscription
├── components/               # UI components
│   ├── chat/                 # ChatView, FloatingChatView, ChatHeader, ChatMessages,
│   │                         # ChatInput, MessageRenderer, ToolCallRenderer, etc.
│   └── settings/             # AgentClientSettingTab
├── shared/                   # Utilities (pure functions)
│   ├── message-service.ts    # prepareMessage, sendPreparedMessage (pure functions)
│   ├── terminal-manager.ts   # Process spawn, stdout/stderr capture
│   ├── path-utils.ts         # Path handling
│   ├── shell-utils.ts        # Shell detection
│   ├── wsl-utils.ts          # WSL path conversion
│   ├── logger.ts, chat-exporter.ts, mention-utils.ts, etc.
├── plugin.ts                 # Obsidian plugin lifecycle, settings persistence
└── main.ts                   # Entry point
```

## Key Components

### ChatView (`components/chat/ChatView.tsx`)
Central UI component that orchestrates everything:
- **Hook Composition**: Combines all hooks (useAgentSession, useChat, usePermission, etc.)
- **Adapter Instantiation**: Creates AcpAdapter, VaultAdapter, MentionService via useMemo
- **Callback Registration**: Registers `onSessionUpdate` for unified event handling
- **Rendering**: Delegates to ChatHeader, ChatMessages, ChatInput
- **Desktop-only**: Throws error if `!Platform.isDesktopApp`

### Hooks (`hooks/`)

**useAgentSession**: Session lifecycle
- `createSession()`: Load config, inject API keys, initialize + newSession
- `switchAgent()`: Change active agent, restart session
- `closeSession()`: Cancel session, disconnect
- `updateAvailableCommands()`: Handle slash command updates
- `updateCurrentMode()`: Handle mode change updates

**useChat**: Message state + streaming updates
- `sendMessage()`: Prepare (auto-mention, path conversion) → send via IAgentClient
- `handleNewChat()`: Export if enabled, restart session
- `handleSessionUpdate()`: Unified handler for all session updates (agent_message_chunk, tool_call, etc.)
- `upsertToolCall()`: Create or update tool call using functional `setMessages` (avoids race conditions)
- `updateLastMessage()`: Append text/thought chunks to last assistant message
- `updateMessage()`: Update specific message by tool call ID

**usePermission**: Permission handling
- `handlePermissionResponse()`: Respond with selected option
- Auto-approve logic based on settings

**useMentions / useSlashCommands**: Input suggestions
- Dropdown state management
- Selection handlers

**useInputHistory**: Navigate input history with arrow keys (added v0.8.0)

### AcpAdapter (`adapters/acp/acp.adapter.ts`)
Implements IAgentClient + terminal operations:
- **Process**: spawn() with login shell (macOS/Linux `-l`, Windows `shell:true`)
- **Protocol**: JSON-RPC 2.0 over stdin/stdout via ndJsonStream
- **Flow**: initialize() → newSession() → sendMessage() → sessionUpdate via `onSessionUpdate`
- **Updates**: agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan, available_commands_update, current_mode_update
- **Unified Callback**: Single `onSessionUpdate(callback)` replaces legacy `onMessage`/`onError`/`onPermissionRequest`
- **Permissions**: Promise-based Map<requestId, resolver>
- **Terminal**: createTerminal, terminalOutput, killTerminal, releaseTerminal

### Obsidian Adapters (`adapters/obsidian/`)
**VaultAdapter**: IVaultAccess - searchNotes (fuzzy), getActiveNote, readNote
**SettingsStore**: ISettingsAccess - Observer pattern, getSnapshot(), subscribe()
**MentionService**: File index, fuzzy search (basename, path, aliases)

### Message Service (`shared/message-service.ts`)
Pure functions (non-React):
- `prepareMessage()`: Auto-mention active note, convert `@[[note]]` to paths
- `sendPreparedMessage()`: Send via IAgentClient with auth retry

## Domain Models

### SessionUpdate (`domain/models/session-update.ts`)
Union type abstracting all ACP session update events:

```typescript
type SessionUpdate =
  | AgentMessageChunkUpdate   // Text chunk from agent's response
  | AgentThoughtChunkUpdate   // Text chunk from agent's reasoning
  | ToolCallUpdate            // New tool call event
  | ToolCallUpdateUpdate      // Update to existing tool call
  | PlanUpdate                // Agent's task plan
  | AvailableCommandsUpdate   // Slash commands changed
  | CurrentModeUpdate         // Mode changed
  | ErrorUpdate;              // Error from agent operations
```

This abstracts ACP protocol details, allowing app layer to handle events without depending on ACP specifics.

## Ports (Interfaces)

Domain contracts live in `domain/ports/`:

```typescript
interface IAgentClient {
  initialize(config: AgentConfig): Promise<InitializeResult>;
  newSession(workingDirectory: string): Promise<NewSessionResult>;
  authenticate(methodId: string): Promise<boolean>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  onSessionUpdate(callback: (update: SessionUpdate) => void): void;  // Unified callback
  respondToPermission(requestId: string, optionId: string): Promise<void>;
  isInitialized(): boolean;
  getCurrentAgentId(): string | null;
  setSessionMode(sessionId: string, modeId: string): Promise<void>;
  setSessionModel(sessionId: string, modelId: string): Promise<void>;
}

interface IVaultAccess {
  readNote(path: string): Promise<string>;
  searchNotes(query: string): Promise<NoteMetadata[]>;
  getActiveNote(): Promise<NoteMetadata | null>;
  listNotes(): Promise<NoteMetadata[]>;
}

interface ISettingsAccess {
  getSnapshot(): AgentClientPluginSettings;
  updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;
  subscribe(listener: () => void): () => void;
}
```

## Development Rules

### Architecture (Project-Specific)
1. **Domain isolation**: `domain/` has ZERO dependencies (no `obsidian`, no `@agentclientprotocol/sdk`)
2. **Hooks for state + logic**: Add behavior as hooks in `hooks/`, compose in ChatView.tsx (no ViewModel/UseCase classes)
3. **Pure functions in shared/**: Non-React business logic goes here (see `message-service.ts`)
4. **Ports for protocol resistance**: IAgentClient interface isolates ACP protocol changes
5. **Unified callbacks**: Use `onSessionUpdate` for all agent events (not multiple callbacks)

### Obsidian Plugin Constraints (CRITICAL)
1. **Desktop-only**: Plugin requires `Platform.isDesktopApp` - no mobile support
2. **Platform detection**: Use `Platform.isWin/isMacOS/isLinux` (avoid `process.platform`)
3. **DOM manipulation**: Use `createEl/createDiv/createSpan` (NO `innerHTML/outerHTML`)
4. **Leaf lifecycle**: Don't detach leaves in `onunload` (antipattern)
5. **Styling**: Keep all styles in `styles.css` (avoid JS style manipulation)
6. **Type safety**: Minimize `any`, use proper types

### SessionUpdate / Tool Call Flow (Critical)
- Use unified pipeline: `AcpAdapter.onSessionUpdate(...)` → `useChat.handleSessionUpdate(...)`
- Tool calls MUST use `upsertToolCall(...)` with **functional** `setMessages((prev) => ...)` to avoid race conditions from streaming `tool_call_update` events
- When merging tool-call content: preserve existing values when updates are `undefined`, treat diffs as replace-all (see `mergeToolCallContent` in useChat.ts)

### Naming Conventions
- Ports: `*.port.ts`
- Adapters: `*.adapter.ts`
- Hooks: `use*.ts`
- Components: `PascalCase.tsx`
- Utils/Models: `kebab-case.ts`

### Code Patterns
1. React hooks for state management
2. useCallback/useMemo for performance
3. useRef for cleanup function access
4. Error handling: try-catch async ops
5. Logging: Logger class (respects debugMode setting)
6. **Upsert pattern**: Use `setMessages` functional updates to avoid race conditions

## Common Tasks

### Add New Feature Hook
1. Create `hooks/use[Feature].ts`
2. Define state with useState/useReducer
3. Export functions and state
4. Compose in ChatView.tsx

### Add Agent Type
1. **Optional**: Define config in `domain/models/agent-config.ts`
2. **Adapter**: Implement IAgentClient in `adapters/[agent]/[agent].adapter.ts`
3. **Settings**: Add to AgentClientPluginSettings in plugin.ts
4. **UI**: Update AgentClientSettingTab

### Modify Message Types
1. Update `ChatMessage`/`MessageContent` in `domain/models/chat-message.ts`
2. If adding new session update type:
   - Add to `SessionUpdate` union in `domain/models/session-update.ts`
   - Handle in `useChat.handleSessionUpdate()`
3. Update `AcpAdapter.sessionUpdate()` to emit the new type
4. Update `MessageContentRenderer` to render new type

### Add New Session Update Type
1. Define interface in `domain/models/session-update.ts`
2. Add to `SessionUpdate` union type
3. Handle in `useChat.handleSessionUpdate()` (for message-level updates)
4. Or handle in `ChatView` (for session-level updates like `available_commands_update`)

### Debug
1. Settings → Developer Settings → Debug Mode ON
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs: `[AcpAdapter]`, `[useChat]`, `[NoteMentionService]`

## ACP Protocol

**Communication**: JSON-RPC 2.0 over stdin/stdout

**Methods**: initialize, newSession, authenticate, prompt, cancel, setSessionMode, setSessionModel
**Notifications**: session/update (agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan, available_commands_update, current_mode_update)
**Requests**: requestPermission

**Supported Agents**:
- Claude Code: `@anthropics/claude-code-acp` (requires ANTHROPIC_API_KEY)
- Gemini CLI: `@anthropics/gemini-cli-acp` (requires GOOGLE_API_KEY)
- Codex: `@zed-industries/codex-acp`
- Custom: Any ACP-compatible agent

## Testing

### Framework & Configuration

- **Framework**: Vitest (native ESM + TypeScript, fast, compatible with ACP SDK)
- **React hook testing**: `@testing-library/react` with `jsdom` environment
- **Config**: `vitest.config.ts` (aliases `obsidian` → `tests/__mocks__/obsidian.ts`)
- **Obsidian API mocks**: `tests/__mocks__/obsidian.ts` (minimal stubs for `Platform`, `Plugin`, `TFile`, etc.)

### Test Directory Structure
```
tests/
├── __mocks__/
│   └── obsidian.ts         # Obsidian API stubs
├── helpers/
│   └── mock-factories.ts   # createMockAgentClient(), createMockVaultAccess(), etc.
├── unit/                   # Pure function tests (shared/, domain/, type converters)
├── hooks/                  # React hook tests (useTabManager, useChat, etc.)
└── protocol/               # ACP in-memory stream tests (adapter protocol layer)
```

### Test Layers

| Layer | Target | Mocking | Speed |
|-------|--------|---------|-------|
| **Unit** | `src/shared/`, `src/domain/`, `acp-type-converter.ts` | None | Fast |
| **Hook** | `src/hooks/` | Port interfaces (`IAgentClient`, `IVaultAccess`, `ISettingsAccess`) | Fast |
| **Protocol** | `src/adapters/acp/acp.adapter.ts` | In-memory `TransformStream` pairs via ACP SDK `AgentSideConnection` | Medium |

**Key insight**: The Ports & Adapters architecture means hooks and business logic are testable without any Obsidian API mocking — mock the port interfaces instead.

**ACP protocol testing seam**: The ACP SDK's `Stream` type accepts any `{ writable: WritableStream, readable: ReadableStream }`. Pair `ClientSideConnection` + `AgentSideConnection` over in-memory `TransformStream` pairs to test the full protocol layer without spawning processes.

### Test-Driven User Story Workflow

Implementation follows a two-agent workflow where the **implementation agent** builds features and the **test agent** verifies them:

```
┌─────────────────────┐     ┌─────────────────────┐
│ Implementation Agent│     │    Test Agent        │
│                     │     │  (/test-agent)       │
├─────────────────────┤     ├─────────────────────┤
│ 1. Implement user   │     │                     │
│    story from       │────▶│ 2. Write tests for  │
│    Backlog.md       │     │    acceptance criteria│
│                     │     │                     │
│                     │     │ 3. Run tests         │
│                     │     │    (npm run test)    │
│                     │     │                     │
│ 5. Fix reported     │◀────│ 4. Report bugs with │
│    bugs             │     │    failing tests     │
│                     │     │                     │
│ 6. Re-run           │────▶│ 7. Re-verify        │
│                     │     │                     │
│                     │     │ 8. All tests pass →  │
│                     │     │    Story DONE        │
└─────────────────────┘     └─────────────────────┘
```

**How to use**:
1. Implementation agent completes a user story
2. Run `/test-agent` with the user story reference (e.g., "User Story 1.2")
3. Test agent writes tests for all acceptance criteria, runs them, reports bugs
4. Implementation agent fixes bugs based on the test report
5. Repeat steps 2-4 until test agent reports all tests passing
6. User story is **done** when the test agent confirms zero failures

**Definition of Done**: A user story is complete when the test agent reports `Status: PASSED` with all acceptance criteria covered by passing tests.

**Rules**:
- Test agent **never modifies source code** in `src/` — only writes tests and reports bugs
- Implementation agent **never modifies test files** in `tests/` — only fixes source code
- Tests are committed alongside the implementation (same PR)
- CI runs `npm run test` as part of the pipeline

---

**Version**: 0.8.0 | **License**: Apache-2.0 | **Repository**: [RAIT-09/obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client)