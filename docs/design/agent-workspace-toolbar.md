# Agent Workspace Toolbar Toggle — Design

**Status:** Proposed
**Owner:** TBD
**Last updated:** 2026-05-08

## 1. Problem

The Agent Workspace feature is enabled/disabled via a checkbox buried in the
plugin settings tab. Two friction points:

1. **Discoverability.** Users have to open settings to know the feature
   exists or to flip it on. The toggle is invisible during normal chat use.
2. **Cost of context.** When enabled, the workspace prelude (and now the
   auto-mention payload — see `auto-mention-context.md`) is shipped to the
   agent. There's no in-context way for a user to say "this turn I don't
   want the workspace prelude" without leaving the chat to dig through
   settings.

A toolbar-level toggle puts the control next to the place the user notices
the cost (the chat input + send button) and makes the feature's status
visible at a glance.

## 2. Goals & non-goals

### Goals
- Move the **enable/disable** control from settings to the chat input
  toolbar, immediately to the left of the send button.
- Visual state communicates current status: lit up (`--interactive-accent`)
  when on, muted (`--text-muted`) when off — same pattern as the
  send-button color states.
- Persist the toggle state via the existing
  `settings.agentWorkspace.enabled` field (no schema change).
- Both the sidebar and floating chat views reflect and control the same
  setting (reactive via `useSettings`).
- Toggling triggers `plugin.refreshAgentWorkspace()` so the workspace
  service bootstraps/teardowns immediately.

### Non-goals (for v1)
- Per-session override (a session-level toggle that ignores the global
  setting). The global setting + reactive update is sufficient.
- Hiding/disabling the dependent settings (path, emit instructions,
  agent-assisted updates) when disabled. They stay visible and inert —
  same as today's behavior when the master toggle is off.
- Visual indicator of bootstrap progress. Bootstrap is fast and silent;
  failure cases already log to console.
- Migrating the toggle into a global plugin command palette command.
  Possible v2 follow-up.

## 3. Decisions log

### D1. Toolbar placement: immediately left of the send button
The toolbar's right cluster currently reads, left to right:
`[usage indicator] … [config / mode / model selectors] [send button]`.
Insert the brain icon as the last element before send: `[…] [brain] [send]`.
Rationale: the toggle and the send action are both per-turn-ish controls.
Grouping them right-aligned keeps the eye flow consistent. Far-left
placement (next to the usage indicator) was rejected as visually
disconnected from the action cluster.

### D2. Visual states match the send-button convention
- **Enabled:** SVG `color: var(--interactive-accent)`
- **Disabled:** SVG `color: var(--text-muted)`
- Background: transparent in both states (no `mod-cta` filled style).

This follows the existing `agent-client-icon-active` /
`agent-client-icon-inactive` pattern on the send button (styles.css L1104).
Filled-background (`mod-cta`) was rejected — too loud for a toggle that
sits next to send.

### D3. Settings-tab enable toggle is removed
The toolbar icon becomes the single UI control for enable/disable. The
`settings.agentWorkspace.enabled` boolean stays in the data layer (it's
still the persistence target and is read by `AgentWorkspace.isEnabled()`).
Other agentWorkspace settings (`path`, `emitInstructions`,
`agentAssistedFocusUpdate`, `resourcesMaxEntries`, `resourcesMaxDepth`)
remain in the settings tab — they're advanced configuration the toolbar
toggle doesn't need to expose.

### D4. Tooltip is stateful, not action-verb
- Enabled: `"Agent Workspace: on"`
- Disabled: `"Agent Workspace: off"`

Surfaces current state on hover; clicking is the implied affordance.
Action-verb phrasing ("Disable Agent Workspace") was rejected because it
describes the next click rather than the current value.

### D5. Toggle reactivity uses the existing settings observer
On click:
1. `settingsService.updateSettings({ agentWorkspace: { ...current, enabled: next } })`
2. `plugin.refreshAgentWorkspace()` — destroys current `AgentWorkspace`,
   reconstructs, calls `ensureBootstrapped()`. When `enabled=false` the
   bootstrap early-returns; when `enabled=true` it creates folders,
   subscribes to vault events, and primes the manifest.
3. UI updates via the `useSettings` hook (observer pattern through
   `useSyncExternalStore`).

No new state, no new context. The button's appearance is derived from
`settings.agentWorkspace.enabled` on every render.

### D6. Always interactive (no disabled state on session-disconnect)
The brain button is enabled regardless of agent session state. Toggling
the workspace doesn't depend on the agent connection — bootstrap is a
local vault operation. The button stays clickable when the session is
disconnected, busy, or in error.

### D7. Re-uses existing settings API; no new plumbing
- New props on `InputToolbar`:
  `agentWorkspaceEnabled: boolean`,
  `onToggleAgentWorkspace: () => void`.
- New props on `InputArea`:
  same two, threaded through.
- `InputArea` reads `settings.agentWorkspace.enabled` directly via its
  existing `useSettings(plugin)` hook. The toggle callback uses
  `plugin.settingsService.updateSettings` and `plugin.refreshAgentWorkspace()`
  — both already exist. No new hook.

### D8. Icon: Lucide `brain`
Used via `setIcon(buttonRef.current, "brain")`, mirroring the existing
send-button pattern. No new icon assets.

### D9. Removal of the settings toggle is non-migratory
The boolean field stays in the JSON; only the UI control moves. Users
upgrading will see their existing `enabled` value reflected in the toolbar
icon's lit/unlit state. No data migration, no defaults change.

### D10. Toggling does NOT touch `session.workspaceSnapshot`
**Common-mistake guard.** A reasonable-seeming intuition is: "when the
user disables the workspace, clear the snapshot so re-enabling ships a
fresh seed." This is wrong, and worth spelling out so future
contributors don't re-introduce the bug.

Reasoning: ACP has no "forget previous Resource" message. Once the
seed `<obsidian_workspace>` block was shipped (e.g., on turn 1), it is
pinned in the agent's conversation history forever. The
`workspaceSnapshot` field is **not** a cache of what the agent could
forget — it is our local approximation of what the agent has already
seen in its transcript. The user toggling the icon cannot rewrite the
agent's history.

Therefore the seed-then-delta gate already produces the correct
behavior across toggle transitions:

| Sequence | Behavior | Why correct |
|---|---|---|
| OFF→ON, no vault changes | delta gate returns nothing → no ship | Agent already has the seed from its earlier history; nothing to add. |
| OFF→edit Index.md→ON | hash differs → delta ships `<obsidian_workspace_update>` | Agent gets exactly the diff that occurred during the off-period. |
| OFF→ON, immediately | silent no-op | Agent's view is already current. |

If we cleared the snapshot on disable (the rejected design), we would
re-ship the same seed on the next enable, putting two identical
workspace blocks in the agent's context for no reason — bloat without
information.

**UX consequence (acceptable, no action):** a user who toggles OFF
expecting "the agent should now ignore the workspace I shared
earlier" cannot achieve that — the seed is already in the agent's
transcript. The toggle controls *future* shipments only, not past
ones. This is inherent to ACP's append-only context model and applies
equally to mentioned notes, auto-mention payloads, etc.

By symmetry, this rule applies to any future toolbar toggle that
gates an in-session snapshot (e.g., a parallel auto-mention toggle):
**don't touch the snapshot on toggle. Let the content-hash gate do
its job.**

## 4. UI specification

### 4.1 DOM shape

```html
<div class="agent-client-chat-input-actions">
  <span class="agent-client-usage-indicator …">42%</span>
  <div class="agent-client-config-options-container">…</div>
  <!-- NEW -->
  <button
    class="agent-client-workspace-toggle"
    title="Agent Workspace: on">
    <svg class="agent-client-icon-active">…brain icon…</svg>
  </button>
  <!-- existing -->
  <button class="agent-client-chat-send-button">
    <svg class="agent-client-icon-active">…send icon…</svg>
  </button>
</div>
```

### 4.2 CSS (additions to `styles.css`)

```css
/* Agent Workspace toggle */
.agent-client-workspace-toggle {
  width: 20px;
  height: 20px;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  background-color: transparent !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none !important;
  appearance: none;
  box-shadow: none !important;
  transition: all 0.2s ease;
}

.agent-client-workspace-toggle svg {
  transition: color 0.2s ease;
}

.agent-client-workspace-toggle svg.agent-client-icon-active {
  color: var(--interactive-accent);
}

.agent-client-workspace-toggle svg.agent-client-icon-inactive {
  color: var(--text-muted);
}
```

Re-uses the existing `agent-client-icon-active` /
`agent-client-icon-inactive` SVG color classes for D2 consistency.

### 4.3 Component changes

**`InputToolbar.tsx`:**
- Add two props: `agentWorkspaceEnabled`, `onToggleAgentWorkspace`.
- Add `workspaceButtonRef = useRef<HTMLButtonElement>(null)`.
- New `useEffect` that calls `setIcon(workspaceButtonRef.current, "brain")`
  on mount and applies the active/inactive SVG class based on
  `agentWorkspaceEnabled`.
- Render the button immediately before the send button.

**`InputArea.tsx`:**
- Compute `agentWorkspaceEnabled = settings.agentWorkspace.enabled`.
- `handleToggleAgentWorkspace` callback:
  ```ts
  const next = !settings.agentWorkspace.enabled;
  await plugin.settingsService.updateSettings({
    agentWorkspace: { ...settings.agentWorkspace, enabled: next },
  });
  plugin.refreshAgentWorkspace();
  ```
- Pass both as props to `<InputToolbar />`.

**`SettingsTab.ts`:**
- Remove the "Enable agent workspace" `Setting` block (currently around
  lines 199–212). Keep all other workspace settings unchanged.

## 5. Edge cases

| Case | Behavior |
|---|---|
| Toggle off mid-conversation | Next prompt's `preparePrompt` sees `agentWorkspace.isEnabled() === false` and ships no workspace prelude. Auto-mention toggle is independent. |
| Toggle on after a long off period | Re-bootstrap creates folders if missing; manifest dirty-flag re-scans Resources. Next prompt seeds (`hasSeed=false` because per-session snapshot was reset on session create). |
| Toggle while `isSending=true` | Setting persists immediately; the in-flight prompt has already been built and shipped. The next prompt picks up the new state. |
| Sidebar and floating views open simultaneously | Both subscribe to the same settings store; toggling from either updates both icons in the same render frame. |
| Plugin first-load default | Defaults remain `enabled: true` (from `DEFAULT_SETTINGS` in `plugin.ts`). Icon shows lit. |
| Vault adapter rename fails during bootstrap | Existing failure path (`bootstrapFailed = true`) still applies; the toolbar icon stays lit (reflects user intent), but `buildPrelude` returns no blocks. Acceptable — failure is logged. |
| Mobile / small viewport | Same toolbar; icon is 20×20, same as the send button — no layout change. |

## 6. Testing plan

### Manual
1. Fresh load: toolbar icon lit (default `enabled=true`).
2. Click → icon goes muted; send a message → no `<obsidian_workspace>`
   block in `[AcpClient]` debug log.
3. Click again → icon lit; next message includes the seed prelude.
4. Settings tab: confirm the "Enable agent workspace" row is gone; other
   workspace settings still present.
5. Open both sidebar and floating views: toggling from one updates both.

### Automated (light)
- `InputToolbar.test.tsx` (if added): renders the brain button with the
  active class when `agentWorkspaceEnabled=true`, inactive class when
  false.

## 7. Open questions

1. **Should the toolbar icon also surface bootstrap errors?** E.g., red
   tint when `bootstrapFailed=true`. Defer — the feature already logs;
   no user-visible failure mode reported yet.
2. **Should there be a long-press / right-click affordance to open the
   workspace folder in Obsidian's file explorer?** Nice-to-have. Out of
   scope for v1.
3. **Future: Add a parallel auto-mention toolbar toggle?** The auto-mention
   feature already has a per-turn disable mechanism via the input badge;
   adding a second toggle here is redundant. Skip.

## 8. Non-obvious risks

- **Settings-tab removal is one-way for users who expect to find toggles
  there.** A user who recalls "I disabled it via settings" won't find the
  control. Mitigation: tooltip + visible toolbar position should be
  self-explanatory after first encounter.
- **`refreshAgentWorkspace` discards the in-memory manifest and any
  bootstrap state.** Toggling rapidly off/on does extra work. Acceptable
  — toggle is a deliberate user action, not a hot path.
- **Color mismatch on custom themes.** Themes that override
  `--interactive-accent` to a low-contrast value may make the lit state
  hard to distinguish from inactive. Mitigation: same risk applies to the
  existing send-button color state; we follow precedent.

## 9. Out of scope (v2+)

- Per-session enable override.
- Visual progress indicator during bootstrap.
- Right-click menu (open workspace folder, jump to settings, etc.).
- Command-palette command for keyboard toggling.
