---
name: release-notes
description: >-
  Generate a GitHub release note draft for this Obsidian plugin repository.
  Use when the user asks to write, draft, or prepare release notes for a new version.
  Invoked with a version number argument (e.g. "0.11.0", "0.11.0-preview.1").
  Analyzes git history and code diffs since the previous release to produce
  user-facing release notes in the project's established format.
---

# Release Notes Generator

Generate a release note draft for this repository by analyzing git changes since the previous release. The output is a Markdown code block ready to paste into a GitHub release — do NOT create the release itself.

The version number is provided as an argument (e.g. `/release-notes 0.11.0`). If no version is given, ask for one before proceeding.

## Step 1: Determine the previous release

The "previous release" depends on the version type being drafted:

- **Stable version** (no `-preview`): Find the most recent stable tag, skipping all prereleases. This is because stable release notes cover everything since the last stable release — they aggregate all prerelease changes into one cohesive set of notes.
- **Prerelease** (`-preview.N`): Find the most recent tag of any kind (stable or prerelease). Prerelease notes only cover the incremental delta since the last tag.

Use `git tag --sort=-v:refname` to list tags and pick the right one. Confirm the previous tag to the user before continuing (e.g. "Previous release: v0.10.2 — generating notes for changes since then.").

## Step 2: Gather information

Run these in parallel where possible:

1. **Commit log**: `git log {prev_tag}..HEAD --oneline` — the list of changes
2. **Diff stat**: `git diff --stat {prev_tag}..HEAD` — which files changed
3. **Actual diffs**: Read the diffs of changed source files (`src/`, `styles.css`, `manifest.json`, etc.) to understand what each change actually does at the code level. This is critical — commit messages alone are not enough to write accurate user-facing descriptions.
4. **Issue numbers**: Extract `#NNN` references from commit messages. Note: commit messages often contain PR numbers (from merge commits), not the original issue numbers. Use whatever `#NNN` is in the commit message as-is — the author will verify and correct these during review.
5. **New contributors**: Compare authors before and after the previous tag:
   ```
   git log --format='%aN' {prev_tag} | sort -u        # existing contributors
   git log --format='%aN' {prev_tag}..HEAD | sort -u   # contributors in this range
   ```
   Anyone in the second set but not the first is a new contributor. To find their GitHub username and PR number, use `git log --format='%aN <%aE>' {prev_tag}..HEAD` and cross-reference with `#NNN` in their commit messages. The GitHub username may differ from the git author name — check the commit on GitHub if needed.
6. **Previous prerelease notes** (stable releases only): If drafting a stable release and there were prereleases in the range, read their release notes with `gh release view {tag}`. This helps identify bugs that were introduced and fixed within the prerelease cycle — those should be excluded from the stable release notes since they never affected stable users.

## Step 3: Analyze and categorize

Before writing, think through what each change means from a user's perspective:

- **What can users do now that they couldn't before?** → New features (🌟 New)
- **What existing behavior got better?** → Improvements (🔧 Improvements)
- **What was broken and is now fixed?** → Bug fixes (🐛 Fixes)
- **Did anything get faster?** → Performance (⚡ Performance)
- **Does anything require user action on upgrade?** → Breaking changes (⚠ Breaking Changes)

For stable releases aggregating prereleases: exclude bugs that were both introduced and resolved during the prerelease cycle. Those never affected stable users and do not belong in the stable release notes.

### Detecting breaking changes

Breaking changes are easy to miss in diffs. Actively look for these patterns:

- **Renamed settings keys** in default settings or settings types (e.g., `activeAgentId` → `defaultAgentId`)
- **Renamed command IDs** in plugin.ts `addCommand()` calls
- **Changed or removed public APIs** or exported interfaces
- **Changed default behavior** that users relied on (e.g., a button that now does something different)
- **Removed features or settings**

If any are found, they MUST appear in the `### ⚠ Breaking Changes:` section AND be mentioned in the Upgrade section. If the migration is automatic, say so — users still need to know something changed.

## Step 4: Write the draft

Output the release note as a single Markdown code block. Follow this format exactly.

### Title line

The title is plain text with bold formatting — NOT a Markdown heading. No `#` prefix.

```
{emoji} **{Release Type} (v{version})**
```

Choose the release type and emoji based on content:
- `🔬 **Preview Release**` — all prereleases
- `✨ **Feature Release**` — stable with new features
- `🔧 **Improvement & Bug Fix Release**` — stable with improvements and fixes but no major new features
- `🐛 **Bug Fix Release**` — stable with only bug fixes
- `🔧 **Improvement Release**` — stable with only improvements
- `⚡ **Performance Fix**` — stable with only performance changes
- `🔧 **Maintenance Release**` — stable with only dependency updates or internal changes

### Prerelease warning (prereleases only)

For ALL preview releases — regardless of size — add this immediately after the title line (with a blank line before and after):

```
⚠ **This is a preview release** — Features are experimental and may change. Please report any issues!
```

This is mandatory for every prerelease. Never omit it.

### Summary paragraph

For stable 0.X.0 releases and substantial prereleases with multiple features, add a 1-2 sentence summary after the title (or after the prerelease warning). Patch releases and small prereleases with a single change can skip this.

The summary should focus on the single biggest highlight or theme — not enumerate every change. One sentence is ideal. If you can't pick a single theme, pick the top 2-3 and keep it under two sentences.

### Sections

Include only sections that have content, in this order:

```markdown
### ⚡ Performance:

### 🌟 New:

### 🔧 Improvements:

### 🐛 Fixes:

### ⚠ Breaking Changes:

### 🚀 Upgrade:

--------

### 👋 New Contributors

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

### Item format

Each item follows this pattern:

```
- **{emoji} {Short Title}**: {Description}. (#issue)
```

Rules:
- The **emoji** indicates the category (🪟 window/floating, ⌨ keyboard/input, 📋 copy/clipboard, 🔗 links/paths, 🐧 Linux/WSL, 🍎 macOS, 📦 packages/SDK, 🔔 notifications, 📂 files/directories, 🔐 permissions, 📊 data/charts, 📜 scrolling, 🔍 search/focus, 🎨 styling/UI, 🖥 terminal, 📝 text/editing, 🔄 sync/restore, 🗑 deletion, 📏 sizing/layout, etc.)
- The **short title** is 2-5 words, bold, and scannable — readers should understand the topic from the title alone.
- The **description** explains what changed from the user's perspective. Do not describe implementation details — no function names, class names, React hooks, framework APIs, or internal architecture. If a change is purely internal (refactoring, performance optimization), describe its user-visible effect.
- **Issue numbers** go at the end in parentheses. Omit if no issue is referenced.
- **One item per logical change.** If a single commit or PR addresses one concern (e.g. "fix process cleanup"), that is one item — even if it touches multiple files or uses platform-specific strategies. Conversely, don't merge unrelated changes into one item.

### Upgrade section

Always present. Keep it short and plain — no links, no blockquotes, no extra formatting.

- For patch/preview: `Simply update from v{prev} — no configuration needed.` or `Update from v{prev}. No configuration changes needed.`
- For stable 0.X.0: `Update from v{prev} — no extra configuration required.` with additional migration notes if there are breaking changes.
- If there are breaking changes, add a `⚠` warning with specific user action required.

### New Contributors section

Only include if there are new contributors. Use this exact format:

```
- @username made their first contribution in #PR
```

Do not add bold formatting, descriptions, or extra text. Do not add a "Welcome" message.

For stable releases: re-list contributors who were first listed in a prerelease within this cycle. They are still "new" from the stable user's perspective.

### Closing

Always end with this exact line:

```
**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

## Writing principles

- **User perspective only**: Describe benefits and behavior, not code changes. Never mention internal identifiers like component names, hook names, framework APIs, algorithm details, or data structures. The reader is an Obsidian user, not a developer reading the source code.
- **Accuracy over speed**: Read the actual code diffs. A commit message saying "fix: resolve issue" tells you nothing — the diff tells you everything.
- **Be specific**: "Fixed agents failing to start on NixOS" is better than "Fixed shell compatibility issue." Include concrete details like error messages or specific scenarios.
- **One item per logical change**: A single commit fixing process cleanup across platforms is one item. A single commit fixing two unrelated bugs is two items. Match the logical boundary, not the commit boundary.
- **Consistent tense**: Use past tense for fixes ("Fixed..."), present tense or imperative for features ("See how much context you've used" / "Attach non-image files").
- **Performance items describe the user experience**: "Significantly improved responsiveness for long sessions" — not "Added virtual scrolling with @tanstack/react-virtual and RAF batching."

## Examples

These are real release notes from this repository. Study the tone, format, and level of detail.

### Example 1: Bug fix release (v0.10.2)

```
🐛 **Bug Fix Release (v0.10.2)**

### 🐛 Fixes:

- **🪟 WSL Distribution Names with Dots**: Fixed "Invalid WSL distribution name" error when specifying versioned distribution names like `Ubuntu-22.04`. (#223)

### 🚀 Upgrade:

Simply update from v0.10.1 — no configuration needed.

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

Note: One fix, one item. Short title tells you the topic. Description includes the actual error message for specificity. No extra sections.

### Example 2: Preview release (v0.10.0-preview.3)

```
🔬 **Preview Release (v0.10.0-preview.3)**

⚠ **This is a preview release** — Features are experimental and may change. Please report any issues!

### 🐛 Fixes:

- **🧹 Process Cleanup on Exit**: Fixed agent child processes (e.g., MCP server nodes) remaining after closing Obsidian, restarting agents, or switching sessions. The plugin now kills the entire process tree on disconnect using platform-specific strategies. Also added cleanup on plugin disable. (#205)

### 🚀 Upgrade:

Update from v0.10.0-preview.2. No configuration changes needed.

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

Note: The prerelease warning is always included. A multi-faceted fix (multiple platforms, multiple triggers) is still ONE item because it's one logical concern. "platform-specific strategies" is acceptable — it communicates the scope without naming specific APIs.

### Example 3: Feature release with aggregated prereleases (v0.9.0, excerpt)

```
✨ **Feature Release (v0.9.0)**

This release adds context usage tracking, file attachment support, agent update notifications, dynamic session configuration, and a chat export command.

### 🌟 New:

- **📊 Context Usage Indicator**: See how much of the agent's context window you've used, displayed next to the send button. Color changes at 70%/80%/90% thresholds to warn you before hitting limits. (#113)
- **📎 File Attachments**: Attach non-image files (text, code, PDFs, etc.) to your messages via paste or drag-and-drop. Files are sent as `resource_link` content and rendered in chat messages. (#77)

### 🔧 Improvements:

- **📦 ACP SDK Update**: Updated @agentclientprotocol/sdk to v0.14.1.

### 🐛 Fixes:

- **📜 Auto-Scroll Threshold**: Increased threshold from 20px to 35px for more reliable scroll tracking.
- **🔗 Settings Documentation Link**: Fixed clicking the documentation link in settings causing Obsidian popout windows to close due to missing `target="_blank"`. (#152)

### 🚀 Upgrade:

Update from v0.8.3 — no extra configuration required. New features activate automatically when supported by your agent.

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

Note: Summary paragraph lists the highlights. Features describe what users can now do. SDK update is a one-liner. Fixes describe the user-visible symptom, not the code fix.

### Example 4: Improvement & bug fix release with new contributor (v0.9.4)

```
🔧 **Improvement & Bug Fix Release (v0.9.4)**

This release adds a copy button to messages, fixes markdown overflow issues, and improves floating chat behavior.

### 🌟 New:

- **📋 Copy Message Button**: Hover over any message to reveal a copy-to-clipboard button. Works for both user and assistant messages. (#189)

### 🔧 Improvements:

- **🪟 Smarter Floating Chat Commands**: Floating chat commands (open, minimize, close) now only appear in the command palette when the feature is enabled. Minimize and close additionally require a focused floating window. (#188)

### 🐛 Fixes:

- **📜 Horizontal Scroll for Wide Content**: Fixed mermaid diagrams, tables, and SVGs being clipped instead of scrolling horizontally. (#190)
- **🪟 Floating Chat Toggle**: Fixed floating chat button not hiding when the feature is toggled off in settings. (#187)

### 🚀 Upgrade:

Simply update from v0.9.3 — no configuration needed.

--------

### 👋 New Contributors

- @aviatesk made their first contribution in #187

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

Note: Even though it has a "New" section, the overall release type is "Improvement & Bug Fix Release" because the copy button is a small addition, not a major feature. New Contributors uses the exact `@username made their first contribution in #PR` format with no extra decoration.

### Example 5: Feature release with breaking changes (v0.7.0, excerpt)

```
✨ **Feature Release (v0.7.0)**

This release introduces multi-agent session support, allowing you to run multiple independent agent conversations simultaneously in separate chat views.

### 🌟 New:

- **🪟 Multi-Agent Sessions**: Run multiple agents simultaneously in separate chat views. Each view has its own independent agent process and session. (#59)
- **📢 Broadcast Commands**: Control multiple chat views at once:
  - `Broadcast prompt`: Copy the active view's input to all other views
  - `Broadcast send`: Send messages in all views simultaneously
  - `Broadcast cancel`: Cancel operations in all views
- **🔀 Focus Navigation**: Quickly switch between chat views with `Focus next/previous chat view` commands
- **➕ Open New View Command**: Open additional chat views via command palette or Header Menu

### 🔧 Improvements:

- **🍔 Header Menu**: New ellipsis menu in chat header for quick agent switching, opening new views, restarting agent, and accessing plugin settings.
- **🚨 Error Overlay**: Errors are now displayed as a dismissible overlay above the input area instead of replacing the entire chat.

### ⚠ Breaking Changes:

- **Setting Renamed**: `activeAgentId` → `defaultAgentId` (automatically migrated)

### 🚀 Upgrade:

Update from v0.6.1 — Settings are automatically migrated. Multi-session support works immediately with existing agent configurations.

--------

**Thank you for your continued support! Your feedback helps make this plugin better for everyone.** 🙏
```

Note: The summary focuses on the single biggest highlight (multi-agent sessions), not a list of everything. Breaking changes get their own section even when migration is automatic — users need to know. The Upgrade section mentions the auto-migration. Sub-bullet lists (as in Broadcast Commands) are fine when they improve scannability. Each distinct capability (Focus Navigation, Open New View) gets its own item rather than being folded into Multi-Agent Sessions.
