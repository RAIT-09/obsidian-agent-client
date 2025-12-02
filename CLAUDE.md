# Agent Client Plugin - LLM Developer Guide

## Overview
Obsidian plugin for AI agent interaction (Claude Code, Gemini CLI, custom agents). **React Hooks Architecture**.

**Tech**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)

## Architecture

```
src/
├── domain/                   # Pure domain models + ports (interfaces)
│   ├── models/               # agent-config, agent-error, chat-message, chat-session, session-update
│   └── ports/                # IAgentClient, ISettingsAccess, IVaultAccess
├── adapters/                 # Interface implementations
│   ├── acp/                  # ACP protocol (acp.adapter.ts, acp-type-converter.ts)
│   └── obsidian/             # Platform adapters (vault, settings, mention-service)
├── hooks/                    # React custom hooks (state + logic)
│   ├── useAgentSession.ts    # Session lifecycle, agent switching
│   ├── useChat.ts            # Message sending, session update handling
│   ├── usePermission.ts      # Permission handling
│   ├── useMentions.ts        # @[[note]] suggestions
│   ├── useSlashCommands.ts   # /command suggestions
│   ├── useAutoMention.ts     # Auto-mention active note
│   ├── useAutoExport.ts      # Auto-export on new/close
│   └── useSettings.ts        # Settings subscription
├── components/               # UI components
│   ├── chat/                 # ChatView, ChatHeader, ChatMessages, ChatInput, etc.
│   └── settings/             # AgentClientSettingTab
├── shared/                   # Utilities
│   ├── message-service.ts    # prepareMessage, sendPreparedMessage (pure functions)
│   ├── terminal-manager.ts   # Process spawn, stdout/stderr capture
│   ├── logger.ts, chat-exporter.ts, mention-utils.ts, etc.
├── plugin.ts                 # Obsidian plugin lifecycle, settings persistence
└── main.ts                   # Entry point
```

## Key Components

### ChatView (`components/chat/ChatView.tsx`)
- **Hook Composition**: Combines all hooks (useAgentSession, useChat, usePermission, etc.)
- **Adapter Instantiation**: Creates AcpAdapter, VaultAdapter, MentionService via useMemo
- **Callback Registration**: Registers `onSessionUpdate` for unified event handling
- **Rendering**: Delegates to ChatHeader, ChatMessages, ChatInput

### Hooks (`hooks/`)

**useAgentSession**: Session lifecycle
- `createSession()`: Load config, inject API keys, initialize + newSession
- `switchAgent()`: Change active agent, restart session
- `closeSession()`: Cancel session, disconnect
- `updateAvailableCommands()`: Handle slash command updates
- `updateCurrentMode()`: Handle mode change updates

**useChat**: Messaging and session update handling
- `sendMessage()`: Prepare (auto-mention, path conversion) → send via IAgentClient
- `handleNewChat()`: Export if enabled, restart session
- `handleSessionUpdate()`: Unified handler for all session updates (agent_message_chunk, tool_call, etc.)
- `upsertToolCall()`: Create or update tool call in single `setMessages` callback (avoids race conditions)
- `updateLastMessage()`: Append text/thought chunks to last assistant message
- `updateMessage()`: Update specific message by tool call ID

**usePermission**: Permission handling
- `handlePermissionResponse()`: Respond with selected option
- Auto-approve logic based on settings

**useMentions / useSlashCommands**: Input suggestions
- Dropdown state management
- Selection handlers

### AcpAdapter (`adapters/acp/acp.adapter.ts`)
Implements IAgentClient + IAcpClient (terminal ops)

- **Process**: spawn() with login shell (macOS/Linux -l, Windows shell:true)
- **Protocol**: JSON-RPC over stdin/stdout via ndJsonStream
- **Flow**: initialize() → newSession() → sendMessage() → sessionUpdate via `onSessionUpdate`
- **Updates**: agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan, available_commands_update, current_mode_update
- **Unified Callback**: Single `onSessionUpdate(callback)` replaces legacy `onMessage`, `onError`, `onPermissionRequest`
- **Permissions**: Promise-based Map<requestId, resolver>
- **Terminal**: createTerminal, terminalOutput, killTerminal, releaseTerminal

### Obsidian Adapters (`adapters/obsidian/`)

**VaultAdapter**: IVaultAccess - searchNotes (fuzzy), getActiveNote, readNote
**SettingsStore**: ISettingsAccess - Observer pattern, getSnapshot(), subscribe()
**MentionService**: File index, fuzzy search (basename, path, aliases)

### Message Service (`shared/message-service.ts`)
Pure functions (non-React):
- `prepareMessage()`: Auto-mention, convert @[[note]] → paths
- `sendPreparedMessage()`: Send via IAgentClient, auth retry

## Domain Models

### SessionUpdate (`domain/models/session-update.ts`)
Union type for all session update events from the agent:

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

This domain type abstracts ACP's `SessionNotification.update.sessionUpdate` values, allowing the application layer to handle events without depending on ACP protocol specifics.

## Ports (Interfaces)

```typescript
interface IAgentClient {
  initialize(config: AgentConfig): Promise<InitializeResult>;
  newSession(workingDirectory: string): Promise<NewSessionResult>;
  authenticate(methodId: string): Promise<boolean>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;

  // Unified callback for all session updates
  onSessionUpdate(callback: (update: SessionUpdate) => void): void;

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

### Architecture
1. **Hooks for state + logic**: No ViewModel, no Use Cases classes
2. **Pure functions in shared/**: Non-React business logic
3. **Ports for ACP resistance**: IAgentClient interface isolates protocol changes
4. **Domain has zero deps**: No `obsidian`, `@agentclientprotocol/sdk`
5. **Unified callbacks**: Use `onSessionUpdate` for all agent events (not multiple callbacks)

### Obsidian Plugin Review (CRITICAL)
1. No innerHTML/outerHTML - use createEl/createDiv/createSpan
2. NO detach leaves in onunload (antipattern)
3. Styles in CSS only - no JS style manipulation
4. Use Platform interface - not process.platform
5. Minimize `any` - use proper types

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
5. Logging: Logger class (respects debugMode)
6. **Upsert pattern**: Use `setMessages` functional updates to avoid race conditions with tool_call updates

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

**Agents**:
- Claude Code: `@anthropics/claude-code-acp` (ANTHROPIC_API_KEY)
- Gemini CLI: `@anthropics/gemini-cli-acp` (GOOGLE_API_KEY)
- Custom: Any ACP-compatible agent

---

**Last Updated**: December 2025 | **Architecture**: React Hooks | **Version**: 0.4.0
