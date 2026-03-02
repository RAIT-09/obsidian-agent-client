# Tab Connection Optimization Plan

## Goal
Reduce new-tab startup latency by reusing an existing ACP connection for the same agent and creating only a new ACP session per tab.

## Current Bottleneck
- Each tab owns a separate `AcpAdapter`.
- Creating a new tab triggers full agent process/ACP initialization before `newSession`.

## Target Behavior
- Maintain one shared ACP runtime per agent (initialize once).
- On new tab for that agent, create a fresh session via ACP (`newSession`) without reinitializing the process.
- Keep tab-level session isolation (independent `sessionId`, messages, and state).

## Implementation Steps
1. Introduce an agent-scoped runtime manager in plugin layer:
   - Keyed by `agentId`.
   - Holds initialized ACP runtime/client and lifecycle hooks.
2. Split responsibilities:
   - Runtime lifecycle: shared per agent.
   - Session lifecycle: per tab.
3. Update tab bootstrap flow:
   - Resolve chosen agent.
   - Acquire existing runtime from manager; initialize only if missing.
   - Call `newSession` for tab context.
4. Update cleanup policy:
   - Tab close: close/cancel only that tab session.
   - Runtime stays alive while at least one tab uses that agent.
   - Disconnect runtime when refcount reaches zero or on plugin unload/quit.
5. Preserve error boundaries:
   - Runtime init errors reported once per affected tab.
   - Session creation errors remain tab-scoped.
6. Add tests:
   - New tab on same agent should not reinitialize runtime.
   - New tab should still get unique session IDs.
   - Switching agent creates/uses correct runtime.
   - Runtime teardown respects refcount.

## Validation
- `npm run typecheck`
- `npm run lint`
- `npm run test`

## Risks and Mitigations
- **Cross-tab event leakage**: enforce strict sessionId routing in update handlers.
- **Shared runtime race conditions**: guard runtime init with promise memoization/locking.
- **Unexpected runtime disconnect**: auto-recover by reinitializing runtime and recreating tab session.
