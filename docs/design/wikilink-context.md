# Wikilink Context for Mentioned Notes — Design

**Status:** Proposed
**Owner:** TBD
**Last updated:** 2026-05-05

## 1. Problem

When a user sends a message containing `@[[Note]]` mentions, the agent currently
receives the note's raw markdown verbatim. Any `[[wikilinks]]` inside that note
are passed through as opaque text — the agent cannot resolve them to file paths
without guessing, and has no signal about whether a link is resolved, ambiguous,
or broken. We want to enrich the prompt with structured wikilink metadata so
the agent can decide which links to follow (via its own `Read` tool) without
the plugin recursively expanding content.

## 2. Goals & non-goals

### Goals
- Surface `[[wikilinks]]` found inside mentioned-note content with resolved
  file paths the agent can use directly.
- Mark ambiguous and unresolved links explicitly so the agent doesn't guess.
- Apply the same logic to **all three** content paths: explicit `@[[…]]`
  mentions, embedded-context auto-mention (active note), and XML auto-mention.
- Keep `embeddedContext` and XML transports semantically equivalent — same body
  string, different wrapper.

### Non-goals (for v1)
- Recursive content expansion (note A → note B → note C). Agents have a `Read`
  tool; let them choose what to follow.
- Inlining `![[embeds]]` content. Same reason. Documented in §6.
- Backlink resolution (links *to* this note). Out of scope.
- Resolving links inside `chat-exporter.ts` output. Export targets Obsidian, not
  the agent — wikilinks are already meaningful to the user.

## 3. Decisions log

### D1. Metadata lives in `text`, not in `annotations`
ACP's `Annotations` schema (`node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts:61-75`)
is closed-shape: only `_meta`, `audience`, `lastModified`, `priority`. The
legitimate extension slot (`_meta`) is annotated in the spec with
*"Implementations MUST NOT make assumptions about values at these keys"* — i.e.,
the agent host is not obliged to surface its contents to the model. Therefore,
embedding `linkedNotes` anywhere under `annotations` is unreliable as a
model-context channel.

We embed metadata inside `resource.text` for embeddedContext and inside the
XML wrapper for the text fallback. Both transports produce **identical body
strings** (modulo outer wrapper). Annotations remain reserved for `audience`,
`priority`, `lastModified`.

### D2. Outer wrapper differs by transport, body string is identical
- Embedded: `Resource` block (uri + mimeType + text) — body string is the
  Resource's `text`, with no `<obsidian_mentioned_note>` outer tag (the
  Resource block already carries uri + mimeType, so it would be redundant).
- XML: `<obsidian_mentioned_note ref="…">…</obsidian_mentioned_note>` wrapper.

Both wrap the same internal body: an optional `<obsidian_metadata>` prelude
followed by raw note content.

### D3. Inline annotation rejected; structured prelude chosen
Earlier candidate "annotate `[[Foo]]` in prose with `(file:///…)` suffix" was
rejected because:
- It pollutes prose, especially in link-dense notes.
- It makes diffing/parsing harder if the agent tries to interpret the body as
  Obsidian markdown.
- A structured prelude scales better for ambiguous/unresolved markers.

### D4. Wikilink scan happens in prompt prep, not in `VaultService.readNote()`
`readNote` is a generic vault API; many call sites (markdown rendering, export,
etc.) don't want this overhead. The integration point is a new helper invoked
from `processNote()` (mentioned notes) and from the auto-mention builders
(`buildAutoMentionResource`, `buildAutoMentionTextContext`).

### D5. Scan after truncation, not before
Truncation is currently 10k chars per note (`message-sender.ts:145`). If we
scanned the un-truncated text, we'd advertise links the agent can no longer
see in context. Scanning the truncated text keeps metadata and prose
consistent. Rare downside: a link present in the original but cut by
truncation won't surface — acceptable; the truncation marker already signals
loss.

### D6. `![[embeds]]` skipped from metadata in v1
The helper already skips embeds (`extractLinkedNoteMetadata.ts:278`). We keep
that behavior. Reasoning: embeds semantically mean *"inline this content"*,
which would re-introduce the cycle/depth/budget problems we explicitly
deferred. We can revisit in v2 with a `kind="embed"` attribute and bounded
expansion if there's user demand.

### D7. Section anchors and aliases preserved
- `[[Foo#Bar]]` → metadata records `text="Foo"` and `section="Bar"`. Path
  remains the resolved file path (no fragment in URI for v1; revisit if agents
  start using fragment navigation).
- `[[Foo|display]]` → metadata records `text="Foo"` and `displayText="display"`.

### D8. Empty case emits no prelude
If a note has zero `[[…]]` links, we do **not** emit an empty
`<obsidian_metadata>` block. Body is just the raw note content, identical to
today's behavior — zero regression for link-free notes.

### D9. Cap link count to bound metadata cost
Hard cap per note: **50 links**. Beyond that, emit a `truncated="N"` attribute
on `<links>` and stop. Prevents pathological notes (auto-generated indices,
MOCs) from blowing the prompt.

## 4. Format specification

### 4.1 Body string (identical across transports)

```xml
<obsidian_metadata>
  <links>
    <link text="Link A" path="/abs/vault/Link A.md" uri="file:///abs/vault/Link%20A.md" resolved="true" />
    <link text="Foo" displayText="see Foo" path="/abs/vault/Foo.md" uri="file:///abs/vault/Foo.md" resolved="true" />
    <link text="Bar" section="Heading" path="/abs/vault/Bar.md" uri="file:///abs/vault/Bar.md" resolved="true" />
    <link text="Quux" resolved="false" />
    <link text="Baz" resolved="ambiguous">
      <candidate path="/abs/vault/A/Baz.md" uri="file:///abs/vault/A/Baz.md" />
      <candidate path="/abs/vault/B/Baz.md" uri="file:///abs/vault/B/Baz.md" />
    </link>
  </links>
</obsidian_metadata>
# My Note

Check this [[Link A]] and [[Foo|see Foo]] and [[Bar#Heading]].
Also [[Quux]] (broken) and [[Baz]] (ambiguous).
```

When `<links>` is empty, the entire `<obsidian_metadata>` element is omitted.

### 4.2 Embedded transport

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///abs/vault/My%20Note.md",
    "mimeType": "text/markdown",
    "text": "<obsidian_metadata>…</obsidian_metadata>\n<note body>"
  },
  "annotations": {
    "audience": ["assistant"],
    "priority": 1.0,
    "lastModified": "2026-05-05T..."
  }
}
```

### 4.3 XML transport

```xml
<obsidian_mentioned_note ref="/abs/vault/My Note.md">
<obsidian_metadata>…</obsidian_metadata>
<note body>
</obsidian_mentioned_note>
```

### 4.4 Auto-mention (active note)

Same body-string format applies. The auto-mention's outer wrapper differs from
explicit mentions:

- Embedded: a `Resource` block carrying body string + a sibling text block
  describing the user's focus (selection range or "opened in Obsidian" hint).
  See `buildAutoMentionResource` (`message-sender.ts:510-571`).
- XML: `<obsidian_opened_note>` wrapper. See `buildAutoMentionTextContext`
  (`message-sender.ts:576-614`).

The metadata prelude is inserted before whatever content the auto-mention
builder already produces.

## 5. Implementation plan

### 5.1 Port the resolver (`helper/extractLinkedNoteMetadata.ts` → `src/utils/wikilink-resolver.ts`)

**Lift these symbols (helper lines 225-318):**
- `buildBasenameIndex`
- `resolveWikiLinkTargets`
- `extractLinkedNoteMetadata`
- `LinkedNoteCandidate`, `LinkedNoteMetadata` interfaces

**Drop everything else** in the helper file:
- `readNoteTool`, `readNoteSchema` (LangChain glue)
- `resolveNoteFile`, `readNoteText` (overlaps with `VaultService`)
- `chunkContentByLines`, `NoteChunk` (unrelated chunking)
- `normalizePathFragment`, `stripExtension`, `pathSegmentsMatchTail`,
  `pathHasExtension` (only used by `resolveNoteFile`)

**Adapt globals → injection:**
- Replace bare `app.vault.getMarkdownFiles()` and
  `app.metadataCache.getFirstLinkpathDest()` with parameters or methods on an
  injected `App`. Match project pattern: `this.plugin.app` in services.
- Cleanest API: pure functions taking `App` as the first arg, e.g.
  `extractLinkedNoteMetadata(content, sourceFile, app)`.

**Project-specific additions:**
- The lifted `LinkedNoteMetadata.candidates[].path` is vault-relative. The
  format spec needs absolute path + `file://` URI. Add a small wrapper
  `enrichLinkMetadata(meta, vaultBasePath, convertToWsl)` that maps each
  candidate through `resolveAbsolutePath` + `buildFileUri` (already exist in
  `message-sender.ts`).

### 5.2 New helper: body-string builder

In `src/services/message-sender.ts` (or a new sibling file
`wikilink-formatter.ts` if it's >50 lines):

```ts
function buildLinkedNotesPrelude(
  links: EnrichedLinkedNoteMetadata[],
  capCount = 50
): string {
  if (links.length === 0) return "";
  // emit <obsidian_metadata><links>…</links></obsidian_metadata>
  // include truncated="N" if links.length > capCount
}
```

XML escaping rules: escape `&`, `<`, `>`, `"`, `'` in all attribute values and
text content.

### 5.3 Integration points

**`processNote()` (`message-sender.ts:167-202`):** after reading + truncating,
extract links from the truncated content, enrich with absolute paths, build
the prelude, prepend it to `processedContent`. Single place change covers both
embedded and XML mentioned-note paths.

**`buildAutoMentionResource()` (`:510-571`):** apply the same prelude to the
note body inside the Resource block when a selection is present (full-note
selection branch). When no selection (just "opened note" hint), no body text
exists today — the metadata prelude is irrelevant. Decide: do we read the
active note's content just to scan links? Recommendation: **no**, only emit
metadata when we're already including the body (selection case). Document
this asymmetry.

**`buildAutoMentionTextContext()` (`:576-614`):** same as above for the XML
fallback selection branch.

### 5.4 Performance

- `buildBasenameIndex()` is built lazily per `extractLinkedNoteMetadata` call
  in the helper. Multiple `@[[…]]` mentions in one prompt would rebuild N
  times. **Hoist it** to one call per `preparePrompt`, threaded as a parameter
  (or memoized on the helper module with `WeakRef` keyed off `app`).
- `app.vault.getMarkdownFiles()` is O(n) — acceptable for typical vaults
  (≤10k notes). No caching needed in v1.

## 6. Edge cases

| Case | Behavior |
|---|---|
| No links in note | Skip prelude entirely (D8). |
| Only `![[embeds]]`, no links | Skip prelude (embeds excluded by D6). |
| 100+ links | Emit first 50, set `truncated="50"` on `<links>` (D9). |
| `[[Foo]]` text contains XML special chars (`<`, `&`, etc.) | Escape in attribute values. |
| `[[Foo]]` matches a non-markdown file (canvas, image) | Helper currently filters to markdown via `getMarkdownFiles()`. Document as known limitation; canvas/image links → `resolved="false"`. Revisit. |
| Same `[[Foo]]` appears multiple times in note | Helper dedupes by composite key `target\|display\|section`. One entry per unique tuple. |
| `[[#Heading]]` (in-document anchor) | `target` is empty after split; helper rejects via `if (!normalizedTarget) continue`. Skipped silently. |
| `[[ ]]` (whitespace only) | Skipped (same path). |
| `[[Foo|]]` (empty alias) | `displayText` falls back to `linkText`. |
| Note path contains spaces / unicode | URI uses `buildFileUri()` which already encodes. Verify with `[[My Note]]` test case. |
| Note is in vault subfolder, link uses just basename | `getFirstLinkpathDest()` resolves relative to source — works. |
| WSL mode | Apply `convertWindowsPathToWsl` to all `path` and `uri` attributes consistently with `processNote`. |
| Truncated content cuts off a `[[link]]` mid-syntax | Regex won't match; link silently absent from metadata. Acceptable; truncation marker signals data loss. |

## 7. Settings / opt-out

Add a single new setting under "Context" group:

- **`expandWikilinkContext: boolean`** (default `true`)
  When false, `processNote` and the auto-mention builders skip the prelude
  entirely. Equivalent to current behavior.

Future settings (out of scope for v1):
- `expandWikilinkDepth: 0 | 1` — recursive expansion control.
- `expandEmbeds: boolean` — separate `![[…]]` policy.

## 8. Testing plan

### Unit tests (`wikilink-resolver.test.ts`)
- Empty content → empty array.
- Simple `[[Foo]]` → one entry, resolved.
- `[[Foo|bar]]` → entry with `displayText="bar"`.
- `[[Foo#Bar]]` → entry with `section="Bar"`.
- `[[Foo]]` with two basename matches → `resolved=ambiguous`, two candidates.
- `[[NonExistent]]` → `resolved=false`.
- `![[Embed]]` → skipped.
- 60 unique links + cap=50 → 50 entries returned, caller emits `truncated`.

### Integration tests (`message-sender.test.ts`)
- `preparePrompt` for embedded path with one `@[[Foo]]`, Foo contains
  `[[Bar]]` → resource.text starts with `<obsidian_metadata>` containing `Bar`.
- `preparePrompt` for XML path with same input → body inside
  `<obsidian_mentioned_note>` matches embedded body string.
- Symmetry test: identical inputs to both transports produce byte-identical
  inner body strings (only wrapper differs).
- Setting `expandWikilinkContext=false` → no `<obsidian_metadata>` in output.
- Auto-mention with selection containing `[[X]]` → prelude appears.
- Auto-mention with no selection → no prelude (no body to attach to).

## 9. Open questions

1. **URI fragment for sections.** Should `[[Foo#Bar]]`'s URI be
   `file:///vault/Foo.md#Bar`, or fragment-less with `section` attribute only?
   Most agents won't parse fragments; the `section` attribute is more useful.
   **Tentative:** fragment-less, `section` attribute. Confirm during impl.

2. **`<obsidian_mentioned_note ref>` value.** Currently `ref="/abs/path"`
   (no `file://`). For v1, leave as-is to minimize diff. If we want full
   symmetry with embedded form's URI, switch to
   `ref="file:///abs/path"` — flag for future cleanup.

3. **Where does `expandWikilinkContext` setting live?**
   `AgentClientPluginSettings` likely. Default `true` or `false`?
   Recommendation: **default `true`** — surfacing structure is purely additive
   and matches the project's "rich context" stance. Low-cost opt-out for
   minimalists.

4. **Should we also feed `frontmatter` into `<obsidian_metadata>`?**
   Aliases, tags, custom fields. Out of scope for v1 but the prelude design
   accommodates it (`<frontmatter>` sibling of `<links>`). Don't paint
   ourselves into a corner.

## 10. Non-obvious risks

- **Body-string drift between transports.** Easy to accidentally emit slightly
  different strings (e.g., trailing newline differences) and not notice.
  Mitigation: a single `buildNoteBodyString()` function called by both paths;
  symmetry test in §8.
- **Performance regression on large vaults.** `getMarkdownFiles()` × N
  mentions × every send. Mitigated by index hoisting (§5.4).
- **Helper file is uncommitted.** `helper/extractLinkedNoteMetadata.ts` is
  in `git status` as untracked. Decide: import from helper and keep it as
  scratch, OR delete after porting. Recommendation: port to
  `src/utils/wikilink-resolver.ts`, then delete the helper directory in the
  same commit to avoid orphaned reference code.
- **Auto-mention asymmetry (§5.3).** Auto-mention without a selection emits
  no body, hence no metadata. Document clearly so users don't think it's a
  bug. Could consider reading the active note's full content for metadata
  scan even without selection — explicit deferral noted in §9 Q5 if added.

## 11. Out of scope (v2+ candidates)

- 1-level recursive expansion behind a setting.
- `![[embed]]` content inlining.
- Frontmatter export (aliases, tags) in metadata prelude.
- Backlinks (`metadataCache.getBacklinksForFile`).
- Block reference (`^block-id`) resolution.
- Caching `buildBasenameIndex` across sends with vault-mtime invalidation.
