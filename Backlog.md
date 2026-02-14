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

## Epic 1: Basic Tab Infrastructure 🔴 MVP

### User Story 1.1: Display Single Tab by Default 🔴 P0
**As a** plugin user
**I want** to see one tab when I open the Agent Client view
**So that** I have a clear starting point for my conversation

**Acceptance Criteria:**
- [ ] When plugin loads, ChatView displays exactly one tab
- [ ] Tab shows agent name + timestamp (e.g., "Claude Code 2:34 PM")
- [ ] Tab uses default agent from settings
- [ ] Tab creates new empty session automatically
- [ ] Existing chat functionality (messages, input) works as before
- [ ] No visual regressions in header or message area


**Definition of Done:**
- Existing functionality unaffected

---

### User Story 1.2: Create New Tab with + Button 🔴 P0
**As a** plugin user
**I want** to click a + button to create a new tab
**So that** I can start multiple independent conversations

**Acceptance Criteria:**
- [ ] + button visible in tab bar (right side of tabs)
- [ ] Clicking + creates new tab with default agent
- [ ] New tab becomes active automatically
- [ ] New tab label shows agent name + current timestamp
- [ ] New tab creates new session with unique sessionId
- [ ] New tab spawns new agent process (separate from other tabs)
- [ ] Previous tab's session/process remains running
- [ ] Can create unlimited tabs (no limit for MVP)

**Test Cases:**
1. Click + → New tab appears with label "Claude Code [time]"
2. Send message in tab 1, click +, verify tab 2 is independent
3. Create 5 tabs, verify all have unique labels and sessions
4. Verify each tab has separate agent process (check adapters map)

**Technical Notes:**
- Add `createTab(agentId?: string)` method to `useTabManager`
- Generate tab ID: `${viewId}-tab-${tabs.length}`
- Create adapter with key: tabId
- Initialize session via `useAgentSession.createSession()`
- Switch to new tab index after creation

**Definition of Done:**
- Can create multiple tabs via + button
- Each tab is independent (separate process, messages, input)
- Agent processes remain alive when switching tabs

---

### User Story 1.3: Switch Between Tabs 🔴 P0
**As a** plugin user
**I want** to click on a tab to switch to it
**So that** I can view and interact with different conversations

**Acceptance Criteria:**
- [ ] Clicking a tab makes it active (switches focus)
- [ ] Active tab shows visual distinction (e.g., different background)
- [ ] Switching tabs shows correct messages for that tab
- [ ] Switching tabs shows correct input field state for that tab
- [ ] Background tab's agent continues generating (doesn't stop)
- [ ] Input text typed in tab A is not visible when switching to tab B
- [ ] Attached images in tab A are not visible when switching to tab B
- [ ] Session state (modes, models) preserved per tab

**Test Cases:**
1. Tab A: Type "hello" in input → Switch to tab B → Verify input is empty
2. Tab A: Send message "test" → Switch to tab B → Tab A still shows "test" message
3. Tab A: Agent generating response → Switch to tab B → Switch back to tab A → Verify generation completed
4. Tab A: Attach image → Switch to tab B → Verify no image attached in tab B

**Technical Notes:**
- Implement `switchTab(index: number)` in `useTabManager`
- Save current tab state before switching: `setTabState(activeTabIndex, currentState)`
- Load new tab state after switching: `restoreTabState(getTabState(newIndex))`
- Update `activeTabIndex` state
- Ensure each tab maintains separate:
  - `messages: ChatMessage[]`
  - `inputValue: string`
  - `attachedImages: AttachedImage[]`
  - `isSending: boolean`
  - `session: ChatSession`

**Definition of Done:**
- Clicking tabs switches between them smoothly
- Each tab maintains independent state
- No data leakage between tabs
- Background processes continue running

---

### User Story 1.4: Close Tab with × Button 🔴 P0
**As a** plugin user
**I want** to close a tab by clicking the × button
**So that** I can remove conversations I no longer need

**Acceptance Criteria:**
- [ ] Each tab displays × button on the right side
- [ ] Clicking × closes that tab (removes from tab bar)
- [ ] Closing a tab cancels any active operation in that tab
- [ ] Closing a tab disconnects the agent process for that tab
- [ ] No confirmation dialog shown (as per Q12)
- [ ] If closing active tab, switch to adjacent tab (prefer left)
- [ ] If closing non-active tab, active tab stays active
- [ ] Tab indices adjust correctly after closing

**Test Cases:**
1. 3 tabs open, close middle tab → Verify 2 tabs remain, correct tab is active
2. Close tab with active generation → Verify process is cancelled
3. Close tab with unsent input → Verify input is lost (no warning)
4. Close active tab → Verify switches to previous tab
5. Close non-active tab → Verify active tab stays active

**Technical Notes:**
- Add × button to Tab component, `onClick` calls `onClose` prop
- Implement `closeTab(index: number)` in `useTabManager`
- Cancel operation: `await acpAdapter.cancel(sessionId)`
- Disconnect adapter: `await plugin.removeAdapter(tabId)`
- Remove from tabs array: `tabs.filter((_, i) => i !== index)`
- Adjust activeTabIndex if needed:
  - If closing active tab: `Math.max(0, index - 1)`
  - If closing before active tab: `activeTabIndex - 1`
- Prevent × button click from triggering tab switch (stopPropagation)

**Definition of Done:**
- Can close any tab via × button
- Agent process terminates when tab closes
- Correct tab becomes active after closing
- No memory leaks (adapters cleaned up)

---

### User Story 1.5: Auto-Create Tab When Last Tab Closed 🔴 P0
**As a** plugin user
**I want** a new empty tab to be created automatically when I close the last tab
**So that** I always have at least one tab to work with

**Acceptance Criteria:**
- [ ] When closing the last remaining tab, a new empty tab is created
- [ ] New tab uses default agent from settings
- [ ] New tab has fresh session (no messages)
- [ ] New tab label shows agent name + current timestamp
- [ ] User doesn't see empty state (always at least 1 tab)
- [ ] Transition is smooth (no flicker)

**Test Cases:**
1. Open plugin (1 tab) → Close tab → Verify new empty tab created
2. Create 3 tabs → Close all 3 → Verify ends with 1 empty tab
3. Last tab has messages → Close → Verify new tab is empty (fresh session)

**Technical Notes:**
- In `closeTab()` function, check if `newTabs.length === 0`
- If true, call `await createTab()` before completing close operation
- Ensure smooth transition (may need to defer UI update)

**Definition of Done:**
- Impossible to have zero tabs
- Closing last tab creates new empty tab automatically
- No error states or empty views

---

## Epic 2: Tab Integration with Existing Features 🟡 Enhanced

### User Story 2.1: Load Session from History into New Tab 🟡 P1
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

**Technical Notes:**
- Modify `handleRestoreSession` in `useSessionHistory`
- Check if `messages.length === 0` before loading
- If empty: Load into current tab (existing behavior)
- If not empty: Call `createTab()` then load session into new tab
- Update tab label with session metadata

**Definition of Done:**
- History loading respects empty/non-empty tab state
- Session history replay works in new tab
- No interference with other tabs

---

### User Story 2.2: Switch Agent for Current Tab Only 🟡 P1
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

**Technical Notes:**
- Modify `handleSwitchAgent` to work with current tab index
- Disconnect current tab's adapter
- Create new adapter with same tabId
- Update tab state: `agentId`, `label`
- Call `createSession()` for current tab only

**Definition of Done:**
- Agent switching is per-tab, not global
- Each tab can have different agent
- Switching doesn't affect other tabs

---

### User Story 2.3: Export Current Tab Only 🟡 P1
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

**Technical Notes:**
- Modify `handleExportChat` to use current tab's:
  - `messages` array
  - `session.sessionId`
  - `session.agentDisplayName`
- No changes needed to ChatExporter class (already uses passed params)
- Auto-export already works per session, should work per tab

**Definition of Done:**
- Export button exports current tab only
- Exported file has correct messages and metadata
- Auto-export works correctly with tabs

---

### User Story 2.4: Remove "New Chat" from Header Menu 🟡 P1
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

### User Story 3.1: Tab Overflow with Horizontal Scroll 🟢 P2
**As a** plugin user
**I want** tabs to shrink and scroll horizontally when there are many tabs
**So that** I can manage many conversations without UI breaking

**Acceptance Criteria:**
- [ ] Tabs shrink in width as more tabs are added (min width: 80px)
- [ ] When tabs reach minimum width, tab bar becomes scrollable
- [ ] Horizontal scroll arrows appear (or scrollbar)
- [ ] Scrolling is smooth and intuitive
- [ ] Active tab is auto-scrolled into view when switching
- [ ] Behavior matches Obsidian's file tab overflow
- [ ] Tab labels truncate with ellipsis (...) when too long

**Technical Notes:**
- Use CSS: `overflow-x: auto` on tab list container
- Calculate tab width: `max(80px, available-width / tab-count)`
- Use existing Obsidian CSS classes if possible
- Auto-scroll to active tab: `scrollIntoView({ behavior: 'smooth' })`
- Tab label: `text-overflow: ellipsis; white-space: nowrap`

**Definition of Done:**
- Many tabs (10+) handled gracefully
- UI doesn't break with overflow
- Scrolling works smoothly
- Matches Obsidian's UX patterns

---

### User Story 3.2: Tab Styling Matches Obsidian Editor Tabs 🟢 P2
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

**Technical Notes:**
- Use Obsidian CSS variables:
  - `--background-primary`
  - `--background-secondary`
  - `--background-modifier-border`
  - `--background-modifier-hover`
  - `--text-normal`
  - `--text-muted`
  - `--interactive-accent`
- Reference Obsidian's `.workspace-tab-header` classes
- Test in both light and dark themes
- Test with community themes

**Definition of Done:**
- Tabs look native to Obsidian
- Works in light and dark themes
- Consistent with Obsidian's design language

---

### User Story 3.3: Update ChatHeader Layout 🟢 P2
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

**Technical Notes:**
- Remove `agentLabel` from ChatHeader component props
- Remove `h3.agent-client-chat-view-header-title` element
- Remove `onNewChat` from ChatHeader props (handled by TabBar)
- Adjust CSS for header layout
- Update ChatHeader styling

**Definition of Done:**
- Header shows only action buttons
- Layout is clean and professional
- No visual artifacts or empty spaces

---

## Epic 4: Future Enhancements (Phase 2+) 🔵 Future

### User Story 4.1: Background Tab Activity Indicator 🔵 P3
**As a** plugin user
**I want** to see a loading spinner on tabs where the agent is generating
**So that** I know which background tabs are active

**Acceptance Criteria:**
- [ ] When background tab's agent is generating, show spinner icon on tab label
- [ ] Spinner animates smoothly
- [ ] Spinner disappears when generation completes
- [ ] Spinner doesn't interfere with tab label readability
- [ ] Active tab doesn't need spinner (user can see messages streaming)

**Technical Notes:**
- Track `isSending` state per tab
- If `isSending && !isActive`, show spinner icon
- Use Obsidian's lucide icons or CSS animation
- Position spinner before or after tab label

**Definition of Done:**
- Background activity is visible
- Helps user know when to check other tabs
- Doesn't clutter UI

---

### User Story 4.2: Tab Persistence Across Restarts 🔵 P3
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

**Technical Notes:**
- Save `tabs: TabState[]` to `ChatViewState` in `getState()`
- Restore tabs in `setState()` or `onOpen()`
- For each tab: Call `loadSession()` only when switched to (lazy)
- Use `agentCapabilities.loadSession` for history replay
- Handle tabs whose sessions no longer exist

**Definition of Done:**
- Tabs survive Obsidian restart
- Session history loads on demand
- Performance acceptable (doesn't slow startup)

---

### User Story 4.3: Keyboard Shortcuts for Tabs 🔵 P3
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

**Technical Notes:**
- Register commands in `plugin.ts`
- Add to `addCommand()` with keyboard hotkeys
- Call appropriate tab manager methods
- Test for conflicts with Obsidian hotkeys

**Definition of Done:**
- Keyboard shortcuts work as expected
- Registered in Obsidian's hotkey settings
- No conflicts with existing shortcuts

---

### User Story 4.4: Tab Context Menu (Right-Click) 🔵 P3
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

**Technical Notes:**
- Use Obsidian's `Menu` class
- Handle `oncontextmenu` event on Tab component
- Position menu near mouse cursor
- Implement menu actions via tab manager

**Definition of Done:**
- Context menu works on right-click
- Menu actions functional
- UX matches Obsidian patterns

---

### User Story 4.5: Dynamic Tab Labels from First Message 🔵 P3
**As a** plugin user
**I want** tab labels to update with a summary of my first message
**So that** I can identify tabs by their content

**Acceptance Criteria:**
- [ ] After sending first message, tab label updates
- [ ] Label format: "Agent - First message summary" (truncated to 30 chars)
- [ ] Original timestamp preserved in tooltip
- [ ] User can manually rename tab (override auto-label)
- [ ] Empty tabs still show timestamp

**Technical Notes:**
- Listen for first message in tab
- Extract first 30 chars of user message
- Update tab label: `updateTabLabel(index, newLabel)`
- Store original timestamp in tab state
- Add tooltip showing full info

**Definition of Done:**
- Tab labels more descriptive
- Helps identify tabs by content
- Optional manual override

---

## Implementation Roadmap

### 🔴 MVP (Phase 1) - Required for Initial Release
**Timeline: ~2-3 weeks**

| Week | User Stories | Focus |
|------|--------------|-------|
| Week 1 | 1.1, 1.2, 1.3 | Core tab infrastructure |
| Week 2 | 1.4, 1.5, 2.1 | Tab operations & history integration |
| Week 3 | 2.2, 2.3, 2.4, 3.1, 3.2, 3.3 | Feature integration & UI polish |

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
- Tab overflow handling (3.1)
- Tab styling (3.2)
- Header layout update (3.3)

---

### 🔵 Future Enhancements (Phase 3+) - Based on User Feedback
**Timeline: Post-launch iterations**

- Background activity indicators (4.1)
- Tab persistence (4.2)
- Keyboard shortcuts (4.3)
- Tab context menu (4.4)
- Dynamic tab labels (4.5)
- Tab reordering (drag & drop)
- Export all tabs
- Tab limits & management

---

## Technical Dependencies

### Prerequisites
- [ ] Review and understand current session management (`useAgentSession`)
- [ ] Review current adapter management in `plugin.ts`
- [ ] Review ChatView lifecycle and state management
- [ ] Design `TabState` and `TabComponentState` interfaces

### Core Components to Create
- [ ] `useTabManager` hook
- [ ] `TabBar` component
- [ ] `Tab` component
- [ ] Tab styling CSS

### Components to Modify
- [ ] `ChatView.tsx` - Add tab management
- [ ] `ChatHeader.tsx` - Remove agent label, + button
- [ ] `HeaderMenu.tsx` - Remove "New chat" option
- [ ] `plugin.ts` - Update adapter key format
- [ ] `useChatController.ts` - Work with tab context

### Testing Strategy
- [ ] Unit tests for `useTabManager` hook
- [ ] Integration tests for tab operations
- [ ] Manual testing checklist for each user story
- [ ] Cross-browser testing (Obsidian desktop)
- [ ] Theme compatibility testing (light/dark)

---

## Notes


