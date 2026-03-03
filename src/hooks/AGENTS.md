# Hooks Layer Guide

Distributed composition pattern: `useChatController` composes specialized hooks and obtains per-tab dependencies via `plugin.createChatSessionDependencies(sessionKey)`. View-level hooks (`useTabs`, `useUpdateCheck`, `useWorkspaceEvents`) live in `ChatComponent`. Input-level hooks (`usePicker`, `useInputHistory`) live in `ChatInput`. `useSessionRestore` lives in `TabContent`.

State transitions are reducer-backed in `src/hooks/state/` for deterministic updates and easier test coverage.

## Dependency Rules (CRITICAL)

**Hooks MUST only depend on:**
- `domain/ports/` — interface types (`IAgentClient`, `IVaultAccess`, `ISettingsAccess`)
- `domain/models/` — data types (`ChatMessage`, `SessionUpdate`, `ChatSession`, etc.)
- `shared/` — pure utility functions only
- Other hooks in this directory

**Hooks MUST NOT import from:**
- `adapters/` — **NEVER** import concrete adapter classes (`AcpAdapter`, `ObsidianVaultAdapter`, `NoteMentionService`)

**If a hook needs a method not on `IAgentClient`:** The correct fix is to promote that method to the `IAgentClient` Port interface in `domain/ports/agent-client.port.ts`, NOT to import the adapter type.

**Verification:**
```bash
grep -rn 'from.*adapters/' src/hooks/ | grep -v AGENTS.md  # MUST return 0 results
```

There are currently no known adapter-boundary violations in `src/hooks/`.

## Hook Inventory

| Hook | Lines | State Owned | Key Deps | Composed In |
|------|-------|-------------|----------|-------------|
| `useChatController` | 536 | Combines 10 hooks below | All hooks + adapters | `TabContent` |
| `useAgentSession` | 628 | `ChatSession`, connection lifecycle | `IAgentClient`, `ISettingsAccess` | `useChatController` |
| `useChat` | 553 | `messages[]`, `isSending`, streaming | `IAgentClient`, `IVaultAccess` | `useChatController` |
| `useSessionHistory` | 577 | Session list, load/resume/fork | `IAgentClient`, `ISettingsAccess` | `useChatController` |
| `usePicker` | 268 | Picker panel open/selection state | `PickerProvider[]` | `ChatInput` (×2) |
| `usePermission` | 234 | `activePermission`, approval queue | `IAgentClient` | `useChatController` |
| `useSlashCommands` | 150 | Suggestions dropdown + token handling | `SlashCommand[]` | `useChatController` |
| `useSessionRestore` | ~190 | Thin React wrapper around `SnapshotManager`; exposes change set state + revert/keep/dismiss; triggers disk comparison on every messages update | `SnapshotManager` | `TabContent` |
| `useTabs` | ~185 | `tabs[]`, `activeTabId` (max 4); inherits active tab's agent when opening new tabs | `ChatTab`, agent info | `ChatComponent` |
| `useInputHistory` | 139 | History index (ref-based) | `ChatMessage[]` | `ChatInput` |
| `useMentions` | 130 | Suggestions dropdown state | `IVaultAccess`, `mention-utils` | `useChatController` |
| `useWorkspaceEvents` | 127 | None (effect-only) | `Workspace` events | `ChatComponent` |
| `useModelFiltering` | 98 | Model search/filter state | `SessionModelState` | `useChatController` |
| `useAutoMention` | 76 | `activeNote`, `isDisabled` | `IVaultAccess` | `useChatController` |
| `useSettings` | 19 | None — delegates to `useSyncExternalStore` | `plugin.settingsStore` | `useChatController` |
| `useUpdateCheck` | 19 | Update available flag | Plugin version | `ChatComponent` |

## Composition Flow

```
ChatComponent (ChatView.tsx)
  ├── useTabs(initialAgentId, defaultAgentId, availableAgents, onTabClose)
  ├── useUpdateCheck(plugin)
  └── useWorkspaceEvents({ workspace, handlers })

  per tab → TabContent.tsx
    ├── useSessionRestore()
    └── useChatController(options: UseChatControllerOptions)
          ├── plugin.createChatSessionDependencies(sessionKey)
          │    ├── agentClient: IAgentClient
          │    ├── vaultAccess: IVaultAccess
          │    └── mentionService: IMentionService
          ├── useSettings(plugin)
          ├── useAgentSession(agentClient, settingsAccess, vaultPath, initialAgentId)
          ├── useChat(agentClient, vaultAccess, mentionService, sessionConfig, displayConfig)
          ├── usePermission(agentClient, messages)
          ├── useMentions(vaultAccess, plugin)
          ├── useSlashCommands(session.availableCommands)
          ├── useAutoMention(vaultAccess)
          ├── useModelFiltering(session.availableModels)
          ├── useSessionHistory({ agentClient, session, settingsAccess, cwd, callbacks })
          └── useSessionHistoryHandlers(app, sessionHistory, logger, vaultPath, clearMessages)

  ChatInput.tsx
    ├── usePicker(mentionProvider)
    ├── usePicker(commandProvider)
    └── useInputHistory(messages)
```

## Extracted Hook Modules

- `chat-controller/types.ts` (85): exported `UseChatControllerOptions` + `UseChatControllerReturn` interfaces
- `chat-controller/session-history-handlers.ts` (132): isolated history restore/fork/delete/open handler orchestration (popover state)
- `agent-session/helpers.ts` (~160) + `agent-session/types.ts` (39): normalization and shared type contracts; includes `resolveExistingAgentId` for safe agent ID resolution against available agents list
- `session-history/session-history-ops.ts` (221): pure history list/load/restore/fork helpers

## State Modules (`hooks/state/`)

| File | Lines | Purpose |
|------|-------|---------|
| `chat.reducer.ts` | 50 | Chat message state reducer (apply_messages, set_messages, clear) |
| `chat.actions.ts` | 29 | Action creators for chat state transitions |
| `session.reducer.ts` | 28 | Session state reducer |
| `session.actions.ts` | 22 | Action creators for session state transitions |
| `permission.reducer.ts` | 35 | Permission request queue reducer |

### State Management Constraints

1. **All session phase changes must go through `SessionState` enum** — the canonical phases are: `initializing | authenticating | ready | busy | error | disconnected`. Do NOT invent new boolean flags to represent phases.
2. **Derive booleans from enum state** — e.g., `const isReady = session.state === "ready"`. Never store `isReady` as separate state.
3. **Exhaustive switch in every reducer** — the `default` case must use `const exhaustiveCheck: never = action` to catch unhandled actions at compile time.
4. **No direct setState for phase-related fields** — always dispatch a typed action. This makes state transitions auditable and testable.
5. **If a new operational phase is needed** (e.g., "loading_history", "forking_session"), add it to `SessionState` in `domain/models/chat-session.ts` and handle it in the reducer. Do NOT add `isLoadingHistory: boolean` alongside the enum.

## Race Condition Patterns

**Agent switch staleness**: `useAgentSession.createSession` uses a `creationCounterRef` to discard stale async results when the user switches agents before the previous session is ready.

**Streaming tool_call_update**: Multiple rapid updates arrive for the same tool call. `useChat` uses reducer actions with updater payloads (`apply_messages`) and `upsertToolCall()` merge logic. Non-functional replacement would lose concurrent updates.

**mergeToolCallContent**: When merging tool call updates, preserve existing values when update fields are `undefined`. Treat content arrays as replace-all (not append).

**Session load history replay**: During `session/load`, the agent replays history as `user_message_chunk` + `agent_message_chunk` events. `useChat` has `isLoadingRef` flag to batch these without triggering intermediate re-renders.

**Stale closure in handleNewChat**: `useChatController.handleNewChat` is stored in a tab-actions map that may hold an older closure. A `messagesRef` (updated on every render) is used instead of the raw `messages` array to avoid checking a stale value when deciding whether to show "Already a new session".

**Agent ID resolution**: `resolveExistingAgentId` (in `agent-session/helpers.ts`) and `resolveTabAgentId` (in `useTabs.ts`) guard against using a stale/removed agent ID by falling back to the default or first available agent. Used in `useAgentSession.init`, `useAgentSession.createSession`, and `useTabs` initial state + new tab creation.

- `handleSessionUpdate`: Routes `SessionUpdate` union to `useChat.handleSessionUpdate()` (messages) and `useAgentSession` (commands, modes)
- `handleSendMessage`: Orchestrates `useChat.sendMessage()` with autoMention state, images, vault path
- `handleNewChat`: Calls `useAgentSession.createSession()`, clears messages and input state
- `handleLoadSession`: Coordinates `useSessionHistory` + `useChat.setMessagesFromLocal()`
- `handleRestartAgent`: Calls `agentSession.forceRestartAgent()` to ensure a fresh process

## Adding a New Hook

1. Create `src/hooks/useFeature.ts` — own its state, export typed return interface
2. Wire into `useChatController.ts` — add to composition, expose in return object
3. Access in components via `useChatController()` return value
4. Never import hooks directly in components — always go through the controller (exception: view-level hooks like `useTabs`, input-level hooks like `usePicker`)

## Anti-Patterns

- **Don't bypass reducers** for state transitions in `useChat` / `useAgentSession` / `usePermission`
- **Don't store derived state** — compute from `messages` or `session` in components
- **Don't call `agentClient` directly from components** — route through hooks
- **Don't add new callback-style mutation paths** when a typed action in `src/hooks/state/` is appropriate
- **Don't import from `adapters/`** — use Port interfaces from `domain/ports/` (see Dependency Rules above)
- **Don't expose adapter-specific types in return interfaces** — `UseChatControllerReturn` should reference domain Port types only
- **Don't add `isXxx: boolean` flags for new phases** — extend `SessionState` enum instead
- **Don't create new reducers without exhaustive `never` checks** — this is a compile-time safety net against unhandled actions
