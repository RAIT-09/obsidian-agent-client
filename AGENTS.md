# Agent Client Plugin - LLM Developer Guide

## Overview
Obsidian plugin for AI agent interaction (Claude Code, Codex, Gemini CLI, custom agents) via ACP.

**Tech**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)

## Architecture

```
src/
├── types/                    # Type definitions (no logic, no dependencies)
│   ├── chat.ts               # ChatMessage, MessageContent, PromptContent, AttachedFile
│   ├── session.ts            # ChatSession, SessionUpdate, SessionInfo, Capabilities
│   ├── agent.ts              # AgentConfig, agent settings (Claude/Codex/Gemini/Custom)
│   └── errors.ts             # AcpError, ProcessError, ErrorInfo
├── acp/                      # ACP protocol (SDK dependency confined here)
│   ├── acp-client.ts         # Process lifecycle, UI-facing API (AcpClient class)
│   ├── acp-handler.ts        # SDK event handler (sessionUpdate, permissions, terminals)
│   ├── type-converter.ts     # ACP SDK ↔ internal type conversion
│   ├── permission-handler.ts # Permission queue, auto-approve, Promise resolution
│   └── terminal-handler.ts   # Terminal process create/output/kill
├── services/                 # Business logic (non-React)
│   ├── vault-service.ts      # Vault access + fuzzy search + CM6 selection tracking
│   ├── settings-service.ts   # Settings persistence, session storage, normalization
│   ├── session-helpers.ts    # Agent config building, API key injection (pure functions)
│   ├── message-sender.ts     # Prompt preparation + sending (pure functions)
│   ├── chat-exporter.ts      # Markdown export with frontmatter
│   ├── view-registry.ts      # Multi-view management, focus, broadcast
│   └── update-checker.ts     # Agent/plugin version checking
├── hooks/                    # React custom hooks (state + logic)
│   ├── useSession.ts         # Session lifecycle, config options, optimistic updates
│   ├── useMessages.ts        # Message state, streaming updates, send/receive
│   ├── usePermission.ts      # Permission handling
│   ├── useMentions.ts        # @[[note]] suggestions + auto-mention active note
│   ├── useSlashCommands.ts   # /command suggestions
│   ├── useSessionHistory.ts  # Session list/load/resume/fork
│   └── useSettings.ts        # Settings subscription
├── ui/                       # React components
│   ├── ChatContext.ts        # React Context (plugin, acpClient, vaultService)
│   ├── ChatPanel.tsx         # Hook aggregation + rendering (core orchestrator)
│   ├── ChatView.tsx          # Sidebar view (ItemView wrapper)
│   ├── FloatingChatView.tsx  # Floating window (position/drag/resize)
│   ├── ChatHeader.tsx        # Header (sidebar + floating variants)
│   ├── MessageList.tsx       # Message list with auto-scroll
│   ├── MessageBubble.tsx     # Single message rendering (content dispatch)
│   ├── ToolCallBlock.tsx     # Tool call + diff display
│   ├── TerminalBlock.tsx     # Terminal output polling
│   ├── InputArea.tsx         # Textarea, attachments, mentions, history
│   ├── InputToolbar.tsx      # Mode/model selectors, usage, send button
│   └── ...                   # SuggestionPopup, PermissionBanner, ErrorBanner, etc.
├── utils/                    # Shared utilities
│   ├── platform.ts           # Shell, WSL, Windows env, command building
│   ├── paths.ts              # Path resolution, file:// URI
│   ├── error-utils.ts        # ACP error conversion
│   ├── mention-parser.ts     # @[[note]] detection/extraction
│   └── logger.ts             # Debug-mode logger
├── plugin.ts                 # Obsidian plugin lifecycle, settings persistence
└── main.ts                   # Entry point
```

## Key Components

### ChatPanel (`ui/ChatPanel.tsx`)
Central orchestrator component. Replaces the former `useChatController` hook.
- **Hook Composition**: Calls all hooks (useSession, useMessages, usePermission, etc.)
- **Session Update Routing**: Routes ACP updates to useMessages (message-level) or useSession (session-level)
- **Callback Registration**: Provides IChatViewContainer callbacks via ref pattern
- **Workspace Events**: Handles toggle-auto-mention, new-chat-requested, approve/reject-permission, cancel, export
- **Rendering**: Renders ChatHeader, MessageList, InputArea directly (no prop bag)

### ChatView / FloatingChatView (`ui/ChatView.tsx`, `ui/FloatingChatView.tsx`)
Thin wrappers that:
- Create services (AcpClient, VaultService) in lifecycle methods
- Provide ChatContext (plugin, acpClient, vaultService, settingsService)
- Render `<ChatPanel variant="sidebar" | "floating" />`
- Implement IChatViewContainer for broadcast commands

### Hooks (`hooks/`)

**useSession**: Session lifecycle
- `createSession()`: Build config, inject API keys, initialize + newSession
- `restartSession()`: Change active agent, restart session
- `closeSession()`: Cancel session, disconnect
- `setConfigOption()`: Optimistic update + rollback on error
- `handleSessionUpdate()`: Handle session-level updates (commands, config, usage)

**useMessages**: Messaging and streaming updates
- `sendMessage()`: Prepare (auto-mention, path conversion) → send via AcpClient
- `handleSessionUpdate()`: Handle message-level updates (agent_message_chunk, tool_call, etc.)
- `upsertToolCall()`: Create or update tool call in single `setMessages` callback (avoids race conditions)
- `updateLastMessage()`: Append text/thought chunks to last assistant message
- `updateMessage()`: Update specific message by tool call ID

**usePermission**: Permission handling
- `approvePermission()` / `rejectPermission()`: Respond with selected option
- Auto-approve logic based on settings

**useMentions**: @mention + auto-mention (merged)
- Dropdown state management + selection
- Active note tracking + toggle for slash commands

**useSessionHistory**: Session persistence
- `restoreSession()`: Load/resume with local message fallback
- `forkSession()`: Create new branch from existing session

### ACP Client (`acp/acp-client.ts`) + ACP Handler (`acp/acp-handler.ts`)
Two classes with distinct roles:

**AcpClient** — UI-facing API and process lifecycle:
- spawn() with login shell, JSON-RPC via ndJsonStream
- initialize() → newSession() → sendPrompt() → cancel() → disconnect()
- Session management: listSessions, loadSession, resumeSession, forkSession
- Owns PermissionManager, TerminalManager, AcpHandler

**AcpHandler** — SDK event receiver (called by ClientSideConnection):
- sessionUpdate: converts ACP types → domain types → callback
- requestPermission → PermissionManager
- Terminal operations (create/output/kill/release) → TerminalManager
- Extension notifications (ignored gracefully)

### Services (`services/`)

**VaultService**: Vault access + file index + fuzzy search + CM6 selection tracking
**SettingsService**: Observer pattern settings store, session storage (data.json + sessions/*.json)
**session-helpers**: Pure functions — buildAgentConfigWithApiKey, findAgentSettings, getAvailableAgents
**message-sender**: Pure functions — preparePrompt (auto-mention, context), sendPreparedPrompt (auth retry)

## Types

### SessionUpdate (`types/session.ts`)
Union type for all session update events from the agent:

```typescript
type SessionUpdate =
  | AgentMessageChunk        // Text chunk from agent's response
  | AgentThoughtChunk        // Text chunk from agent's reasoning
  | UserMessageChunk         // Text chunk from user message (session/load)
  | ToolCall                 // New tool call event
  | ToolCallUpdate           // Update to existing tool call
  | Plan                     // Agent's task plan
  | AvailableCommandsUpdate  // Slash commands changed
  | CurrentModeUpdate        // Mode changed
  | SessionInfoUpdate        // Session metadata changed
  | UsageUpdate              // Context window usage
  | ConfigOptionUpdate;      // Config options changed
```

### Key Interfaces

```typescript
// services/vault-service.ts
interface IVaultAccess {
  readNote(path: string): Promise<string>;
  searchNotes(query: string): Promise<NoteMetadata[]>;
  getActiveNote(): Promise<NoteMetadata | null>;
  listNotes(): Promise<NoteMetadata[]>;
}

// services/settings-service.ts
interface ISettingsAccess {
  getSnapshot(): AgentClientPluginSettings;
  updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;
  subscribe(listener: () => void): () => void;
  saveSession(info: SavedSessionInfo): Promise<void>;
  getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[];
  deleteSession(sessionId: string): Promise<void>;
  saveSessionMessages(sessionId: string, agentId: string, messages: ChatMessage[]): Promise<void>;
  loadSessionMessages(sessionId: string): Promise<ChatMessage[] | null>;
  deleteSessionMessages(sessionId: string): Promise<void>;
}
```

## Development Rules

### Architecture
1. **ChatPanel as orchestrator**: All hooks called in ChatPanel, renders children directly
2. **Services for non-React logic**: Pure functions and classes in `services/`
3. **ACP isolation**: All `@agentclientprotocol/sdk` imports confined to `acp/`. AcpClient is UI-facing, AcpHandler is SDK-facing.
4. **Types have zero deps**: No `obsidian`, no SDK, no React in `types/`
5. **Unified callbacks**: Use `onSessionUpdate` for all agent events
6. **Context for services**: plugin, acpClient, vaultService via ChatContext

### Obsidian Plugin Review (CRITICAL)
1. No innerHTML/outerHTML - use createEl/createDiv/createSpan
2. NO detach leaves in onunload (antipattern)
3. Styles in CSS only - no JS style manipulation
4. Use Platform interface - not process.platform
5. Minimize `any` - use proper types

### Naming Conventions
- Types: `kebab-case.ts` in `types/`
- ACP: `kebab-case.ts` in `acp/`
- Services: `kebab-case.ts` in `services/`
- Hooks: `use*.ts` in `hooks/`
- Components: `PascalCase.tsx` in `ui/`
- Utils: `kebab-case.ts` in `utils/`

### Code Patterns
1. React hooks for state management
2. useCallback/useMemo for performance
3. useRef for cleanup function access and stale closure prevention
4. Error handling: try-catch async ops
5. Logging: Logger class (respects debugMode)
6. **Upsert pattern**: Use `setMessages` functional updates to avoid race conditions with tool_call updates
7. **Ref pattern for callbacks**: IChatViewContainer callbacks use refs for latest values
8. **Context value stability**: ChatContext value created once (service instances), wrapped in useMemo

## Common Tasks

### Add New Feature Hook
1. Create `hooks/use[Feature].ts`
2. Define state with useState/useReducer
3. Export functions and state
4. Call the hook in `ui/ChatPanel.tsx`
5. Pass state/callbacks to child components as props

### Add Agent Type
1. Add settings type in `types/agent.ts`
2. Add config and defaults in `plugin.ts`
3. Add API key injection in `services/session-helpers.ts`
4. Update `ui/SettingsTab.ts` for configuration UI

### Modify Message Types
1. Update `ChatMessage`/`MessageContent` in `types/chat.ts`
2. If adding new session update type:
   - Add to `SessionUpdate` union in `types/session.ts`
   - Handle in `hooks/useMessages.ts` `handleSessionUpdate()`
3. Update `acp/acp-handler.ts` `sessionUpdate()` to emit the new type
4. Update `ui/MessageBubble.tsx` `ContentBlock` to render new type

### Add New Session Update Type
1. Define interface in `types/session.ts`
2. Add to `SessionUpdate` union type
3. Handle in `hooks/useMessages.ts` `handleSessionUpdate()` (for message-level)
4. Or handle in `hooks/useSession.ts` `handleSessionUpdate()` (for session-level)
5. Route in `ui/ChatPanel.tsx` session update effect

### Debug
1. Settings → Developer Settings → Debug Mode ON
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs: `[AcpClient]`, `[AcpHandler]`, `[useMessages]`, `[VaultService]`, `[ChatPanel]`

## ACP Protocol

**Communication**: JSON-RPC 2.0 over stdin/stdout

**Methods**: initialize, newSession, authenticate, prompt, cancel, setSessionConfigOption
**Notifications**: session/update (agent_message_chunk, agent_thought_chunk, user_message_chunk, tool_call, tool_call_update, plan, available_commands_update, current_mode_update, session_info_update, usage_update, config_option_update)
**Requests**: requestPermission
**Session Management** (unstable): session/list, session/load, session/resume, session/fork

**Agents**:
- Claude Code: `@zed-industries/claude-agent-acp` (ANTHROPIC_API_KEY)
- Codex: `@zed-industries/codex-acp` (OPENAI_API_KEY)
- Gemini CLI: `@anthropics/gemini-cli-acp` (GEMINI_API_KEY)
- Custom: Any ACP-compatible agent

---

**Last Updated**: March 2026 | **Architecture**: ChatPanel + React Hooks | **Version**: 0.10.0-preview.1
