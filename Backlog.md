# Multi-Tab Chat Interface - Requirements & Backlog

## Purpose
This document captures requirements, design decisions, and implementation backlog for the multi-tab chat interface feature.

---

## Terminology Reference

| Term | Definition | Example |
|------|------------|---------|
| **Session** | ACP session with agent process + sessionId | `session-abc123` created when tab opens |
| **Conversation** | Messages array within a session | User: "Help me", Agent: "Sure!" |
| **Tab** | UI container for one session + conversation | Tab labeled "Claude Code 2:34 PM" |
| **Agent** | The AI being used | Claude Code, Gemini CLI, etc. |
| **View** | The entire sidebar pane | "Agent client" view with multiple tabs |

**Key Relationship:**
- Current: 1 View = 1 Session = 1 Conversation
- With Tabs: 1 View = Multiple Tabs, Each Tab = 1 Session = 1 Conversation

---

## Confirmed Requirements

### Architecture
- ✅ Multiple sessions within one ChatView (Option A)
- ✅ Each tab is independent (separate agent process, continues in background)
- ✅ Keep all tab agent processes running for fast switching
- ✅ No tab limit initially

### Tab Labels
- ✅ Agent name + timestamp (e.g., "Claude Code 2:34 PM")
- ✅ Simpler implementation preferred

### Tab Operations
- ✅ "+" button creates new tab
- ✅ Load from history opens as new tab
- ✅ Active operation (agent generating) continues when switching tabs
- ✅ Unsent input lost when closing tab (same as current close view behavior)

### Persistence
- ✅ Phase 1: No persistence (tabs don't survive Obsidian restart)
- ✅ Phase 2: Restore all tabs with session history

### Export
- ✅ Export current tab only (initially)

### Initial State
- ✅ On plugin load: Create one tab with default agent and new empty conversation

---

## Backlog

### Priority Levels
- 🔴 **P0 - MVP**: Core functionality, must have for initial release
- 🟡 **P1 - Enhanced**: Important but not blocking initial release
- 🟢 **P2 - Polish**: Nice-to-have, improves UX
- 🔵 **P3 - Future**: Phase 2+ features, deferred

---

## Epic 2: Tab Integration with Existing Features 🟡 Enhanced

### User Story: Load Session from History into New Tab 🟡 P1
**As a** plugin user
**I want** to load a previous session from history into a new tab
**So that** I can resume past conversations without losing my current work

**Acceptance Criteria:**
- [ ] Clicking history button opens session history modal (existing behavior)
- [ ] If current tab is empty (no messages), load session into current tab
- [ ] If current tab has messages, create new tab and load session there
- [ ] New/loaded tab shows session messages (history replay)
- [ ] New/loaded tab label shows agent name + session creation time
- [ ] Original tabs remain unaffected

**Test Cases:**
1. Empty tab → Load session → Verify session loads into current tab
2. Tab with messages → Load session → Verify new tab created
3. 3 tabs open, load session → Verify 4th tab created with loaded session
4. Load session → Verify all messages appear in correct order


**Definition of Done:**
- History loading respects empty/non-empty tab state
- Session history replay works in new tab
- No interference with other tabs

---

### User Story: Switch Agent for Current Tab Only 🟡 P1
**As a** plugin user
**I want** to switch agents and have it only affect the current tab
**So that** I can use different agents in different tabs

**Acceptance Criteria:**
- [ ] Header menu "Switch agent" option exists
- [ ] Selecting new agent restarts only the current tab's session
- [ ] Current tab's label updates to new agent name
- [ ] Other tabs remain unaffected (keep their agents)
- [ ] Can have Claude in tab 1, Gemini in tab 2, etc.
- [ ] Current tab's messages are cleared (same as current behavior)

**Test Cases:**
1. Tab 1 (Claude), Tab 2 (Gemini) → Switch tab 1 to Gemini → Verify tab 2 still Claude
2. Switch agent → Verify only current tab restarts
3. Switch agent → Verify tab label updates
4. Switch agent → Verify messages cleared in current tab only


**Definition of Done:**
- Agent switching is per-tab, not global
- Each tab can have different agent
- Switching doesn't affect other tabs

---

### User Story: Export Current Tab Only 🟡 P1
**As a** plugin user
**I want** the export button to export only the current tab's conversation
**So that** I can save individual conversations to markdown

**Acceptance Criteria:**
- [ ] Clicking export button exports active tab's messages only
- [ ] Export filename includes tab's agent name and session ID
- [ ] Export behavior same as current (settings respected)
- [ ] Other tabs' conversations not included in export
- [ ] Works with auto-export on new chat (exports active tab before clearing)
- [ ] Works with auto-export on close (exports closing tab)

**Test Cases:**
1. 3 tabs with different messages → Export → Verify only active tab exported
2. Tab 1: 5 messages, Tab 2: 3 messages → Export from tab 1 → Verify file has 5 messages
3. Close tab with auto-export enabled → Verify that tab's messages exported


**Definition of Done:**
- Export button exports current tab only
- Exported file has correct messages and metadata
- Auto-export works correctly with tabs

---

### User Story: Remove "New Chat" from Header Menu 🟡 P1
**As a** plugin user
**I want** the header menu to remove the "New chat" option
**So that** the UI is cleaner and uses the + button for new tabs

**Acceptance Criteria:**
- [ ] Header menu (three-dot menu) no longer shows "New chat" option
- [ ] Other menu options remain: Switch agent, Restart agent, Settings, etc.
- [ ] + button in tab bar is the only way to create new tab/chat
- [ ] Menu is organized and easy to use

**Technical Notes:**
- Remove "New chat" menu item from HeaderMenu component
- Keep other menu items intact
- Update menu layout if needed

**Definition of Done:**
- "New chat" removed from menu
- + button is primary way to create tabs
- Menu still accessible and functional

---

## Epic 3: Tab UI Polish 🟢 Polish

---

### User Story: Tab Styling Matches Obsidian Editor Tabs 🟢 P2
**As a** plugin user
**I want** the tab bar to look like Obsidian's native file tabs
**So that** the UI feels consistent and familiar

**Acceptance Criteria:**
- [ ] Tab colors match Obsidian theme (light/dark mode)
- [ ] Active tab styling matches Obsidian's active file tab
- [ ] Hover states match Obsidian's behavior
- [ ] Close button (×) styling matches Obsidian
- [ ] Font, spacing, padding match Obsidian tabs
- [ ] Animations/transitions match Obsidian (if any)

**Definition of Done:**
- Tabs look native to Obsidian
- Works in light and dark themes
- Consistent with Obsidian's design language

---

### User Story: Update ChatHeader Layout 🟢 P2
**As a** plugin user
**I want** the header to show only action buttons (no agent name)
**So that** the tab bar can show agent names per tab

**Acceptance Criteria:**
- [ ] Agent name removed from header
- [ ] + button removed from header (now in tab bar)
- [ ] Header shows only: [history] [save] [menu]
- [ ] Header height adjusts appropriately
- [ ] Layout is clean and balanced
- [ ] No empty space where agent name was


**Definition of Done:**
- Header shows only action buttons
- Layout is clean and professional
- No visual artifacts or empty spaces

---

## Epic 4: Future Enhancements (Phase 2+) 🔵 Future

### User Story: Background Tab Activity Indicator 🔵 P3
**As a** plugin user
**I want** to see a loading spinner on tabs where the agent is generating
**So that** I know which background tabs are active

**Acceptance Criteria:**
- [ ] When background tab's agent is generating, show spinner icon on tab label
- [ ] Spinner animates smoothly
- [ ] Spinner disappears when generation completes
- [ ] Spinner doesn't interfere with tab label readability
- [ ] Active tab doesn't need spinner (user can see messages streaming)


**Definition of Done:**
- Background activity is visible
- Helps user know when to check other tabs
- Doesn't clutter UI

---

### User Story: Tab Persistence Across Restarts 🔵 P3
**As a** plugin user
**I want** my tabs to be restored when I restart Obsidian
**So that** I can continue where I left off

**Acceptance Criteria:**
- [ ] All open tabs saved to ChatView state
- [ ] On plugin load, restore all tabs
- [ ] Session history lazy-loaded (only when switching to tab)
- [ ] Tab labels restored correctly
- [ ] Active tab index restored
- [ ] Empty tabs (no messages) not persisted

**Definition of Done:**
- Tabs survive Obsidian restart
- Session history loads on demand
- Performance acceptable (doesn't slow startup)

---

### User Story: Keyboard Shortcuts for Tabs 🔵 P3
**As a** plugin user
**I want** to use keyboard shortcuts to manage tabs
**So that** I can work more efficiently

**Acceptance Criteria:**
- [ ] Cmd/Ctrl + T: Create new tab
- [ ] Cmd/Ctrl + W: Close current tab
- [ ] Cmd/Ctrl + Tab: Next tab
- [ ] Cmd/Ctrl + Shift + Tab: Previous tab
- [ ] Shortcuts registered in Obsidian settings
- [ ] No conflicts with Obsidian's default shortcuts

**Definition of Done:**
- Keyboard shortcuts work as expected
- Registered in Obsidian's hotkey settings
- No conflicts with existing shortcuts

---

### User Story: Tab Context Menu (Right-Click) 🔵 P3
**As a** plugin user
**I want** to right-click a tab to see options
**So that** I can perform tab actions quickly

**Acceptance Criteria:**
- [ ] Right-click on tab opens context menu
- [ ] Menu shows: Close tab, Close other tabs, Close tabs to right
- [ ] Menu shows: Rename tab (future)
- [ ] Menu shows: Duplicate tab (fork session - future)
- [ ] Menu actions work correctly
- [ ] Menu dismisses on click away

**Definition of Done:**
- Context menu works on right-click
- Menu actions functional
- UX matches Obsidian patterns

---

### User Story: Dynamic Tab Labels from First Message 🔵 P3
**As a** plugin user
**I want** tab labels to update with a summary of my first message
**So that** I can identify tabs by their content

**Acceptance Criteria:**
- [ ] After sending first message, tab label updates
- [ ] Label format: "Agent - First message summary" (truncated to 30 chars)
- [ ] Original timestamp preserved in tooltip
- [ ] User can manually rename tab (override auto-label)
- [ ] Empty tabs still show timestamp


**Definition of Done:**
- Tab labels more descriptive
- Helps identify tabs by content
- Optional manual override

---

## Implementation Roadmap

### 🔴 MVP (Phase 1) - Required for Initial Release
**Timeline: ~2-3 weeks**

| Week | Focus | Details |
|------|-------|---------|
| Week 1 | Core tab infrastructure | Tab bar, switching, state management |
| Week 2 | Tab operations & history integration | Close, auto-create, history loading |
| Week 3 | Feature integration & UI polish | Agent switching, export, styling |

**MVP Deliverables:**
- ✅ Multiple independent tabs in sidebar view
- ✅ Create, switch, close tabs
- ✅ Load history into tabs
- ✅ Per-tab agent switching and export
- ✅ Basic tab styling and overflow handling

---

### 🟢 Enhanced Release (Phase 2) - After MVP Validation
**Timeline: +1-2 weeks**

Already included in MVP:
- Tab overflow handling
- Tab styling
- Header layout update

---

### 🔵 Future Enhancements (Phase 3+) - Based on User Feedback
**Timeline: Post-launch iterations**

- Background activity indicators
- Tab persistence
- Keyboard shortcuts
- Tab context menu
- Dynamic tab labels
- Tab reordering (drag & drop)
- Export all tabs
- Tab limits & management

---



