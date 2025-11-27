# UI Redesign: VS Code Claude Code Style

**Date**: 2025-11-27
**Status**: Approved for implementation
**Reference**: VS Code Claude Code extension

---

## Problem Statement

Three UI issues affect usability:

1. **Chat input floats** when message list is empty/short (should anchor at bottom)
2. **Settings panel** has plain styling (vertical model list, basic checkboxes)
3. **Terminal panel** has unclear error states and stray UI elements

## Design Approach

**Layout-first, then polish**: Fix structural issues before visual refinements.

**Style direction**: Hybrid approach
- Use Obsidian's CSS variables, colors, spacing conventions
- Adopt VS Code Claude Code's interaction patterns (collapsible blocks, status indicators)

---

## Phase 1: Layout Foundation

### Goal
Fix flexbox structure so input is always anchored at bottom.

### Root Cause
The `.chat-view-messages` container lacks proper flex configuration. When content is short, the input floats instead of staying at the bottom.

### Solution

```
┌─────────────────────────────────┐
│ Tab Bar                         │  ← fixed height
├─────────────────────────────────┤
│ Header                          │  ← fixed height
├─────────────────────────────────┤
│                                 │
│ Messages Area                   │  ← flex: 1 1 0 (fills space)
│ (scrollable)                    │
│                                 │
├─────────────────────────────────┤
│ Input Container                 │  ← flex-shrink: 0 (anchored)
└─────────────────────────────────┘
```

### CSS Changes

**chat-view.css** (or equivalent):

```css
/* Container must be flex column with full height */
.chat-view-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Tab panel wrapper needs flex propagation */
[role="tabpanel"] {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* Messages area fills available space */
.chat-view-messages {
  flex: 1 1 0;        /* Explicit flex-basis: 0 forces shrink */
  min-height: 0;      /* Critical for overflow in flex children */
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;           /* Increased from 2px for better separation */
}

/* Empty state centers within messages area */
.chat-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  text-align: center;
  gap: 12px;
}

/* Input never shrinks */
.chat-input-container {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
}
```

### Files to Modify
- `src/presentation/views/chat/ChatView.tsx` - Add wrapper div with proper flex styles
- `main.css` or component CSS files - Update flex properties

---

## Phase 2: Chat Panel Visual Overhaul

### Header
Keep current structure. Minor refinements:

```
┌─────────────────────────────────────────────┐
│ Claude Code          [+] [⏱] [💾] [⧉] [⚙]  │
│ Update available!                           │
└─────────────────────────────────────────────┘
```

- Agent name as title (current H3 is fine)
- Keep existing action buttons with tooltips
- **Deferred**: Conversation title dropdown (requires session naming first)

### Empty State

```
┌─────────────────────────────────────────────┐
│                                             │
│                   🤖                        │
│                                             │
│     Start a conversation with Claude...    │
│     Use @ to mention notes, / for commands  │
│                                             │
└─────────────────────────────────────────────┘
```

- Use Obsidian's `bot-message-square` icon (already in `getIcon()`)
- Primary text: connection status or prompt
- Secondary text: usage hints
- Respect `prefers-reduced-motion` for any animations

### CSS

```css
.chat-empty-state-icon {
  width: 48px;
  height: 48px;
  color: var(--text-muted);
  opacity: 0.6;
}

.chat-empty-state-title {
  font-size: 14px;
  color: var(--text-normal);
  margin: 0;
}

.chat-empty-state-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

.chat-empty-state-hint code {
  background: var(--background-modifier-border);
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 11px;
}
```

### Input Bar
Keep current structure. No additional buttons.

Current already has:
- Auto-mention badge (when enabled)
- Textarea with placeholder
- Send button

The placeholder text already guides users: `Message ${activeAgentLabel} - @ to mention notes, / for commands`

---

## Phase 3: Message Rendering

### Thinking Blocks (Collapsible)

```
┌─────────────────────────────────────────────┐
│ 💭 Thinking                            [▼]  │
├─────────────────────────────────────────────┤
│   I'll read all the agent files...          │
└─────────────────────────────────────────────┘
```

- Icon + text label (not color-only - WCAG compliance)
- Chevron indicates collapsibility
- Collapsed by default
- Muted styling (already implemented)

### Tool Call Blocks

```
┌─────────────────────────────────────────────┐
│ 📖 Read  file1.ts, file2.ts (+3 more)       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ ✏️ Write  settings-panel.tsx           [▼]  │
│   154 lines                                 │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ export const SettingsPanel = () => {    │ │
│ │   // code preview...                    │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Pattern: `[icon] [action] [target] [count] [chevron]`

Icons by action type:
- Read: `file-text` or `book-open`
- Write: `file-plus`
- Edit: `file-edit`
- Bash: `terminal`

### CSS

```css
.message-tool-call {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  overflow: hidden;
}

.message-tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--background-secondary);
  cursor: pointer;
}

.message-tool-call-icon {
  width: 16px;
  height: 16px;
  color: var(--text-accent);
}

.message-tool-call-action {
  font-weight: 500;
  color: var(--text-normal);
}

.message-tool-call-target {
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-tool-call-meta {
  font-size: 11px;
  color: var(--text-faint);
}

.message-tool-call-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: transform 0.15s ease;
}

.message-tool-call.expanded .message-tool-call-chevron {
  transform: rotate(180deg);
}

.message-tool-call-content {
  padding: 12px;
  border-top: 1px solid var(--background-modifier-border);
  display: none;
}

.message-tool-call.expanded .message-tool-call-content {
  display: block;
}
```

### Todo/Plan Blocks

```
┌─────────────────────────────────────────────┐
│ 📋 Plan                              2/5    │
├─────────────────────────────────────────────┤
│ ✓ Fix layout structure                      │
│ ◉ Redesign header                           │
│ ○ Update input styling                      │
│ ○ Add empty state                           │
│ ○ Polish message rendering                  │
└─────────────────────────────────────────────┘
```

- Progress indicator in header (e.g., "2/5")
- Status icons: ✓ completed, ◉ in progress, ○ pending
- Strikethrough for completed items

---

## Phase 4: Terminal Panel

### Layout

```
┌─────────────────────────────────────────────┐
│ [↻ Restart] [🗑 Clear]          ● Running   │
├─────────────────────────────────────────────┤
│                                             │
│ $ claude                                    │
│ Claude Code v1.0.0                          │
│ > ...                                       │
│                                             │
└─────────────────────────────────────────────┘
```

### Toolbar Changes
- Add visible text labels to buttons (accessibility)
- Or ensure tooltips are keyboard-accessible and announced

```tsx
<button
  className="terminal-toolbar-button"
  onClick={handleRestart}
  aria-label="Restart Claude process"
>
  <span ref={iconRef} aria-hidden="true" />
  <span className="terminal-toolbar-label">Restart</span>
</button>
```

### Error State

```
┌─────────────────────────────────────────────┐
│ [↻ Restart] [🗑 Clear]          ● Error     │
├─────────────────────────────────────────────┤
│ env: node: No such file or directory        │
│ [Process exited with code 127]              │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ⚠ Node.js not found                     │ │
│ │ Configure path in Settings              │ │
│ │                     [Open Settings]     │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

- Inline error banner when exit code indicates environment issue
- Quick link to settings

### CSS

```css
.terminal-toolbar-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.terminal-toolbar-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.terminal-toolbar-label {
  font-size: 12px;
}

.terminal-error-banner {
  margin: 16px;
  padding: 12px;
  background: var(--background-modifier-error);
  border: 1px solid var(--text-error);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.terminal-error-banner-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--text-error);
}

.terminal-error-banner-message {
  font-size: 13px;
  color: var(--text-muted);
}

.terminal-error-banner-action {
  align-self: flex-end;
}
```

---

## Phase 5: Settings Panel

### Model Selection (Horizontal Pills)

```
┌─────────────────────────────────────────────┐
│ MODEL                                       │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────┐ │
│ │ Opus 4 │ │Sonnet 4│ │Sonnet  │ │ Haiku │ │
│ │        │ │   ●    │ │  3.5   │ │  3.5  │ │
│ └────────┘ └────────┘ └────────┘ └───────┘ │
└─────────────────────────────────────────────┘
```

Keep current card structure but ensure:
- Radio input is visually hidden but accessible
- Selected state has filled background (not just border)
- Cards flow horizontally with wrap

### CSS Update

```css
.settings-model-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-model-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  min-width: 80px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-primary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.settings-model-option:hover {
  border-color: var(--text-accent);
}

.settings-model-option.selected {
  border-color: var(--text-accent);
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.settings-model-option input[type="radio"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.settings-model-option-name {
  font-weight: 500;
  font-size: 13px;
}

.settings-model-option-description {
  font-size: 11px;
  opacity: 0.8;
}
```

### Toggle Switches (CSS-only)

Use native checkbox with CSS transformation:

```css
.settings-toggle {
  appearance: none;
  width: 36px;
  height: 20px;
  background: var(--background-modifier-border);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s ease;
}

.settings-toggle::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  background: var(--background-primary);
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.settings-toggle:checked {
  background: var(--interactive-accent);
}

.settings-toggle:checked::before {
  transform: translateX(16px);
}

.settings-toggle:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}
```

### Sticky Footer

Separate scrollable content from fixed footer:

```tsx
<div className="settings-panel">
  <div className="settings-content">
    {/* All settings sections */}
  </div>
  <div className="settings-footer">
    <button className="settings-reset-button">Reset to Defaults</button>
    <button className="settings-save-button" disabled={!isDirty}>
      Save Changes
    </button>
  </div>
</div>
```

```css
.settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.settings-footer {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
}
```

---

## Accessibility Checklist

| Requirement | Implementation |
|-------------|----------------|
| Color not sole indicator | Icons + text labels for status |
| Keyboard navigation | Native radio groups, focus-visible styles |
| Screen reader support | ARIA labels on icon buttons |
| Reduced motion | `prefers-reduced-motion` media queries |
| Focus visibility | Outline styles on `:focus-visible` |
| Live regions | `aria-live="polite"` for status updates |

---

## Implementation Order

1. **Phase 1**: Layout fix (highest priority - fixes immediate pain)
2. **Phase 2**: Empty state + message gap increase
3. **Phase 3**: Collapsible tool blocks + thinking blocks
4. **Phase 4**: Terminal toolbar labels + error banner
5. **Phase 5**: Settings visual polish

---

## Files to Modify

### Phase 1
- `src/presentation/views/chat/ChatView.tsx`
- `main.css` or component CSS

### Phase 2-3
- `src/presentation/components/chat/MessageRenderer.tsx`
- `src/presentation/components/chat/VirtualMessageList.tsx`
- New: `src/presentation/components/chat/CollapsibleBlock.tsx`
- CSS files

### Phase 4
- `src/presentation/components/terminal/TerminalPanel.tsx`
- `src/presentation/components/terminal/terminal.css`

### Phase 5
- `src/presentation/components/settings/SettingsPanel.tsx`
- `src/presentation/components/settings/settings-panel.css`

---

## Out of Scope (Deferred)

- Conversation title dropdown in header (requires session naming)
- Additional input bar buttons (current complexity is sufficient)
- Drag-to-reorder MCP servers
- Animation/motion design beyond basics
