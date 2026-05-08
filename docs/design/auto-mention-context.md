# Auto-Mention Context — Design

**Status:** Proposed
**Owner:** TBD
**Last updated:** 2026-05-08

## 1. Problem

When the user enables "Auto-mention active note", the plugin currently
re-emits the same context payload on **every** turn, regardless of whether
the user's focus has actually changed:

- **Tab open, no selection:** a `type: "text"` block is appended to the user
  message — `"The user has opened the note <uri> in Obsidian. This may or
  may not be related..."` Repeated verbatim every turn.
- **Tab open, with selection:** a `type: "resource"` block carrying the full
  selected slice + a sibling `type: "text"` block describing the line range.
  Both repeat every turn even when the user hasn't shifted focus.

This is wasteful for two reasons:

1. **Token economics.** A user holding focus on the same note across a
   30-turn conversation pays for that selection content 30 times.
2. **Channel bleed.** The no-selection branch puts auto-mention info in the
   user-text channel; the with-selection branch splits it across the
   assistant-resource channel and the user-text channel. Inconsistent
   contract for the agent.

We just shipped seed-then-delta for the workspace prelude (see
`agent-workspace.md` D5). This doc applies the same pattern to auto-mention.

## 2. Goals & non-goals

### Goals
- Ship the auto-mention payload **once per signature**, not once per turn.
- Move the entire payload into the `audience: ["assistant"]` channel
  (Resource form for embedded transport, XML block for the text fallback).
- Keep the per-turn `@[[note]]:from-to\n` prefix in the user message — it's
  the cheap focus indicator, not the payload.
- Mirror the seed-then-delta model already proven for the workspace
  prelude (snapshot on `ChatSession`, end-of-turn commit, lifecycle reset).
- Preserve **progressive disclosure**: pointer for tab-open-no-selection,
  slice for tab-open-with-selection, full note for `@[[…]]` mention.

### Non-goals (for v1)
- Sub-note differential updates (selection shifts within a file → re-ship
  full payload, don't try to diff the selected lines).
- Multi-note history (B → A → B optimization). Single snapshot only;
  switching back to a previously-sent note re-ships.
- Cross-session snapshot caching.
- Replacing or modifying the explicit `@[[note]]` mention pipeline. That
  stays as-is — full content per occurrence.

## 3. Decisions log

### D1. Signature-gated emission
Auto-mention payload is emitted only when the current activeNote signature
differs from `session.autoMentionSnapshot`. Signature is the tuple
`(notePath, selFrom, selTo, mtime)`. Equal signature ⇒ skip the
Resource/XML block entirely; the `@[[note]]:lines\n` prefix in the user
message is the only auto-mention output that turn.

### D2. End-of-turn snapshot commit
After a successful `sendPreparedPrompt`, commit
`setAutoMentionSnapshot(prepared.pendingAutoMentionSnapshot ?? null)`.
Same lifecycle as `workspaceSnapshot` — the snapshot reflects what the
agent has **already received**, not what the UI currently shows.

### D3. Lifecycle reset matches `workspaceSnapshot`
`autoMentionSnapshot` MUST be reset to `undefined` in:
- `createSession` (new chat)
- `updateSessionFromLoad` (load / resume / fork)

This is the same trap we just fixed for `workspaceSnapshot`. Every
"session-scoped snapshot" we add inherits this risk; consider a shared
helper `clearSessionScopedSnapshots(prev)` so the next addition doesn't
repeat the bug.

### D4. Progressive disclosure preserved
| Trigger | Resource body |
|---|---|
| Tab open, no selection | Short pointer string ("User has opened note `<uri>`...") |
| Tab open, with selection | Selected slice content |
| `@[[note]]` mention (separate path) | Full note content |

Body weight scales with user intent. Tab-open is passive and produces a
pointer-only Resource; selection is active focus and produces the slice;
explicit `@[[…]]` is unambiguous and produces the full file.

### D5. Channel uniformity — entire payload in the assistant channel
For the embedded transport, the **entire** auto-mention payload (pointer
text, selection slice, framing prose) lives inside a single `type:
"resource"` block annotated `audience: ["assistant"]`. Specifically:

- The no-selection pointer becomes a Resource block whose `text` body
  *is* the descriptive English string. Mild semantic tension (the
  `text` field carries prose *about* the file rather than the file's
  content), but the URI in `resource.uri` remains authoritative.
- The with-selection case folds the framing prose ("Lines X–Y of this
  note are the user's current focus.") **into the Resource body** above
  the slice. **No sibling `type: "text"` block.** The earlier draft
  emitted a separate text block for the framing — that block has no
  `audience` annotation and bleeds into the user-text channel,
  violating this decision.

`type: "resource_link"` was considered for the pointer case and rejected
because the "may or may not be relevant" framing loses its natural slot.

### D6. mtime in the signature
Without `mtime`, a user holding focus on note A while editing it
externally would never trigger a re-emit, and the agent's view would
silently drift from disk. Including `mtime` costs one extra
`vault.adapter.stat()` per turn — negligible. Filesystem-resolution
caveats (1-sec on FAT, ms elsewhere) are accepted; agents can use Read
to break ties if they suspect staleness.

### D7. Tab-close: no emit, snapshot retained
When `activeNote=null`, the turn produces no Resource and no prefix. The
snapshot is **left as-is**. If the user re-opens the same note unchanged,
signature comparison naturally suppresses re-emission. Alternative
considered: clear snapshot on tab-close — rejected because it would
force a redundant re-emit of identical content on re-open.

### D8. Text-fallback transport mirrors logic — with inherent channel asymmetry
For agents without `embeddedContext` capability, the same seed-then-delta
gate applies. On signature change, an `<obsidian_opened_note>` XML block
goes into the user-text prelude (matching today's wrapper). On no change,
the XML block is omitted entirely; only the `@[[note]]:from-to\n` prefix
appears. Symmetry contract: identical body strings between embedded and
fallback transports, only the wrapper differs (same rule as
wikilink-context.md D2).

**Inherent channel asymmetry (acknowledged, not fixable):** the fallback
transport cannot honor D5's "all payload in the assistant channel" goal
because agents lacking `embeddedContext` cannot accept `type: "resource"`
blocks at all — it's a protocol-level capability gate, not a stylistic
choice. The user-text prelude is the only channel available, so XML in
user-text is unavoidable for these agents. This is an inherent property
of the capability gap, accepted as a v1 tradeoff. Embedded-capable
agents (Claude Code today) get the clean assistant-channel contract;
fallback agents (Codex, Gemini today) get the legacy text-prelude
shape. Both still benefit from seed-then-delta gating — the
optimization is transport-agnostic.

### D9. Code path collapse: 4 branches → 2
Current code has four branches:
`buildAutoMentionResource` × selection-vs-no, plus
`buildAutoMentionTextContext` × selection-vs-no. After this change:
**two branches** — embedded vs fallback — sharing a single body-string
builder. The body builder produces the pointer string when no selection
and the framing-line + slice string when selection is present. The two
transports just wrap that body differently (Resource block vs
`<obsidian_opened_note>` XML). The four-way matrix collapses into a
signature-gate plus one body builder plus two thin wrappers.

### D10. Priority unchanged at 0.8
Auto-mention Resource priority stays `0.8`, slotted between mentioned
notes (`1.0`) and workspace instructions (`0.7`). No change from current
behavior. Reflects "user is implicitly focused on this — less
authoritative than an explicit `@[[…]]` but more current than a baseline
workspace seed."

### D11. No wikilink prelude for the pointer-only case
The selection branch already runs `decorateWithLinkedNotes` on the body.
The pointer-only branch has no note content to scan — building a wikilink
prelude would require reading the entire active note just for metadata,
partly defeating the seed-then-delta savings. Skip the prelude for the
pointer; keep it for selection and `@[[…]]` paths.

## 4. Format specification

### 4.1 Signature

```ts
interface AutoMentionSnapshot {
  notePath: string;        // vault-relative
  selFrom: number | null;  // 0-based line index; null when no selection
  selTo: number | null;    // 0-based, inclusive; null when no selection
  mtime: number;           // file.stat.mtime at emit time
}
```

Two snapshots are equal when **all four** fields match. `null` selFrom/selTo
indicate no-selection mode and must match exactly (a no-selection snapshot
is not equal to a selection snapshot, even if `selFrom===0` and `selTo===0`).

### 4.2 Embedded transport — pointer (no selection)

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///abs/vault/Note.md",
    "mimeType": "text/markdown",
    "text": "User has opened the note file:///abs/vault/Note.md in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content."
  },
  "annotations": {
    "audience": ["assistant"],
    "priority": 0.8,
    "lastModified": "<file mtime ISO>"
  }
}
```

### 4.3 Embedded transport — selection

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///abs/vault/Note.md",
    "mimeType": "text/markdown",
    "text": "Lines X-Y of this note are the user's current focus.\n\n<wikilink prelude (if any)>\n<selected slice>"
  },
  "annotations": {
    "audience": ["assistant"],
    "priority": 0.8,
    "lastModified": "<file mtime ISO>"
  }
}
```

**Single Resource block, no sibling text.** The framing line ("Lines X–Y
of this note are the user's current focus.") is folded into the Resource
`text` body so the entire payload stays in `audience: ["assistant"]`
(per D5). The `@[[Note]]:X-Y\n` prefix in the user-text channel is the
only per-turn auto-mention output; it carries the focus signal between
emissions and is independent of the signature gate.

### 4.4 Text-fallback transport

Inserted into the user-text prelude **only on signature change**.

No selection:
```xml
<obsidian_opened_note ref="file:///abs/vault/Note.md">User has opened the note file:///abs/vault/Note.md in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.</obsidian_opened_note>
```

With selection:
```xml
<obsidian_opened_note ref="file:///abs/vault/Note.md" selection="lines X-Y">
Lines X-Y of this note are the user's current focus.

<wikilink prelude (if any)>
<selected slice>
</obsidian_opened_note>
```

The body string inside the XML wrapper is **byte-identical** to the
embedded transport's Resource `text` body (§4.3) — same framing line,
same wikilink prelude, same slice. Only the outer wrapper differs.
This is the D8 symmetry contract.

### 4.5 Per-turn prefix (always emitted, both transports)

```
@[[NoteName]]\n          ← no selection
@[[NoteName]]:1-5\n      ← with selection
```

Lives in the user-text channel. Independent of signature comparison.
Suppressed only when auto-mention is disabled or `activeNote=null`.

### 4.6 Ordering in `agentContent` (embedded transport)

```
[ workspace state, workspace instructions ]   ← priority 0.9 / 0.7
[ mentioned-note resources (@[[…]]) ]         ← priority 1.0
[ auto-mention resource (single block) ]      ← priority 0.8
[ user-text block w/ prefix + message ]
[ images, resourceLinks ]
```

Unchanged from today; auto-mention block presence is now the only
variable.

## 5. Implementation plan

### 5.1 Type addition

Add `autoMentionSnapshot?: AutoMentionSnapshot | null` to `ChatSession`
in `types/session.ts`. Mirrors the existing `workspaceSnapshot` field.
Export `AutoMentionSnapshot` from the same file.

### 5.2 Signature helper

`src/services/message-sender.ts` (or a new sibling `auto-mention-state.ts`
if message-sender grows past ~1k lines):

```ts
function buildAutoMentionSignature(
  activeNote: NoteMetadata | null,
): AutoMentionSnapshot | null { ... }

function autoMentionSignatureUnchanged(
  current: AutoMentionSnapshot | null,
  snapshot: AutoMentionSnapshot | null | undefined,
): boolean { ... }
```

Both pure; unit-testable.

### 5.3 `PreparePromptInput` extension

```ts
interface PreparePromptInput {
  // existing fields ...
  autoMentionSnapshot?: AutoMentionSnapshot | null;
}

interface PreparePromptResult {
  // existing fields ...
  pendingAutoMentionSnapshot?: AutoMentionSnapshot | null;
}
```

`pendingAutoMentionSnapshot` is computed up-front (matches the workspace
pattern) and committed by the hook on successful send.

### 5.4 Branch collapse in `preparePrompt*`

Replace `buildAutoMentionResource` and `buildAutoMentionTextContext` with:

```ts
function buildAutoMentionPayload(
  activeNote: NoteMetadata | null,
  prevSnapshot: AutoMentionSnapshot | null | undefined,
  // ...
): {
  embeddedBlocks: PromptContent[];   // empty when unchanged or no activeNote
  fallbackXml: string;               // empty when unchanged or no activeNote
  pendingSnapshot: AutoMentionSnapshot | null;
}
```

Single signature gate at the top; body builder branches on `selection?` for
slice-vs-pointer. Embedded transport caller wraps in Resource block;
fallback caller embeds in user-text prelude.

### 5.5 `useAgentMessages.ts` integration

Pass `session.autoMentionSnapshot` into `preparePrompt`. On success:

```ts
if (prepared.pendingAutoMentionSnapshot !== undefined) {
  setAutoMentionSnapshot(prepared.pendingAutoMentionSnapshot);
}
```

Mirrors the existing `setWorkspaceSnapshot` flow (line 340-357 of
`useAgentMessages.ts` today).

### 5.6 Lifecycle reset

In `useAgentSession.ts`:

```ts
// createSession (line 179-196 today, after workspaceSnapshot fix):
setSession((prev) => ({
  ...prev,
  // ...
  workspaceSnapshot: undefined,
  autoMentionSnapshot: undefined,
}));

// updateSessionFromLoad (line 352 today):
setSession((prev) => ({
  ...prev,
  // ...
  workspaceSnapshot: undefined,
  autoMentionSnapshot: undefined,
}));
```

Worth extracting `clearSessionScopedSnapshots(prev)` once we add a third
session-scoped snapshot. Two is still tolerable inline.

### 5.7 mtime fetch

`activeNote.modified` already exists on `NoteMetadata` (line 304 of
`message-sender.ts` reads `new Date(activeNote.modified).toISOString()`).
Re-use it as `mtime` in the signature; no extra disk stat needed.

## 6. Edge cases

| Case | Behavior |
|---|---|
| First turn, tab open no selection | Emit pointer Resource (seed); commit snapshot. |
| Same note, same selection, no edits | Skip Resource; only `@[[…]]:lines\n` prefix. |
| Same note, different selection range | Emit Resource (selFrom/selTo changed). |
| Same note, content edited externally | Emit Resource (mtime changed). |
| Switch note A → B | Emit Resource for B (notePath changed). |
| Switch B → A (after B emitted earlier) | Emit Resource for A again. Multi-note history not tracked. |
| Close tab (was A, now null) | No Resource, no prefix; snapshot retained. |
| Re-open same note unchanged after close | Signature equal → no Resource emitted. |
| Re-open same note after external edit | mtime differs → Resource emitted. |
| Auto-mention disabled mid-session | No Resource, no prefix; snapshot retained but unused. |
| First turn of new session (post-bugfix) | `autoMentionSnapshot=undefined` → seed emitted. |
| First turn of resumed session | Same — fresh seed (consistent with workspace reset). |
| Auto-mention disabled at session start, enabled mid-session | First post-enable turn with active tab emits seed. |

## 7. Settings / opt-out

Existing setting `autoMentionActiveNote: boolean` continues to control
the entire feature. **No new setting** introduced. When disabled, the
snapshot is untouched (no commits, no emits).

## 8. Testing plan

### Unit tests (`message-sender.test.ts` or new `auto-mention.test.ts`)
- Two consecutive `preparePrompt` calls with identical activeNote +
  matching snapshot input → second call emits **no** auto-mention
  blocks; prefix preserved.
- Selection range change between calls → second call emits Resource.
- mtime change between calls → second call emits Resource.
- Note path change → second call emits Resource for new path; old path
  not referenced.
- Tab close (`activeNote=null`) → no blocks, no prefix; snapshot
  unchanged in result.
- `autoMentionSnapshot=undefined` (fresh session) → emits seed.
- Embedded vs fallback symmetry: same activeNote + same snapshot input
  produce identical body strings, only wrapper differs.

### Integration tests (`useAgentSession.test.ts`)
- After `createSession`, `session.autoMentionSnapshot` is `undefined`.
- After `updateSessionFromLoad`, `session.autoMentionSnapshot` is
  `undefined`.
- After successful send with active tab, `session.autoMentionSnapshot`
  matches the pending snapshot from `preparePrompt`.

### Manual verification (debug mode)
Walk three turns with `[AcpClient][debug-check] Prompt content` logs:
1. Fresh session, tab open on note A: Resource block + prefix.
2. Same tab still on A (no edits): no Resource block; prefix only.
3. Switch tab to note B: Resource block for B + prefix.
4. New chat: turn 1 against any tab emits a fresh seed (workspace +
   auto-mention both reset).

## 9. Open questions

1. **Should auto-mention emit on the first turn even if signature equals
   a stale snapshot?** Edge case: hot-reload of the plugin restores
   `session` from somewhere with snapshot still set, but the agent
   process is fresh. The lifecycle reset (D3) handles new-chat / load /
   resume / fork; plugin reload is out of scope unless we observe it.

2. **Should `<obsidian_opened_note ref>` use `file://` URI everywhere
   for symmetry with embedded transport?** Currently embedded uses URI
   already. Fallback could match. Low-cost cleanup; flag for impl.

3. **Tab-close invalidation signal.** Today: silent. Alternative: emit a
   one-time text block "User has closed note A" when transitioning
   activeNote=A → null. Probably over-engineered — agent has
   conversation history. Defer unless feedback.

4. **Sub-second mtime on macOS APFS.** APFS reports mtime in
   nanoseconds; Obsidian's `TFile.stat.mtime` is milliseconds. Unlikely
   to matter, but if rapid edits within the same millisecond appear in
   testing, the snapshot would miss them. Mitigation: agent can Read
   on demand.

## 10. Non-obvious risks

- **Lifecycle reset trap.** Same as `workspaceSnapshot`. If a future
  contributor adds a new session-creation path (e.g., `cloneSession`)
  and forgets the reset, auto-mention silently leaks across sessions.
  Mitigate with shared helper or test that asserts both snapshots are
  cleared after each path.
- **Snapshot retention on tab-close.** Stale snapshot could prevent
  re-emit if mtime resolution is too coarse and the file was edited
  in the same millisecond as the close. Acceptable; documented in §9 Q4.
- **Channel migration breaks legacy agents.** Agents that today rely on
  the user-text "User has opened..." block to trigger behavior will see
  it move to the assistant channel. None known, but worth a note in the
  release notes.
- **Body-string drift between transports.** Same risk as wikilink-context
  D2. Mitigate with the symmetry test in §8.
- **Snapshot equality false-positives.** If `NoteMetadata.modified`
  doesn't refresh on Obsidian's in-editor changes (only on disk write),
  the agent could see stale content while the user has unsaved edits.
  Verify Obsidian semantics during impl; flag if drift observed.

## 11. Out of scope (v2+ candidates)

- Sub-note differential payloads (selection moved within file → ship
  only the diff).
- Multi-note history tracking (`Map<path, signature>` instead of single
  snapshot) to avoid B → A → B re-ships.
- Sub-second mtime granularity.
- `frontmatter` enrichment in the pointer-only payload (parallels the
  open question in `wikilink-context.md` §9 Q4).
- Per-agent override (e.g., disable auto-mention seed for specific
  models with smaller context windows).
