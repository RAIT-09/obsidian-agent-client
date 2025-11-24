# Agent Client Plugin - LLM Developer Guide

## Overview
Obsidian plugin for AI agent interaction (Claude Code, Gemini CLI, custom agents). **React Hooks Architecture**.

**Tech**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)

## Architecture

```
src/
├── domain/                   # Pure domain models + ports (interfaces)
│   ├── models/               # agent-config, agent-error, chat-message, chat-session
│   └── ports/                # IAgentClient, ISettingsAccess, IVaultAccess
├── adapters/                 # Interface implementations
│   ├── acp/                  # ACP protocol (acp.adapter.ts, acp-type-converter.ts)
│   └── obsidian/             # Platform adapters (vault, settings, mention-service)
├── hooks/                    # React custom hooks (state + logic)
│   ├── useAgentSession.ts    # Session lifecycle, agent switching
│   ├── useChat.ts            # Message sending, callbacks
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
- **Rendering**: Delegates to ChatHeader, ChatMessages, ChatInput

### Hooks (`hooks/`)

**useAgentSession**: Session lifecycle
- `createSession()`: Load config, inject API keys, initialize + newSession
- `switchAgent()`: Change active agent, restart session
- `closeSession()`: Cancel session, disconnect

**useChat**: Messaging
- `sendMessage()`: Prepare (auto-mention, path conversion) → send via IAgentClient
- `handleNewChat()`: Export if enabled, restart session
- Callbacks: addMessage, updateLastMessage, updateMessage

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
- **Flow**: initialize() → newSession() → sendMessage() → sessionUpdate() callbacks
- **Updates**: agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan, available_commands_update
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

## Ports (Interfaces)

```typescript
interface IAgentClient {
  initialize(config: AgentConfig): Promise<InitializeResult>;
  newSession(workingDirectory: string): Promise<NewSessionResult>;
  authenticate(methodId: string): Promise<boolean>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(callback: (message: ChatMessage) => void): void;
  onError(callback: (error: AgentError) => void): void;
  onPermissionRequest(callback: (request: PermissionRequest) => void): void;
  respondToPermission(requestId: string, optionId: string): Promise<void>;
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
2. Update `AcpAdapter.sessionUpdate()` to handle new type
3. Update `MessageContentRenderer` to render new type

### Debug
1. Settings → Developer Settings → Debug Mode ON
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs: `[AcpAdapter]`, `[useChat]`, `[NoteMentionService]`

## ACP Protocol

**Communication**: JSON-RPC 2.0 over stdin/stdout

**Methods**: initialize, newSession, authenticate, prompt, cancel
**Notifications**: session/update (agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan, available_commands_update)
**Requests**: requestPermission

**Agents**:
- Claude Code: `@anthropics/claude-code-acp` (ANTHROPIC_API_KEY)
- Gemini CLI: `@anthropics/gemini-cli-acp` (GOOGLE_API_KEY)
- Custom: Any ACP-compatible agent

---

**Last Updated**: November 2025 | **Architecture**: React Hooks | **Version**: 0.3.0
