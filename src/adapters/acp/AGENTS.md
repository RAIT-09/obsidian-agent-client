# ACP Adapter Guide

ACP bridge modules implementing the Agent Client Protocol between domain ports and `@agentclientprotocol/sdk`.

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `acp.adapter.ts` | 505 | `AcpAdapter` composition root implementing `IAgentClient` + `IAcpClient` |
| `process-lifecycle.ts` | 315 | Spawn/bootstrap/initialize ACP connection and process lifecycle wiring |
| `runtime-ops.ts` | 309 | newSession/auth/sendPrompt/cancel/disconnect/set-mode/set-model operations |
| `permission-queue.ts` | 219 | Serialized permission queue and response/cancel flow |
| `session-ops.ts` | 195 | list/load/resume/fork session operations with WSL-aware cwd handling |
| `update-routing.ts` | 113 | Pure ACP session update -> domain `SessionUpdate` mapping |
| `acp-type-converter.ts` | 80 | `AcpTypeConverter` — bidirectional type mapping (ACP SDK <-> domain types) |
| `terminal-bridge.ts` | 69 | Terminal RPC bridge wrappers |
| `error-diagnostics.ts` | 54 | Stderr hint extraction and startup diagnostics helpers |

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

### Platform Handling

- Process command wrapping and environment logic live in `process-lifecycle.ts`
- WSL cwd conversion for session operations lives in `session-ops.ts`
- Login shell resolution on macOS/Linux via `shell-utils.ts`
- Windows PATH enhancement via `windows-env.ts`

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
