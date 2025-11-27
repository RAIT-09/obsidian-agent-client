# UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Agent Client plugin UI to match VS Code Claude Code extension style, with input anchored at bottom.

**Architecture:** Layout-first approach - fix flexbox structure (Phase 1), then parallelize visual work across three independent streams: Chat, Terminal, Settings.

**Tech Stack:** React 19, TypeScript, CSS (Obsidian variables), Obsidian API

---

## Dependency Graph

```
                    ┌─────────────────┐
                    │  Phase 1        │
                    │  Layout Fix     │
                    │  (BLOCKING)     │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Stream A       │ │  Stream B       │ │  Stream C       │
│  Chat Panel     │ │  Terminal Panel │ │  Settings Panel │
│                 │ │                 │ │                 │
│  A1: Empty      │ │  B1: Toolbar    │ │  C1: Model      │
│  A2: Message    │ │  B2: Error      │ │  C2: Toggles    │
│      gaps       │ │      banner     │ │  C3: Footer     │
│  A3: Tool       │ │                 │ │                 │
│      blocks     │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  Final          │
                    │  Integration    │
                    │  & Build        │
                    └─────────────────┘
```

**Parallel Execution:**
- Phase 1 must complete first (all streams depend on layout fix)
- Streams A, B, C can run in parallel (independent files)
- Within each stream, tasks are sequential

---

## Phase 1: Layout Fix (BLOCKING)

> **CRITICAL:** Complete this before starting any stream.

### Task 1.1: Fix Chat View Flex Structure

**Files:**
- Modify: `src/presentation/views/chat/ChatView.tsx:908-1232`

**Step 1: Update the chat tab panel wrapper**

In `ChatView.tsx`, find the chat tab panel (around line 917-1208). Wrap the content in a flex container:

```tsx
{activeTab === "chat" && (
  <div
    role="tabpanel"
    aria-labelledby="tab-chat"
    className="chat-tab-content"
  >
    {/* existing content */}
  </div>
)}
```

**Step 2: Add CSS for tab content flex structure**

Create or modify the chat view CSS. Add to the appropriate CSS file (create `src/presentation/views/chat/chat-view.css` if needed):

```css
/* Tab panel must propagate flex context */
.chat-tab-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Messages area fills available space and scrolls */
.chat-view-messages {
  flex: 1 1 0;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Input container stays at bottom */
.chat-input-container {
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
}
```

**Step 3: Verify the import**

If you created a new CSS file, import it in `ChatView.tsx`:

```tsx
import './chat-view.css';
```

**Step 4: Build and test**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 5: Manual test**

1. Open Obsidian
2. Open Agent Client panel
3. With NO messages, verify input is at the bottom (not floating in middle)
4. With messages, verify input stays at bottom as you scroll

**Step 6: Commit**

```bash
git add src/presentation/views/chat/
git commit -m "fix: anchor chat input at bottom with proper flex structure"
```

---

### Task 1.2: Fix Empty State Centering

**Files:**
- Modify: `src/presentation/views/chat/ChatView.tsx` (empty state div)
- Modify: CSS file from Task 1.1

**Step 1: Update empty state CSS**

Add to the CSS file:

```css
/* Empty state centers within the flex container */
.chat-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  text-align: center;
  gap: 12px;
  padding: 24px;
}
```

**Step 2: Build and test**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Manual test**

1. Create new chat session (no messages)
2. Verify empty state message is centered vertically in the messages area
3. Verify input is still anchored at bottom

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: center empty state while keeping input at bottom"
```

---

## Stream A: Chat Panel (PARALLELIZABLE)

> **Prerequisite:** Phase 1 complete

### Task A1: Redesign Empty State

**Files:**
- Modify: `src/presentation/views/chat/ChatView.tsx:994-999`
- Modify: CSS file

**Step 1: Update empty state JSX**

Find the empty state section (around line 994-999) and replace with:

```tsx
<div className="chat-empty-state">
  <div
    className="chat-empty-state-icon"
    ref={(el) => {
      if (el) setIcon(el, 'bot-message-square');
    }}
  />
  <p className="chat-empty-state-title">
    {!isSessionReady
      ? `Connecting to ${activeAgentLabel}...`
      : `Start a conversation with ${activeAgentLabel}`}
  </p>
  <p className="chat-empty-state-hint">
    Use <code>@</code> to mention notes, <code>/</code> for commands
  </p>
</div>
```

**Step 2: Add CSS**

```css
.chat-empty-state-icon {
  width: 48px;
  height: 48px;
  color: var(--text-muted);
  opacity: 0.6;
}

.chat-empty-state-icon svg {
  width: 100%;
  height: 100%;
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
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: var(--font-monospace);
}
```

**Step 3: Build and test**

Run: `npm run build`

**Step 4: Manual test**

1. New chat session
2. Verify icon appears centered
3. Verify hint text shows with styled code tags

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: redesign chat empty state with icon and hints"
```

---

### Task A2: Increase Message Gap

**Files:**
- Modify: CSS file

**Step 1: Update message gap**

The gap is already set in Task 1.1, but verify it's `8px` not `2px`:

```css
.chat-view-messages {
  /* ... other properties ... */
  gap: 8px;  /* Was 2px - too tight */
}
```

**Step 2: Build and test**

Run: `npm run build`

**Step 3: Manual test**

1. Have a conversation with multiple messages
2. Verify messages have visible separation (not cramped)

**Step 4: Commit (if change was needed)**

```bash
git add -A
git commit -m "style: increase message gap for better readability"
```

---

### Task A3: Create Collapsible Block Component

**Files:**
- Create: `src/presentation/components/shared/CollapsibleBlock.tsx`
- Create: `src/presentation/components/shared/collapsible-block.css`

**Step 1: Create the component**

```tsx
// src/presentation/components/shared/CollapsibleBlock.tsx

import * as React from 'react';
const { useState, useEffect, useRef } = React;
import { setIcon } from 'obsidian';
import './collapsible-block.css';

export interface CollapsibleBlockProps {
  icon: string;
  label: string;
  meta?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export const CollapsibleBlock: React.FC<CollapsibleBlockProps> = ({
  icon,
  label,
  meta,
  defaultExpanded = false,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const iconRef = useRef<HTMLSpanElement>(null);
  const chevronRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (iconRef.current) {
      setIcon(iconRef.current, icon);
    }
  }, [icon]);

  useEffect(() => {
    if (chevronRef.current) {
      setIcon(chevronRef.current, 'chevron-down');
    }
  }, []);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={`collapsible-block ${isExpanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="collapsible-block-header"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <span
          ref={iconRef}
          className="collapsible-block-icon"
          aria-hidden="true"
        />
        <span className="collapsible-block-label">{label}</span>
        {meta && <span className="collapsible-block-meta">{meta}</span>}
        <span
          ref={chevronRef}
          className="collapsible-block-chevron"
          aria-hidden="true"
        />
      </button>
      {isExpanded && (
        <div className="collapsible-block-content">
          {children}
        </div>
      )}
    </div>
  );
};
```

**Step 2: Create the CSS**

```css
/* src/presentation/components/shared/collapsible-block.css */

.collapsible-block {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  overflow: hidden;
}

.collapsible-block-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: var(--background-secondary);
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--text-normal);
  font-size: 13px;
}

.collapsible-block-header:hover {
  background: var(--background-modifier-hover);
}

.collapsible-block-icon {
  width: 16px;
  height: 16px;
  color: var(--text-accent);
  flex-shrink: 0;
}

.collapsible-block-label {
  font-weight: 500;
}

.collapsible-block-meta {
  flex: 1;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collapsible-block-chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.collapsible-block.expanded .collapsible-block-chevron {
  transform: rotate(180deg);
}

.collapsible-block-content {
  padding: 12px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .collapsible-block-chevron {
    transition: none;
  }
}
```

**Step 3: Export from shared index**

If there's an index file in shared/, add the export. Otherwise, skip this step.

**Step 4: Build and test**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/presentation/components/shared/CollapsibleBlock.tsx
git add src/presentation/components/shared/collapsible-block.css
git commit -m "feat: add CollapsibleBlock component for tool/thinking blocks"
```

---

## Stream B: Terminal Panel (PARALLELIZABLE)

> **Prerequisite:** Phase 1 complete

### Task B1: Add Text Labels to Toolbar Buttons

**Files:**
- Modify: `src/presentation/components/terminal/TerminalPanel.tsx:126-158`
- Modify: `src/presentation/components/terminal/terminal.css`

**Step 1: Update toolbar JSX**

Find the toolbar section (around line 128-150) and update the buttons:

```tsx
<div className="terminal-toolbar" role="toolbar" aria-label="Terminal controls">
  <button
    ref={restartIconRef}
    type="button"
    className="terminal-toolbar-button"
    onClick={handleRestart}
    title="Restart Claude"
    aria-label="Restart Claude process"
  >
    <span className="terminal-toolbar-button-icon" />
    <span className="terminal-toolbar-button-label">Restart</span>
  </button>
  <button
    ref={clearIconRef}
    type="button"
    className="terminal-toolbar-button"
    onClick={handleClear}
    title="Clear terminal"
    aria-label="Clear terminal output"
  >
    <span className="terminal-toolbar-button-icon" />
    <span className="terminal-toolbar-button-label">Clear</span>
  </button>
  <div className="terminal-toolbar-spacer" />
  <div className="terminal-status" aria-live="polite">
    <span className={`terminal-status-dot ${status}`} aria-hidden="true" />
    <span>{getStatusLabel()}</span>
  </div>
</div>
```

**Step 2: Update icon refs**

Update the useEffect hooks to target the icon spans inside buttons:

```tsx
useEffect(() => {
  if (restartIconRef.current) {
    const iconSpan = restartIconRef.current.querySelector('.terminal-toolbar-button-icon');
    if (iconSpan) setIcon(iconSpan as HTMLElement, 'refresh-cw');
  }
}, []);

useEffect(() => {
  if (clearIconRef.current) {
    const iconSpan = clearIconRef.current.querySelector('.terminal-toolbar-button-icon');
    if (iconSpan) setIcon(iconSpan as HTMLElement, 'trash-2');
  }
}, []);
```

**Step 3: Add CSS**

Add to `terminal.css`:

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
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.terminal-toolbar-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.terminal-toolbar-button:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}

.terminal-toolbar-button-icon {
  width: 14px;
  height: 14px;
}

.terminal-toolbar-button-label {
  font-weight: 500;
}
```

**Step 4: Build and test**

Run: `npm run build`

**Step 5: Manual test**

1. Open Terminal tab
2. Verify buttons show icon + text label
3. Verify hover states work

**Step 6: Commit**

```bash
git add src/presentation/components/terminal/
git commit -m "feat: add text labels to terminal toolbar buttons"
```

---

### Task B2: Add Error Banner Component

**Files:**
- Modify: `src/presentation/components/terminal/TerminalPanel.tsx`
- Modify: `src/presentation/components/terminal/terminal.css`

**Step 1: Add error detection state**

Add state to track if we should show an error banner:

```tsx
const [showErrorBanner, setShowErrorBanner] = useState(false);
const [errorMessage, setErrorMessage] = useState<string | null>(null);

// Update when status changes to error
useEffect(() => {
  if (status === 'error') {
    setShowErrorBanner(true);
    // Could parse specific errors from PTY output
    setErrorMessage('Process exited unexpectedly');
  } else if (status === 'running') {
    setShowErrorBanner(false);
    setErrorMessage(null);
  }
}, [status]);
```

**Step 2: Add error banner JSX**

Add after the toolbar, before the terminal container:

```tsx
{showErrorBanner && (
  <div className="terminal-error-banner" role="alert">
    <div className="terminal-error-banner-header">
      <span
        className="terminal-error-banner-icon"
        ref={(el) => {
          if (el) setIcon(el, 'alert-triangle');
        }}
      />
      <span className="terminal-error-banner-title">
        {errorMessage || 'An error occurred'}
      </span>
    </div>
    <p className="terminal-error-banner-message">
      Check that the command path is correct in plugin settings.
    </p>
    <button
      type="button"
      className="terminal-error-banner-action"
      onClick={() => {
        // Navigate to settings - you may need to emit an event or use callback
        setShowErrorBanner(false);
      }}
    >
      Dismiss
    </button>
  </div>
)}
```

**Step 3: Add CSS**

```css
.terminal-error-banner {
  margin: 12px;
  padding: 12px;
  background: rgba(var(--color-red-rgb), 0.1);
  border: 1px solid var(--text-error);
  border-radius: 6px;
}

.terminal-error-banner-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.terminal-error-banner-icon {
  width: 16px;
  height: 16px;
  color: var(--text-error);
}

.terminal-error-banner-title {
  font-weight: 500;
  color: var(--text-error);
}

.terminal-error-banner-message {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 12px 0;
}

.terminal-error-banner-action {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.terminal-error-banner-action:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

**Step 4: Build and test**

Run: `npm run build`

**Step 5: Manual test**

1. Open Terminal tab
2. If process fails, verify error banner appears
3. Verify dismiss button works

**Step 6: Commit**

```bash
git add src/presentation/components/terminal/
git commit -m "feat: add error banner to terminal panel"
```

---

## Stream C: Settings Panel (PARALLELIZABLE)

> **Prerequisite:** Phase 1 complete

### Task C1: Improve Model Selection Cards

**Files:**
- Modify: `src/presentation/components/settings/SettingsPanel.tsx:213-232`
- Modify: `src/presentation/components/settings/settings-panel.css`

**Step 1: Update model option JSX**

Find the model options section and update:

```tsx
<div className="settings-model-options">
  {MODEL_OPTIONS.map((option) => (
    <label
      key={option.id}
      className={`settings-model-option ${settings.model === option.id ? 'selected' : ''}`}
    >
      <input
        type="radio"
        name="model"
        value={option.id}
        checked={settings.model === option.id}
        onChange={() => updateSetting('model', option.id)}
      />
      <span className="settings-model-option-name">{option.label}</span>
      <span className="settings-model-option-description">{option.description}</span>
    </label>
  ))}
</div>
```

**Step 2: Update CSS**

Replace the model option styles in `settings-panel.css`:

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
  text-align: center;
}

.settings-model-option:hover {
  border-color: var(--text-accent);
  background: var(--background-secondary);
}

.settings-model-option.selected {
  border-color: var(--interactive-accent);
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.settings-model-option input[type="radio"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.settings-model-option-name {
  font-weight: 600;
  font-size: 13px;
}

.settings-model-option-description {
  font-size: 11px;
  opacity: 0.8;
}

.settings-model-option.selected .settings-model-option-description {
  opacity: 0.9;
}
```

**Step 3: Build and test**

Run: `npm run build`

**Step 4: Manual test**

1. Open Settings tab
2. Verify model cards display horizontally
3. Verify selected card has filled accent background
4. Verify hover states work
5. Verify keyboard navigation (Tab + Enter) works

**Step 5: Commit**

```bash
git add src/presentation/components/settings/
git commit -m "style: improve model selection cards with better visual feedback"
```

---

### Task C2: Replace Checkboxes with Toggle Switches

**Files:**
- Modify: `src/presentation/components/settings/SettingsPanel.tsx:245-273`
- Modify: `src/presentation/components/settings/settings-panel.css`

**Step 1: Update checkbox inputs**

Find the permission checkboxes and add the toggle class:

```tsx
<input
  type="checkbox"
  className="settings-toggle"
  checked={settings.permissions?.autoApproveFileOps ?? false}
  onChange={(e) =>
    updateSetting('permissions', {
      ...settings.permissions,
      autoApproveFileOps: e.target.checked,
    })
  }
/>
```

Do the same for the terminal checkbox and "Show thinking" checkbox.

**Step 2: Add toggle CSS**

Add to `settings-panel.css`:

```css
.settings-toggle {
  appearance: none;
  -webkit-appearance: none;
  width: 36px;
  height: 20px;
  background: var(--background-modifier-border);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
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

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .settings-toggle,
  .settings-toggle::before {
    transition: none;
  }
}
```

**Step 3: Build and test**

Run: `npm run build`

**Step 4: Manual test**

1. Open Settings tab
2. Verify toggles display as switches (not checkboxes)
3. Verify clicking toggles the state
4. Verify keyboard focus is visible

**Step 5: Commit**

```bash
git add src/presentation/components/settings/
git commit -m "style: replace checkboxes with toggle switches"
```

---

### Task C3: Implement Sticky Footer

**Files:**
- Modify: `src/presentation/components/settings/SettingsPanel.tsx:208-413`
- Modify: `src/presentation/components/settings/settings-panel.css`

**Step 1: Restructure JSX**

Wrap the settings sections in a scrollable content div:

```tsx
return (
  <div className="settings-panel">
    <div className="settings-content">
      {/* Model Selection */}
      <div className="settings-section">
        {/* ... */}
      </div>

      {/* Permissions */}
      <div className="settings-section">
        {/* ... */}
      </div>

      {/* Custom System Prompt */}
      <div className="settings-section">
        {/* ... */}
      </div>

      {/* MCP Servers */}
      <div className="settings-section">
        {/* ... */}
      </div>

      {/* Display Options */}
      <div className="settings-section">
        {/* ... */}
      </div>
    </div>

    {/* Footer - outside scrollable area */}
    <div className="settings-footer">
      <button className="settings-reset-button" onClick={handleReset}>
        Reset to Defaults
      </button>
      <button
        className="settings-save-button"
        onClick={handleSave}
        disabled={!isDirty || isSaving}
      >
        {isSaving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  </div>
);
```

**Step 2: Update CSS**

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

.settings-section {
  margin-bottom: 24px;
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

**Step 3: Build and test**

Run: `npm run build`

**Step 4: Manual test**

1. Open Settings tab
2. Scroll through settings content
3. Verify footer stays visible at bottom (doesn't scroll away)
4. Verify Save/Reset buttons work

**Step 5: Commit**

```bash
git add src/presentation/components/settings/
git commit -m "feat: implement sticky footer for settings panel"
```

---

## Final Integration

### Task F1: Build and Verify

**Step 1: Full build**

```bash
npm run build
```

Expected: Build succeeds without errors

**Step 2: Format check**

```bash
npm run format:check
```

If formatting issues, run:
```bash
npm run format
```

**Step 3: Manual verification checklist**

- [ ] Chat: Input anchored at bottom with no messages
- [ ] Chat: Input anchored at bottom with many messages
- [ ] Chat: Empty state shows icon and hints
- [ ] Chat: Messages have proper spacing
- [ ] Terminal: Toolbar shows text labels
- [ ] Terminal: Error banner appears on failure
- [ ] Settings: Model cards are horizontal pills
- [ ] Settings: Toggles display as switches
- [ ] Settings: Footer is sticky when scrolling

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final integration and cleanup for UI redesign"
```

---

## Parallel Execution Summary

| Stream | Tasks | Can Start After |
|--------|-------|-----------------|
| Phase 1 | 1.1, 1.2 | Immediately |
| Stream A | A1, A2, A3 | Phase 1 complete |
| Stream B | B1, B2 | Phase 1 complete |
| Stream C | C1, C2, C3 | Phase 1 complete |
| Final | F1 | All streams complete |

**Optimal parallel execution:**
1. One agent completes Phase 1 (blocking)
2. Three agents work simultaneously on Streams A, B, C
3. Merge and run final integration

**Estimated time:**
- Phase 1: ~15 minutes
- Streams A, B, C (parallel): ~20 minutes each, but run concurrently = ~20 minutes total
- Final integration: ~10 minutes
- **Total: ~45 minutes** (vs ~90 minutes sequential)
