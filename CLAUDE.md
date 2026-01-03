# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Obsidian plugin for AI agent interaction** using the Agent Client Protocol (ACP). Enables chatting with Claude Code, Codex, Gemini CLI, and custom agents directly inside Obsidian. Built with React 19 Hooks architecture.

**Tech Stack**: TypeScript, React 19, Obsidian API, Agent Client Protocol SDK v0.11.0, esbuild

## Development Commands

### Build & Development
```bash
npm run dev            # Watch mode with inline sourcemaps
npm run build          # Production build (type check + bundle + minify)
```

### Code Quality
```bash
npm run lint           # Check with ESLint
npm run lint:fix       # Auto-fix ESLint issues
npm run format:check   # Verify Prettier formatting
npm run format         # Auto-format with Prettier
```

### Documentation
```bash
npm run docs:dev       # Run VitePress docs server
npm run docs:build     # Build docs
npm run docs:preview   # Preview built docs
```

### Version Management
```bash
npm run version        # Bump version in manifest.json and versions.json
```

## Architecture Overview

### React Hooks Architecture (Not Clean Architecture)

Migrated from Clean Architecture/MVVM to **React Hooks pattern** in November 2025. State and logic live in custom hooks, not ViewModels or Use Cases classes.

**Core Pattern**: Hooks compose domain logic → Components render UI → Adapters implement ports

```
src/
├── domain/                   # Pure models + ports (zero dependencies)
│   ├── models/               # ChatMessage, ChatSession, AgentConfig, SessionUpdate
│   └── ports/                # IAgentClient, IVaultAccess, ISettingsAccess
├── hooks/                    # State + logic (replaces ViewModels)
│   ├── useAgentSession.ts    # Session lifecycle, agent switching
│   ├── useChat.ts            # Messaging, unified session update handling
│   ├── usePermission.ts      # Permission handling
│   └── use*.ts               # 5 more hooks (mentions, slash commands, auto-export, etc.)
├── adapters/
│   ├── acp/                  # AcpAdapter implements IAgentClient
│   └── obsidian/             # VaultAdapter, SettingsStore, MentionService
├── components/chat/          # UI components (14 React components)
├── shared/                   # Pure utilities (message-service, terminal-manager)
└── plugin.ts                 # Obsidian plugin lifecycle
```

### Key Architectural Decisions

1. **Hooks over ViewModels**: `useAgentSession`, `useChat`, `usePermission` manage state—no class-based ViewModels
2. **Ports for ACP isolation**: `IAgentClient` interface prevents protocol changes from affecting hooks/components
3. **Unified session updates**: Single `onSessionUpdate(callback)` handles all agent events (agent_message_chunk, tool_call, plan, etc.) via domain `SessionUpdate` union type
4. **Pure functions in shared/**: `message-service.ts` has zero React deps for testability
5. **Functional setState updates**: Use `setMessages(prev => ...)` to avoid race conditions with tool_call upserts

## Critical Code Patterns

### SessionUpdate Pattern (Domain-Driven Events)

All agent communication flows through the domain `SessionUpdate` union type in `domain/models/session-update.ts`:

```typescript
type SessionUpdate =
  | AgentMessageChunkUpdate   // Text from agent
  | AgentThoughtChunkUpdate   // Agent reasoning
  | ToolCallUpdate            // New tool call
  | ToolCallUpdateUpdate      // Update existing tool call
  | PlanUpdate                // Task plan
  | AvailableCommandsUpdate   // Slash commands changed
  | CurrentModeUpdate         // Mode changed
  | ErrorUpdate;
```

**Why**: Abstracts ACP protocol, allows type-safe event handling in `useChat.handleSessionUpdate()`.

### Upsert Pattern for Tool Calls

Avoid race conditions by using functional `setState`:

```typescript
setMessages((prevMessages) => {
  const existingIndex = prevMessages.findIndex(m => m.toolCallId === toolCallId);
  if (existingIndex >= 0) {
    // Update existing
    const updated = [...prevMessages];
    updated[existingIndex] = { ...updated[existingIndex], ...updates };
    return updated;
  }
  // Insert new
  return [...prevMessages, newMessage];
});
```

**Why**: Multiple `tool_call_update` events can fire rapidly—functional updates guarantee atomic state transitions.

### Auto-Mention & Path Conversion

`shared/message-service.ts` has pure functions for preparing messages:
- `prepareMessage()`: Auto-prepend active note if enabled, convert `@[[note]]` → absolute paths
- `sendPreparedMessage()`: Send via IAgentClient, retry on auth failure

**Why**: Testable without React, reusable across hooks.

### Observer Pattern for Settings

`adapters/obsidian/settings-store.adapter.ts` implements `ISettingsAccess` with observer pattern. React hooks use `useSyncExternalStore` to subscribe.

## Obsidian Plugin Constraints (CRITICAL)

1. **NO innerHTML/outerHTML**: Use `createEl`, `createDiv`, `createSpan`
2. **NO detach leaves in onunload**: Antipattern—Obsidian handles leaf cleanup
3. **Styles in CSS only**: No JS style manipulation
4. **Use Platform interface**: Not `process.platform` (Obsidian provides cross-platform API)
5. **Minimize `any`**: TypeScript strict mode enabled (`strictNullChecks: true`)

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Ports | `*.port.ts` | `agent-client.port.ts` |
| Adapters | `*.adapter.ts` | `acp.adapter.ts` |
| Hooks | `use*.ts` | `useAgentSession.ts` |
| Components | `PascalCase.tsx` | `ChatView.tsx` |
| Utils/Models | `kebab-case.ts` | `message-service.ts` |

## Code Style (Prettier + ESLint)

- **Tabs**: 4-space tabs
- **Quotes**: Double quotes
- **Semicolons**: Required
- **Line width**: 80 characters
- **Trailing commas**: Always
- **Arrow parens**: Always
- **End of line**: LF (Unix)

ESLint rules:
- Unused args allowed (`@typescript-eslint/no-unused-vars: ["error", { args: "none" }]`)
- TS comments allowed (`@typescript-eslint/ban-ts-comment: "off"`)
- Empty functions allowed (`@typescript-eslint/no-empty-function: "off"`)

## Adding Features

### New Session Update Type
1. Add interface to `domain/models/session-update.ts`
2. Add to `SessionUpdate` union type
3. Handle in `useChat.handleSessionUpdate()` (message-level) OR `ChatView` (session-level like `available_commands_update`)
4. Update `AcpAdapter.sessionUpdate()` to emit the new type

### New Hook
1. Create `hooks/use[Feature].ts` with useState/useReducer
2. Export state and functions
3. Compose in `ChatView.tsx` via `useMemo` or direct call
4. Pass callbacks/state to child components

### New Agent Type
1. **Optional**: Define config in `domain/models/agent-config.ts`
2. Implement `IAgentClient` in `adapters/[agent]/[agent].adapter.ts`
3. Add to `AgentClientPluginSettings` in `plugin.ts`
4. Update `AgentClientSettingTab` UI

## Platform-Specific Notes

### macOS/Linux
- Uses login shell (`-l` flag) for environment variable access
- Node path typically `/usr/local/bin/node` or `/opt/homebrew/bin/node`

### Windows
- Native mode: Uses `shell: true` option
- WSL Mode (recommended): Runs agents in WSL, better compatibility
- Paths: Windows uses `.cmd` files for global npm binaries

WSL detection logic in `src/shared/wsl-utils.ts`.

## Debugging

1. Enable **Settings → Developer Settings → Debug Mode**
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs by `[AcpAdapter]`, `[useChat]`, `[NoteMentionService]`

Logger class respects `debugMode` setting—silent in production unless enabled.

## Build Output

- **Development**: `main.js` with inline sourcemaps
- **Production**: Minified `main.js`, no sourcemaps
- **External deps**: `obsidian`, `electron`, `@codemirror/*` (not bundled)
- **Bundler**: esbuild (ES2018 target, CommonJS format)

## Testing

**No test framework currently configured**. If adding tests:
- Consider Jest or Vitest for React hooks testing
- Use React Testing Library for component tests
- Mock `obsidian` module (not available in Node.js)

## Dependencies

**Runtime**:
- `@agentclientprotocol/sdk@^0.11.0`: ACP client
- `react@^19.1.1`, `react-dom@^19.1.1`: UI
- `semver@^7.7.3`: Version comparison
- `@codemirror/state`, `@codemirror/view`: CodeMirror integration

**Dev**:
- TypeScript 5.9.3 with strict null checks
- ESLint 9 + `eslint-plugin-obsidianmd`
- Prettier 3.4.2
- esbuild 0.17.3
- VitePress 1.6.4 (docs)

## Additional Resources

- **ARCHITECTURE.md**: Detailed layer-by-layer breakdown with diagrams
- **README.md**: User-facing setup instructions
- **Agent Client Protocol**: https://github.com/zed-industries/agent-client-protocol
