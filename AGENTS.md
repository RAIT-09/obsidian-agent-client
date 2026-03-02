# Obsius - LLM Developer Guide

**Generated:** 2026-03-02 | **Branch:** master

## Overview
Obsidian desktop plugin for AI chat (OpenCode, Claude Code, Codex, Gemini CLI, custom agents). React 19 + TypeScript, communicating via Agent Client Protocol (ACP) over JSON-RPC stdin/stdout. Multi-tab chat sessions in a sidebar view.

## Structure
```
src/
├── main.ts                   # Re-exports plugin.ts
├── plugin.ts                 # Obsidian plugin lifecycle composition root (~458 lines)
├── plugin/                   # Extracted plugin modules
│   ├── agent-ops.ts          # Agent CRUD commands + broadcast helpers (~238 lines)
│   ├── editor-context.ts     # Editor/file context menus + context reference handling (~342 lines)
│   ├── inline-edit.ts        # Inline edit: selection → agent prompt flow (~185 lines)
│   ├── update-check.ts       # GitHub release version check (~56 lines)
│   └── view-helpers.ts       # View creation/focus helpers (~66 lines)
├── domain/                   # Pure types + interfaces — ZERO external deps
│   ├── models/               # ChatMessage, SessionUpdate, AgentConfig, etc. (8 files, ~1056 lines)
│   └── ports/                # IAgentClient, IVaultAccess, ISettingsAccess, IChatViewContainer (4 files, ~771 lines)
├── adapters/
│   ├── acp/                  # ACP protocol modules: lifecycle, runtime ops, routing, terminal, permissions (9 files)
│   └── obsidian/             # VaultAdapter, SettingsStore, MentionService (3 files)
├── hooks/                    # React custom hooks (16 hooks + 5 state modules + 5 extracted modules)
│   ├── state/                # Pure reducer/action modules for deterministic state transitions
│   ├── chat-controller/      # Extracted coordinator helpers (types + session-history-handlers)
│   ├── agent-session/        # Session normalization helpers
│   └── session-history/      # History list/load/restore/fork helpers
├── components/
│   ├── chat/                 # ChatView + sub-components (29 top-level + 12 in chat-input/)
│   ├── picker/               # Unified picker panel for mentions + slash commands (4 files)
│   └── settings/             # Thin tab coordinator + 4 section renderers + helpers
└── shared/                   # Pure utility functions (25 files + message-service/ subdir)
    └── message-service/          # 4 files: prompt-preparation, prompt-context-builders, prompt-sending, types
```

## Where To Look
| Task | Location | Notes |
|------|----------|-------|
| Add new feature | `hooks/use[Feature].ts` → compose in `useChatController.ts` | See `hooks/AGENTS.md` |
| Add agent type | Implement `IAgentClient` in `adapters/[agent]/` | Domain port isolates protocol |
| Modify message types | `domain/models/chat-message.ts` + `session-update.ts` | Then handle in `useChat.handleSessionUpdate()` |
| Change ACP protocol | `adapters/acp/` modules + `acp.adapter.ts` composition | See `adapters/acp/AGENTS.md` |
| UI changes | `components/chat/` | See `components/chat/AGENTS.md` |
| Settings changes | `plugin.ts` (interface) + `components/settings/sections/` (UI sections) | `AgentClientSettingTab.ts` is thin coordinator |
| Add picker provider | `components/picker/` | Implement provider matching `PickerProvider` type |
| Add input UI element | `components/chat/chat-input/` | 12 files: RichTextarea, InputActions, SelectorButton, ContextUsageMeter, etc. |
| Inline edit | `plugin/inline-edit.ts` | Selection → agent prompt with diff viewer |
| Tab management | `hooks/useTabs.ts` + `components/chat/TabBar.tsx` + `TabContent.tsx` | Multi-tab chat sessions |
| Editor context menus | `plugin/editor-context.ts` | Selection, file, folder context references |
| Debug | Settings → Debug Mode ON → DevTools → filter `[AcpAdapter]`, `[useChat]`, `[NoteMentionService]` | |

## Architecture: Distributed Hook Composition

```
ChatView.tsx (ChatComponent)
    ├── useTabs()             → multi-tab management (max 4 tabs)
    ├── useUpdateCheck()      → GitHub release update check
    ├── useWorkspaceEvents()  → workspace hotkey events
    │
    └── per tab → TabContent.tsx
          ├── useSessionRestore()  → session file restoration from disk
          ├── useChatController()  ← Central coordinator (10 hooks)
          │     ├── Creates adapters via useMemo:
          │     │   ├── AcpAdapter (from plugin registry)
          │     │   ├── ObsidianVaultAdapter
          │     │   └── NoteMentionService
          │     └── Composes hooks:
          │           ├── useSettings()          → useSyncExternalStore subscription
          │           ├── useAgentSession()      → session lifecycle, agent switching
          │           ├── useChat()              → messages, streaming, tool calls
          │           ├── usePermission()        → permission request handling
          │           ├── useMentions()          → @[[note]] suggestions
          │           ├── useSlashCommands()     → /command suggestions + token handling
          │           ├── useAutoMention()       → active note tracking
          │           ├── useModelFiltering()    → model search/filter state
          │           ├── useSessionHistory()    → session list, load, resume, fork
          │           └── useSessionHistoryHandlers() → history popover orchestration
          │
          └── ChatInput.tsx
                ├── usePicker()        → unified picker panel (mentions)
                ├── usePicker()        → unified picker panel (commands)
                └── useInputHistory()  → input history navigation
```

## Data Flow
```
User input → ChatInput → useChatController.handleSendMessage()
  → useChat.sendMessage() → preparePrompt() (shared/message-service/prompt-preparation.ts)
    → sendPreparedPrompt() → agentClient.sendPrompt() → ACP JSON-RPC → agent process

Agent response → AcpAdapter.sessionUpdate() → onSessionUpdate callback
  → useChatController routes to:
    → useChat.handleSessionUpdate() (message chunks, tool calls, plans)
    → useAgentSession (available_commands_update, current_mode_update)
  → setMessages() → React re-render

Context references → editor-context.ts → addContextToCurrentChat()
  → ChatViewRegistry.toFocused() → IChatViewContainer.addContextReference()
    → chat-context-token.ts → inline tokens in message text
```

## Conventions

### Architecture Rules
1. **Hooks own state + logic** — no ViewModel/UseCase classes
2. **Pure functions in shared/** — non-React business logic (e.g., `message-service.ts`)
3. **Domain has ZERO deps** — no `obsidian`, no `@agentclientprotocol/sdk` imports in `domain/`
4. **Ports isolate protocol** — `IAgentClient` interface means ACP changes stay in `adapters/acp/`
5. **Unified callbacks** — single `onSessionUpdate` for all agent events, not multiple callbacks
6. **Upsert pattern** — functional `setMessages((prev) => ...)` to avoid race conditions with streaming tool_call_update events
7. **Reducer-backed state** — `hooks/state/` modules for deterministic transitions in `useChat`/`useAgentSession`/`usePermission`

### Obsidian Plugin Rules (CRITICAL)
1. **No innerHTML/outerHTML** — use `createEl`/`createDiv`/`createSpan`
2. **NO detach leaves in onunload** — this is an antipattern
3. **Styles in CSS only** — no JS style manipulation (except font size CSS var and ProviderLogo mask-image)
4. **Use `Platform.isWin/isMacOS/isLinux`** — never `process.platform`
5. **Minimize `any`** — use proper types
6. **Desktop only** — `ChatView` throws if `!Platform.isDesktopApp`

### Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| Ports | `*.port.ts` | `agent-client.port.ts` |
| Adapters | `*.adapter.ts` | `acp.adapter.ts` |
| Hooks | `use*.ts` (camelCase) | `useChat.ts` |
| Components | `PascalCase.tsx` | `ChatView.tsx` |
| Utils/Models | `kebab-case.ts` | `message-service.ts` |
| Input hooks | `use-kebab-case.ts` | `use-chat-input-behavior.ts` |

### Formatting
- Tabs (width 4), double quotes, trailing commas, LF line endings
- Biome: `npm run format` / ESLint + architecture guards: `npm run lint`

## Anti-Patterns (This Project)
- **Don't add ViewModel/UseCase classes** — use hooks
- **Don't import obsidian or ACP SDK in domain/** — zero-dep rule
- **Don't use multiple event callbacks** — use unified `onSessionUpdate`
- **Don't mutate messages directly** — always functional `setMessages((prev) => ...)`
- **Don't detach leaves in `onunload`**
- **Don't use `innerHTML`/`outerHTML`**
- **Don't bypass reducers** — use typed actions in `hooks/state/` for state transitions

## Commands
```bash
npm run dev              # Vite watch build
npm run typecheck        # TypeScript typecheck only
npm run build            # typecheck + Vite production build
npm run lint             # Biome + ESLint + architecture guardrails
npm run lint:fix         # ESLint auto-fix
npm run test             # Vitest
npm run test:coverage    # Vitest + coverage gates (80% lines/functions, 70% branches)
npm run format           # Biome write
npm run format:check     # Biome check
npm run version          # Bump manifest.json + versions.json
npm run docs:dev         # VitePress dev server
npm run docs:build       # VitePress build
```

## Notes
- **Tests exist**: Vitest with coverage gates for reducer/routing/schema modules (test/ directory, 8 test files + setup + mocks/)
- **CI**: PR workflow enforces typecheck, lint, tests with coverage, plugin build, and docs build
- **Multi-session**: `ChatViewRegistry` manages sidebar views with independent ACP sessions
- **Multi-tab**: `useTabs` hook supports up to 4 concurrent chat tabs per view, each with its own agent/session; new tabs inherit the active tab's agent ID
- **Session history**: Agent-side (`listSessions`) + local persistence (`sessions/{id}.json`)
- **Settings validation**: `settings-schema.ts` uses Zod for runtime validation with schema versioning (v4)
- **Context references**: Editor context menus (selection, file, folder) inject `ChatContextReference` tokens into chat input via `chat-context-token.ts`
- **Picker system**: `components/picker/` provides unified `UnifiedPickerPanel` for @mentions and /commands with pluggable providers
- **Inline edit**: `plugin/inline-edit.ts` enables selection-based editing via agent prompt with diff viewer
- **Session restore**: `useSessionRestore` + `session-file-restoration.ts` detect and restore orphaned session files from disk
- **Settings migrations**: `settings-migrations.ts` handles schema version upgrades with typed migration functions
- **Slash command tokens**: `slash-command-token.ts` encodes/decodes slash commands as inline tokens in message text
- **Context usage meter**: `ContextUsageMeter.tsx` displays context window usage as a visual meter in the input area
- **Multi-file mentions**: `@[[...]]` mentions now support `.md`, `.canvas`, `.excalidraw`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`; resolved by full path then basename via `mentionable-files.ts`
- **Image prompt support**: `supportsImage` capability flag; image files are read as binary (`IVaultAccess.readBinaryFile`) and attached as `image` prompt content
- **Agent ID safety**: `resolveExistingAgentId` / `resolveTabAgentId` guard against stale/removed agent IDs at session init and tab creation
- **Loading spinner**: SVG square-dots spinner replaces three-dot pulse in `ChatMessages` while `isSending`
- **CollapsibleSection**: New `collapsible` prop — pass `false` for static (non-expandable) tool call headers when no details exist
- **Model preferences**: `components/settings/sections/model-preferences.ts` provides per-agent model preference configuration
- **Current decomposition state**:
  - `src/plugin.ts` (~458 LOC) is thin orchestrator; command/update/view/context/inline-edit helpers in `src/plugin/`
  - `src/adapters/acp/acp.adapter.ts` (~505 LOC) is composition root; concern modules under `src/adapters/acp/`
  - `ChatView.tsx` (~531 LOC), `ChatInput.tsx` (~619 LOC) — input logic extracted to `chat-input/` (12 files)
  - `SessionHistoryContent.tsx` (~498 LOC) — largest React component
- **Undocumented API**: `vault.adapter.ts` uses `editor.cm` (CodeMirror 6 internal) for selection tracking
- **ACP SDK**: `@agentclientprotocol/sdk ^0.14.1` — protocol may evolve
- **External deps**: `react ^19.2.0`, `diff ^8.0.2`, `semver ^7.7.3`, `zod ^3.24.1`, `@codemirror/state`, `@codemirror/view`
- **Provider logos**: `ProviderLogo.tsx` loads SVGs from `@lobehub/icons-static-svg` CDN via CSS mask-image

## Subdirectory Guides
- [`src/hooks/AGENTS.md`](src/hooks/AGENTS.md) — Hook composition, race condition patterns, data flow
- [`src/components/chat/AGENTS.md`](src/components/chat/AGENTS.md) — Component tree, rendering patterns
- [`src/adapters/acp/AGENTS.md`](src/adapters/acp/AGENTS.md) — ACP protocol, process lifecycle, JSON-RPC
- [`src/shared/AGENTS.md`](src/shared/AGENTS.md) — Utility catalog with consumers
- [`src/domain/AGENTS.md`](src/domain/AGENTS.md) — Domain models, ports, zero-dep rule
