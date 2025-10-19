# Agent Client Plugin - LLM Developer Guide

## Overview
Obsidian plugin for AI agent interaction (Claude Code, Gemini CLI, custom agents). **Clean Architecture** (5 layers): Presentation → Adapters → Use Cases → Domain ← Infrastructure.

**Tech**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)

## Architecture

**Dependency Flow**: Inward only. Core domain has zero external dependencies.

```
src/
├── core/domain/              # Pure domain models + ports (interfaces)
│   ├── models/               # agent-config, agent-error, chat-message, chat-session
│   └── ports/                # IAgentClient, ISettingsAccess, IVaultAccess
├── core/use-cases/           # Business logic
│   ├── handle-permission.use-case.ts
│   ├── manage-session.use-case.ts  
│   ├── send-message.use-case.ts
│   └── switch-agent.use-case.ts
├── adapters/                 # Interface implementations
│   ├── acp/                  # ACP protocol (acp.adapter.ts, acp-type-converter.ts)
│   ├── obsidian/             # Platform adapters (vault, settings, mention-service)
│   └── view-models/          # chat.view-model.ts (MVVM)
├── infrastructure/           # External frameworks
│   ├── obsidian-plugin/      # plugin.ts (lifecycle, persistence)
│   └── terminal/             # terminal-manager.ts
├── presentation/             # UI layer
│   ├── views/chat/           # ChatView.tsx (DI container + rendering)
│   └── components/           # chat/, settings/, shared/
└── shared/                   # Utilities (logger, exporter, mention-utils, settings-utils)
```

## Key Components

### ChatView (`presentation/views/chat/ChatView.tsx`)
- **DI Container**: Instantiates Use Cases, Adapters, ViewModel via useMemo
- **Rendering**: Uses useSyncExternalStore for ViewModel state
- **No Business Logic**: Pure UI component

### ChatViewModel (`adapters/view-models/chat.view-model.ts`)
- **State**: messages, session, errorInfo, isSending, mention dropdown
- **Methods** (23): Session mgmt, messaging, permissions, agent switching, mentions
- **Delegates**: All logic to Use Cases
- **Callbacks**: addMessage, updateLastMessage, updateMessage (from AcpAdapter)

### Use Cases (`core/use-cases/`)

**SendMessageUseCase**:
- `prepareMessage()`: Sync - auto-mention, convert @[[note]] → paths
- `sendPreparedMessage()`: Async - send via IAgentClient, auth retry
- Error handling: Ignore "empty response text", auto-retry auth failures

**ManageSessionUseCase**:
- `createSession()`: Load config, inject API keys, initialize + newSession
- `restartSession()`: Cancel old, create new
- `closeSession()`: Call IAgentClient.cancel()

**HandlePermissionUseCase**:
- `approvePermission()`: Respond with selected option
- `shouldAutoApprove()`: Check settings.autoAllowPermissions
- `getAutoApproveOption()`: Select first allow_once/allow_always

**SwitchAgentUseCase**:
- `switchAgent()`: Update settings.activeAgentId
- `getAvailableAgents()`: Return claude, gemini, custom agents

### AcpAdapter (`adapters/acp/acp.adapter.ts`)
Implements IAgentClient + IAcpClient (terminal ops)

- **Process**: spawn() with login shell (macOS/Linux -l, Windows shell:true)
- **Protocol**: JSON-RPC over stdin/stdout via ndJsonStream
- **Flow**: initialize() → newSession() → sendMessage() → sessionUpdate() callbacks
- **Callbacks**: setMessageCallbacks() wires to ViewModel
- **Updates**: agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan
- **Permissions**: Promise-based Map<requestId, resolver>
- **Terminal**: createTerminal, terminalOutput, killTerminal, releaseTerminal

### Obsidian Adapters

**VaultAdapter**: IVaultAccess - searchNotes (fuzzy via NoteMentionService), getActiveNote, readNote
**SettingsStore**: ISettingsAccess - Observer pattern, getSnapshot(), subscribe(), updateSettings()
**MentionService**: File index, fuzzy search (basename, path, frontmatter aliases)

### Terminal Manager (`infrastructure/terminal/terminal-manager.ts`)
- spawn(), capture stdout/stderr (10MB limit), track exit codes
- killTerminal(): SIGTERM → wait → SIGKILL

### Mention System

**Flow**:
1. User types `@` → ChatViewModel.updateMentionSuggestions()
2. detectMention() finds cursor context
3. IVaultAccess.searchNotes() → fuzzy search
4. Display MentionDropdown
5. User selects → replaceMention() → convertMentionsToPath()

**Syntax**: `@[[note name]]` → `/absolute/path/to/note name.md`

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

### Clean Architecture
1. **Dependencies**: Inward only (Presentation → Adapters → Use Cases → Domain)
2. **Domain**: Zero external deps (no `obsidian`, `@zed-industries/agent-client-protocol`)
3. **Use Ports**: Use Cases depend on interfaces, not implementations
4. **No UI Logic**: ChatView/components render only, delegate to ViewModel

### Obsidian Plugin Review (CRITICAL)
1. No innerHTML/outerHTML - use createEl/createDiv/createSpan
2. NO detach leaves in onunload (antipattern)
3. Styles in CSS only - no JS style manipulation
4. Use Platform interface - not process.platform
5. Minimize `any` - use proper types

### Naming Conventions
- Ports: `*.port.ts`
- Use Cases: `*.use-case.ts`
- Adapters: `*.adapter.ts`
- ViewModels: `*.view-model.ts`
- Components: `PascalCase.tsx`
- Utils/Models: `kebab-case.ts`

### Code Patterns
1. Error handling: try-catch async ops
2. Strict typing, avoid `any`
3. React: hooks, useMemo for DI
4. Settings: validate + defaults
5. Logging: Logger class (respects debugMode)

## Common Tasks

### Add Use Case
1. Create `core/use-cases/[name].use-case.ts`
2. Define input/output interfaces
3. Inject ports via constructor
4. Add to ChatViewModel dependencies
5. Call from ChatViewModel method

### Add Agent Type
1. **Optional**: Define config in `core/domain/models/agent-config.ts`
2. **Adapter**: Implement IAgentClient in `adapters/[agent]/[agent].adapter.ts`
3. **Settings**: Add to AgentClientPluginSettings in plugin.ts
4. **UI**: Update AgentClientSettingTab
**No changes in Use Cases/Domain!**

### Modify Message Types
1. Update `ChatMessage`/`MessageContent` in `core/domain/models/chat-message.ts`
2. Update `AcpAdapter.sessionUpdate()` to handle new type
3. Update `MessageContentRenderer` to render new type
4. **Optional**: Update AcpTypeConverter

### Debug
1. Settings → Developer Settings → Debug Mode ON
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs: `[AcpAdapter]`, `[ViewModel]`, `[NoteMentionService]`

**Logged**: Process lifecycle, ACP messages, session state, permissions, terminal ops, errors

## ACP Protocol

**Communication**: JSON-RPC 2.0 over stdin/stdout

**Methods**: initialize, newSession, authenticate, prompt, cancel
**Notifications**: session/update (agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan)
**Requests**: requestPermission

**Agents**:
- Claude Code: `@zed-industries/claude-code-acp` (ANTHROPIC_API_KEY)
- Gemini CLI: `@google/gemini-cli --experimental-acp` (GOOGLE_API_KEY)
- Custom: Any ACP-compatible agent

---

**Last Updated**: October 2025 | **Architecture**: Clean (5-layer) | **Version**: 0.1.7
