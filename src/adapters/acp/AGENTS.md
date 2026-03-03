# ACP Adapter Guide

ACP bridge modules implementing the Agent Client Protocol between domain ports and `@agentclientprotocol/sdk`.

## Files

| File | Purpose |
|------|---------|
| `acp.adapter.ts` | Thin public adapter class implementing `IAgentClient` |
| `acp.adapter-base.ts` | Core implementation/state for session + terminal + permission flow |
| `acp.adapter-delegates.ts` | Delegate helpers for adapter composition |
| `agent-runtime-manager.ts` | Shared runtime management with reference counting |
| `runtime-multiplexer.ts` | Routes ACP callbacks by `sessionId` |
| `process-lifecycle.ts` | Spawn/bootstrap/initialize ACP connection lifecycle |
| `runtime-ops.ts` | newSession/auth/sendPrompt/cancel/disconnect/set-mode/set-model |
| `permission-queue.ts` | Serialized permission queue and response/cancel flow |
| `session-ops.ts` | list/load/resume/fork session operations |
| `update-routing.ts` | ACP session update -> domain `SessionUpdate` mapping |
| `acp-type-converter.ts` | SDK <-> domain type conversion |
| `terminal-bridge.ts` | Terminal RPC bridge wrappers |
| `terminal-manager.ts` | Terminal process lifecycle + output accumulation |
| `terminal-command-policy.ts` | Terminal command safety policy helpers |
| `execute-policy.ts` | Execute tool policy routing |
| `execute-permission-decision.ts` | Execute permission decision helpers |
| `error-diagnostics.ts` | Stderr hint extraction and startup diagnostics |

## AcpAdapter Contract

`AcpAdapter` implements `IAgentClient` only.

Key responsibilities:
1. Translate ACP SDK updates to domain `SessionUpdate`.
2. Manage session lifecycle operations (`newSession`, `loadSession`, `resumeSession`, `forkSession`).
3. Handle permission requests and responses.
4. Expose domain terminal polling via `IAgentClient.getTerminalOutput(terminalId)`.
5. Keep protocol details isolated inside this layer.

## Shared Runtime Architecture

Multiple tabs using the same agent share a single ACP process + connection.

### AgentRuntimeManager
- `acquireRuntime(config, initArgs)` creates/reuses runtime and increments refcount.
- `releaseRuntime(agentId)` decrements refcount and tears down at zero.
- `forceDisconnectRuntime(agentId)` force-kills runtime for restart flows.
- `disconnectAll()` runs on plugin unload.

### RuntimeMultiplexer
- Implements `acp.Client` for a shared connection.
- Registers per-session handlers and routes session updates accordingly.
- Broadcasts process/stderr errors to all tabs sharing the runtime.

## Protocol Boundary Rules

- Keep `@agentclientprotocol/sdk` imports inside `src/adapters/acp/`.
- Do not leak ACP SDK types into `domain/ports/`, hooks, or components.
- Convert protocol payloads to domain models before crossing layer boundaries.
- Extend domain ports first, then implement behavior in this adapter.

## When ACP Protocol Changes

1. Update `@agentclientprotocol/sdk` version.
2. Update `acp-type-converter.ts`.
3. Update `update-routing.ts` for new update shapes.
4. Add/adjust concern modules and wire via adapter base/delegates.
5. Extend domain models/ports where needed.
6. Add tests for routing/conversion/permissions/terminal behavior.

## Anti-Patterns

- Re-growing `acp.adapter.ts` into a monolith.
- Exposing raw ACP SDK types outside this directory.
- Adding new component/hook dependencies on ACP internals.
- Bypassing unified session update routing.
