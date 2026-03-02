# Contributing to Obsius

Obsidian desktop plugin for AI chat with coding agents. React 19 + TypeScript, communicating via Agent Client Protocol (ACP) over JSON-RPC stdin/stdout.

## Quick Start

```bash
cd .obsidian/plugins/obsius
npm install
npm run dev          # Vite watch build → reload Obsidian to test
npm run lint         # Biome + ESLint + architecture guards
npm run test         # Vitest
npm run typecheck    # TypeScript only
```

## Architecture

### Layer Diagram

```mermaid
graph TB
    subgraph Obsidian["Obsidian Host"]
        Plugin["plugin.ts<br/>Plugin lifecycle"]
        Settings["AgentClientSettingTab<br/>Settings UI"]
        EditorCtx["editor-context.ts<br/>Context menus"]
    end

    subgraph UI["React UI Layer"]
        ChatView["ChatView.tsx<br/>ItemView → React root"]
        Components["Components<br/>ChatHeader, TabBar, TabContent,<br/>ChatMessages, ChatInput, ..."]
    end

    subgraph Hooks["Hook Composition Layer"]
        Controller["useChatController<br/>Central coordinator"]
        SubHooks["useAgentSession · useChat<br/>usePermission · useMentions<br/>useSlashCommands · useAutoMention<br/>useSessionHistory · useModelFiltering"]
        ViewHooks["useTabs · useUpdateCheck<br/>useWorkspaceEvents"]
        InputHooks["usePicker · useInputHistory"]
        State["hooks/state/<br/>Reducers + Actions"]
    end

    subgraph Domain["Domain Layer (zero deps)"]
        Models["models/<br/>ChatMessage, SessionUpdate,<br/>ChatSession, AgentConfig, ..."]
        Ports["ports/<br/>IAgentClient, IVaultAccess,<br/>ISettingsAccess, IChatViewContainer"]
    end

    subgraph Adapters["Adapter Layer"]
        ACP["adapters/acp/<br/>AcpAdapter → JSON-RPC"]
        ObsAdapters["adapters/obsidian/<br/>VaultAdapter, SettingsStore,<br/>MentionService"]
    end

    subgraph Shared["Shared Utilities"]
        Utils["message-service, terminal-manager,<br/>chat-view-registry, settings-schema,<br/>chat-context-token, tool-icons, ..."]
    end

    subgraph External["External Processes"]
        Agent["AI Agent<br/>(Claude Code, OpenCode,<br/>Codex, Gemini CLI, custom)"]
    end

    Plugin --> ChatView
    Plugin --> Settings
    Plugin --> EditorCtx
    ChatView --> Components
    Components --> Controller
    Components --> ViewHooks
    Components --> InputHooks
    Controller --> SubHooks
    SubHooks --> State
    SubHooks --> Ports
    Controller --> Utils
    ACP -.->|implements| Ports
    ObsAdapters -.->|implements| Ports
    ACP -->|stdin/stdout<br/>JSON-RPC| Agent
```

### Data Flow

```mermaid
sequenceDiagram
    participant User
    participant ChatInput
    participant Controller as useChatController
    participant Chat as useChat
    participant MsgSvc as message-service
    participant Adapter as AcpAdapter
    participant Agent as AI Agent

    User->>ChatInput: Type message + Enter
    ChatInput->>Controller: handleSendMessage(text, images)
    Controller->>Chat: sendMessage(text, images, context)
    Chat->>MsgSvc: preparePrompt(text, mentions, autoMention)
    MsgSvc-->>Chat: PreparePromptResult (display + agent content)
    Chat->>MsgSvc: sendPreparedPrompt(content)
    MsgSvc->>Adapter: agentClient.sendPrompt(sessionId, content)
    Adapter->>Agent: JSON-RPC prompt

    loop Streaming response
        Agent->>Adapter: session_update (chunks, tool_calls, plans)
        Adapter->>Controller: onSessionUpdate callback
        Controller->>Chat: handleSessionUpdate(update)
        Chat-->>ChatInput: messages[] → React re-render
    end
```

### ACP Process Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Spawning: initialize(config)
    Spawning --> Connected: NDJSON stream ready
    Connected --> Initialized: connection.initialize handshake
    Initialized --> SessionReady: newSession(cwd)
    SessionReady --> Busy: sendPrompt()
    Busy --> SessionReady: end_turn / cancel
    SessionReady --> Authenticating: AUTHENTICATION_REQUIRED
    Authenticating --> SessionReady: authenticate(methodId)
    SessionReady --> Disconnected: disconnect()
    Busy --> Disconnected: process crash
    Disconnected --> [*]
```

### Hook Composition

```mermaid
graph LR
    CV[ChatComponent] --> T[useTabs]
    CV --> UC[useUpdateCheck]
    CV --> WE[useWorkspaceEvents]

    CC[useChatController] --> S[useSettings]
    CC --> AS[useAgentSession]
    CC --> C[useChat]
    CC --> P[usePermission]
    CC --> M[useMentions]
    CC --> SC[useSlashCommands]
    CC --> AM[useAutoMention]
    CC --> MF[useModelFiltering]
    CC --> SH[useSessionHistory]

    CI[ChatInput] --> PK[usePicker x2]
    CI --> IH[useInputHistory]

    TC[TabContent] --> SR[useSessionRestore]

    AS --> SRd[session.reducer]
    C --> CR[chat.reducer]
    P --> PR[permission.reducer]

    CC -.->|creates| ACP[AcpAdapter]
    CC -.->|creates| VA[VaultAdapter]
    CC -.->|creates| MS[MentionService]
```

### Port / Adapter Mapping

```mermaid
graph LR
    subgraph Ports["Domain Ports"]
        IAC[IAgentClient]
        IVA[IVaultAccess]
        ISA[ISettingsAccess]
        ICVC[IChatViewContainer]
    end

    subgraph Adapters
        ACP[AcpAdapter]
        OVA[ObsidianVaultAdapter]
        SS[SettingsStore]
        CV[ChatView]
    end

    ACP -.->|implements| IAC
    OVA -.->|implements| IVA
    SS -.->|implements| ISA
    CV -.->|implements| ICVC
```

## UI Layout

### Main Chat View

```
┌─────────────────────────────────────────────┐
│  ChatHeader                                 │
│  ┌─────────────────────────────────────────┐│
│  │ ▼ Claude Code          [+][⟳][📋][⚙]  ││
│  │  ┌───┬───┬───┐                         ││
│  │  │ 1 │ 2 │ 3 │  ← TabBar (max 4)      ││
│  │  └───┴───┴───┘                         ││
│  └─────────────────────────────────────────┘│
│                                             │
│  TabContent                                 │
│  ┌─────────────────────────────────────────┐│
│  │                                         ││
│  │  ┌─ user ──────────────────────────┐    ││
│  │  │ How do I refactor this module?  │    ││
│  │  └─────────────────────────────────┘    ││
│  │                                         ││
│  │  ┌─ assistant ─────────────────────┐    ││
│  │  │ I'll help you refactor. Let me  │    ││
│  │  │ start by reading the file...    │    ││
│  │  │                                 │    ││
│  │  │ ▶ Read src/module.ts    ✓       │    ││
│  │  │ ▶ Edit src/module.ts    ✓       │    ││
│  │  │   ┌─ diff ────────────────┐     │    ││
│  │  │   │ - old code            │     │    ││
│  │  │   │ + new code            │     │    ││
│  │  │   └───────────────────────┘     │    ││
│  │  │ ▶ Terminal: npm test     ⏳     │    ││
│  │  │   ┌─ output ─────────────┐     │    ││
│  │  │   │ PASS all tests       │     │    ││
│  │  │   └───────────────────────┘     │    ││
│  │  │                                 │    ││
│  │  │ ⚠ Allow edit to config.ts?     │    ││
│  │  │   [Allow once] [Always] [Deny]  │    ││
│  │  └─────────────────────────────────┘    ││
│  │                                         ││
│  │  ┌─ Thinking ──────────────────────┐    ││
│  │  │ ▶ Let me analyze the imports... │    ││
│  │  └─────────────────────────────────┘    ││
│  │                                    [↓]  ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ChatInput                                  │
│  ┌─────────────────────────────────────────┐│
│  │ ┌─ ErrorOverlay (if error) ───────────┐ ││
│  │ │ ⚠ Connection failed — Retry?       │ ││
│  │ └────────────────────────────────────┘ ││
│  │                                         ││
│  │ ┌─ SuggestionDropdown ───────────────┐ ││
│  │ │  notes/architecture.md             │ ││
│  │ │  notes/api-design.md        ← @    │ ││
│  │ │  notes/todo.md                     │ ││
│  │ └───────────────────────────────────┘ ││
│  │                                         ││
│  │ ┌─ ContextBadgeStrip ───────────────┐  ││
│  │ │ 📄 module.ts:12-45  ✕  📝 auto ✕ │  ││
│  │ └──────────────────────────────────┘  ││
│  │                                         ││
│  │ ┌─ RichTextarea ────────────────────┐  ││
│  │ │ Refactor @[[notes/api]] to use... │  ││
│  │ └──────────────────────────────────┘  ││
│  │                                         ││
│  │ ┌─ ImagePreviewStrip ──────────────┐   ││
│  │ │ [🖼 img1.png ✕] [🖼 img2.png ✕] │   ││
│  │ └─────────────────────────────────┘   ││
│  │                                         ││
│  │ ┌─ ContextUsageMeter ─────────────┐   ││
│  │ │ ████████░░░░ 67% context used   │   ││
│  │ └─────────────────────────────────┘   ││
│  │                                         ││
│  │ ┌─ InputActions ───────────────────┐   ││
│  │ │ [💬 Code] [🤖 claude-4]  [Send ▶]│   ││
│  │ └─────────────────────────────────┘   ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### Session History Popover

```
┌─────────────────────────────────────────────┐
│  CONVERSATIONS                          [✕] │
│  ┌─────────────────────────────────────────┐│
│  │ 🔵 Refactor auth module          [⑂][🗑]││
│  │    2 min ago · Claude Code              ││
│  │─────────────────────────────────────────││
│  │ ⚪ Fix CSS layout bug             [⑂][🗑]││
│  │    1 hour ago · OpenCode                ││
│  │─────────────────────────────────────────││
│  │ ⚪ Add unit tests                 [⑂][🗑]││
│  │    yesterday · Codex                    ││
│  └─────────────────────────────────────────┘│
│  [Load more...]                             │
└─────────────────────────────────────────────┘
```

### Settings Tab

```
┌─────────────────────────────────────────────┐
│  Obsius Settings                            │
│                                             │
│  Default Agent: [▼ Claude Code           ]  │
│                                             │
│  ── Core ──────────────────────────────     │
│  Node.js Path:    [/usr/local/bin/node   ]  │
│  Send Shortcut:   [▼ Enter              ]   │
│  Max Note Length:  [10000                ]   │
│  Max Selection:    [10000                ]   │
│                                             │
│  ── Display ───────────────────────────     │
│  View Location:   [▼ Right sidebar tab  ]   │
│  Font Size:       [14                    ]  │
│  Completion Sound: [toggle]                 │
│  Diff Collapse:    [toggle]                 │
│                                             │
│  ── Agents ────────────────────────────     │
│  ▶ OpenCode   [command] [args] [env]        │
│  ▶ Claude     [command] [args] [API key]    │
│  ▶ Codex      [command] [args] [API key]    │
│  ▶ Gemini     [command] [args] [API key]    │
│                                             │
│  ── Model Preferences ───────────────     │
│  Per-agent model preference config          │
│                                             │
│  ── Custom Agents ─────────────────────     │
│  [+ Add Agent]                              │
│  ▶ My Agent   [command] [args] [env]        │
│                                             │
│  ── Developer ─────────────────────────     │
│  Debug Mode:   [toggle]                     │
└─────────────────────────────────────────────┘
```

## Key Concepts

### Agent Client Protocol (ACP)

ACP is a JSON-RPC protocol over stdin/stdout. Obsius spawns an agent process, establishes an NDJSON stream, performs a handshake (`initialize`), then creates sessions and exchanges prompts/responses.

Session updates stream back as typed events: message chunks, tool calls, plans, permission requests, mode/command updates.

### Distributed Hook Composition

Hooks are composed at three levels:
1. **View level** (`ChatComponent`): `useTabs`, `useUpdateCheck`, `useWorkspaceEvents`
2. **Tab level** (`useChatController`): 10 hooks for session, chat, permissions, mentions, commands, history, model filtering
3. **Input level** (`ChatInput`): `usePicker` (×2), `useInputHistory`

Components are pure renderers that receive props from the controller. No ViewModel or UseCase classes.

### Domain Zero-Dep Rule

The `domain/` layer contains only pure TypeScript types and interfaces. It never imports `obsidian`, `@agentclientprotocol/sdk`, or `react`. This keeps the domain stable across protocol and framework changes.

### Reducer-Backed State

State transitions in `useChat`, `useAgentSession`, and `usePermission` use typed reducers in `hooks/state/`. This ensures deterministic updates and makes state logic testable without React.

## Development Workflow

1. **Format**: `npm run format`
2. **Lint**: `npm run lint` (and `npm run lint:fix` if needed)
3. **Test**: `npm run test`
4. **Typecheck**: `npm run typecheck`
5. **Build**: `npm run build`

### Running Tests

```bash
npm run test                          # All tests
npm run test:coverage                 # With coverage gates
npx vitest run -t "should render"     # By test name
npx vitest run test/chat.reducer.test.ts  # By file
```

### Debugging

1. Enable **Debug Mode** in Obsius settings
2. Open DevTools (Ctrl+Shift+I / Cmd+Option+I)
3. Filter console by: `[AcpAdapter]`, `[useChat]`, `[NoteMentionService]`

## Code Style

| Rule | Value |
|------|-------|
| Indentation | Tabs, width 4 |
| Quotes | Double quotes |
| Trailing commas | Yes |
| Line endings | LF |
| Formatter | Biome (`npm run format`) |
| Linter | ESLint + Biome + architecture guards (`npm run lint`) |

## Adding Features

### New Hook
1. Create `src/hooks/useFeature.ts`
2. Wire into `useChatController.ts`
3. Access in components via controller return value

### New Component
1. Create `src/components/chat/MyComponent.tsx`
2. Accept props from `useChatController` return
3. Style in `styles.css`

### New Agent Type
1. Implement `IAgentClient` in `src/adapters/myagent/`
2. Domain port isolates the protocol

### New ACP Event
1. Add `SessionUpdate` variant in `domain/models/session-update.ts`
2. Map in `adapters/acp/update-routing.ts`
3. Handle in `useChat.handleSessionUpdate()`

## Project Structure

See [AGENTS.md](AGENTS.md) for the full directory tree and detailed architecture guide. Subdirectory guides:

- [`src/hooks/AGENTS.md`](src/hooks/AGENTS.md) — Hook composition, race conditions
- [`src/components/chat/AGENTS.md`](src/components/chat/AGENTS.md) — Component tree, rendering
- [`src/adapters/acp/AGENTS.md`](src/adapters/acp/AGENTS.md) — ACP protocol, process lifecycle
- [`src/shared/AGENTS.md`](src/shared/AGENTS.md) — Utility catalog
- [`src/domain/AGENTS.md`](src/domain/AGENTS.md) — Domain models, ports
