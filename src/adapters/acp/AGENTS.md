# ACP Adapter Guide

ACP bridge modules implementing the Agent Client Protocol between domain ports and `@agentclientprotocol/sdk`.

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `acp.adapter.ts` | ~515 | `AcpAdapter` composition root — delegates to shared `AgentRuntime` |
| `agent-runtime-manager.ts` | 205 | Shared runtime management with reference counting |
| `runtime-multiplexer.ts` | 168 | Routes ACP callbacks to correct tab adapter by sessionId |
| `process-lifecycle.ts` | 315 | Spawn/bootstrap/initialize ACP connection and process lifecycle |
| `runtime-ops.ts` | 309 | newSession/auth/sendPrompt/cancel/disconnect/set-mode/set-model |
| `permission-queue.ts` | 219 | Serialized permission queue and response/cancel flow |
| `session-ops.ts` | 195 | list/load/resume/fork session operations with WSL-aware cwd |
| `update-routing.ts` | 113 | ACP session update -> domain `SessionUpdate` mapping |
| `acp-type-converter.ts` | 80 | `AcpTypeConverter` — SDK <-> domain type conversion |
| `terminal-bridge.ts` | 69 | Terminal RPC bridge wrappers |
| `error-diagnostics.ts` | 54 | Stderr hint extraction and startup diagnostics |

## AcpAdapter Class

Implements both `IAgentClient` (domain port) and `IAcpClient` (extended UI interface).

### Key Responsibilities

1. **Composition root**: delegates concern blocks to dedicated modules
2. **Session updates**: `update-routing.ts` maps ACP updates before callback dispatch to hooks
3. **Terminal management**: delegates to `terminal-bridge.ts` and `TerminalManager`
4. **Permission flow**: delegates to `permission-queue.ts` with serialized handling
5. **Silent failure detection**: `promptSessionUpdateCount` + `recentStderr` remain adapter-owned state

### IAcpClient (Extended Interface)

Adds ACP-specific operations beyond domain `IAgentClient`:
- `handlePermissionResponse(requestId, optionId)` — resolve pending permission promise
- `cancelAllOperations()` — abort in-flight requests
- `resetCurrentMessage()` — clear streaming message state
- `terminalOutput(params)` — poll terminal output for `TerminalRenderer`
- `setUpdateMessageCallback(cb)` — wire message update function from `useChat`

## Shared Runtime Architecture

Multiple tabs using the same agent share a single ACP process + connection.

### AgentRuntimeManager (`agent-runtime-manager.ts`)

Manages one `AgentRuntime` per agent with reference counting:
- `acquireRuntime(config, initArgs)` — spawns process or reuses existing (increments refcount)
- `releaseRuntime(agentId)` — decrements refcount, tears down when zero
- `forceDisconnectRuntime(agentId)` — force-kill for "restart agent"
- `disconnectAll()` — cleanup on plugin unload

### RuntimeMultiplexer (`runtime-multiplexer.ts`)

Routes ACP callbacks to the correct tab adapter by `sessionId`:
- Implements `acp.Client` interface for the shared connection
- Each tab adapter registers itself via `registerSession(sessionId, handler)`
- Broadcasts process errors and stderr to all tabs sharing the runtime

### AcpAdapter Changes

Per-tab adapter now:
- Delegates process/connection lifecycle to `AgentRuntimeManager`
- Owns session-scoped state (permissions, terminals, message callbacks)
- Registers with `RuntimeMultiplexer` on `newSession`/`loadSession`/`resumeSession`
- Calls `forceDisconnectRuntime()` on agent restart to ensure fresh process

### Plugin Integration

`plugin.ts` owns the singleton `AgentRuntimeManager`:
- `runtimeManager` property initialized on plugin load
- `disconnectAll()` called on Obsidian quit
- Each tab's adapter receives the manager via constructor

## AcpTypeConverter

Static methods for SDK <-> domain conversion:
- `toToolCallContent(acp.ToolCallContent[])` -> domain `ToolCallContent[]` — filters to `diff` + `terminal` only (ignores `content` type)
- `toAcpContentBlock(PromptContent)` -> `acp.ContentBlock` — handles text, image, resource

## When ACP Protocol Changes

1. Update `@agentclientprotocol/sdk` version
2. Modify `AcpTypeConverter` for new/changed types
3. Update `update-routing.ts` for new ACP notification/session update variants
4. Add/update concern module in `adapters/acp/` and wire through `acp.adapter.ts`
5. Add new `SessionUpdate` variants in `domain/models/session-update.ts`
6. Handle new updates in `useChat.handleSessionUpdate()`

Domain layer (`domain/`) stays untouched unless new domain concepts are needed.

## Anti-Patterns

- Don't import `@agentclientprotocol/sdk` outside this directory (except `TerminalManager` which uses `acp.TerminalOutputRequest`)
- Don't expose ACP SDK types to hooks/components — always convert to domain types first
- Don't add multiple event callbacks — use unified `sessionUpdateCallback`
- Don't re-grow `acp.adapter.ts` into a monolith; new behavior should land in concern modules first
