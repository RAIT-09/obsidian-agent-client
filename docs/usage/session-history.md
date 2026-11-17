# Session History

Resume previous conversations or branch off from past sessions.

## Agent Support

Session history features are agent-specific. Not all agents support all features.

## Opening Session History

Click the **History** button (clock icon) in the chat header to open the session history modal.

<p align="center">
  <img src="/images/session-history-button.webp" alt="Session history button in chat header" />
</p>

## Available Actions

Depending on the agent's capabilities, you can perform the following actions:

| Action | Description |
|--------|-------------|
| **Edit title** | Rename the session from the history modal |
| **Restore** | Resume the session where you left off |
| **Fork** | Create a new branch from that point in the conversation |
| **Delete** | Remove the session from history (and from the agent, if it supports deleting) |

::: tip
Not all actions are available for every agent. The modal shows only the actions supported by your current agent.
:::

## Filtering the List

When the agent supports listing sessions, two checkboxes above the list narrow it down:

| Filter | Default | Description |
|--------|---------|-------------|
| **Show current vault only** | On | Ask the agent for sessions started in the current vault directory |
| **Hide sessions without local data** | Off | Show only sessions that were started from Obsidian (the plugin has a saved transcript for them) |

Your choices are remembered, so the modal reopens with the filters you last used.

## Searching and Paging

Type in the search box at the top of the list to find sessions by title. The search ignores case, and every word you type must appear in the title, in any order (`hover preview` finds "Fix hover link preview").

The list shows 50 sessions per page; use the arrows below it to move between pages. Older sessions are fetched from the agent as you page forward. While you search, or while **Hide sessions without local data** is on, the modal keeps fetching until the agent's whole history has been covered. A `+` after the total (e.g. `1–50 of 1000+`) means there are still sessions left to fetch. If fetching more fails, the sessions already loaded stay, with a **Retry** button below them.

::: tip
The list only contains sessions the agent still keeps. Some agents delete old sessions on their own — Claude Code, for example, removes transcripts not used for 30 days unless you raise [`cleanupPeriodDays`](https://code.claude.com/docs/en/settings-reference#cleanupperioddays) in its settings.
:::

## Session Storage

Sessions are saved automatically when you send messages. The plugin stores:

- **Session metadata**: Title (derived from your first message), timestamps, and working directory
- **Message history**: Full conversation including agent responses, tool calls, and plans

### Where Sessions Are Stored

Sessions are saved in two places:

- **Plugin side**: Stored locally in Obsidian's data folder
- **Agent side**: Managed by the agent

## Restore vs Fork

### Restore

Restoring a session continues the existing conversation:

1. The agent reconnects to the previous session
2. Your conversation history is displayed
3. New messages continue the same session

Use restore when you want to **continue where you left off**.

### Fork

Forking creates a new session branching from a previous point:

1. A new session is created with a copy of the conversation up to that point
2. The original session remains unchanged
3. New messages go to the forked session

Use fork when you want to **explore a different direction** without affecting the original conversation.

## Deleting Sessions

To delete a session:

1. Click the **Delete** button (trash icon) on the session
2. Confirm the deletion in the dialog

What gets deleted depends on the agent:

- **Agents that support deleting sessions** (such as Claude Code): the session is deleted from the plugin and from the agent, so it no longer appears in the list and can't be restored, from Obsidian or from the agent's own CLI.
- **Other agents**: the session is removed from the plugin's local storage only. It still exists on the agent side, and if the agent lists its sessions, it shows up again the next time you open the history. Turn on **Hide sessions without local data** to keep such sessions out of the list.

A session that is open in a chat in this vault can't be deleted. Start a new chat there (or close it) first. Sessions open elsewhere, such as in the agent's own CLI, aren't detected.

::: warning
Deletion is permanent. If you might still need the conversation, fork the session first: a fork is a separate session that stays when the original is deleted. Restoring doesn't keep a copy, since it continues the same session.
:::

## Troubleshooting

### "This agent does not support session restoration"

The current agent doesn't provide session restore/fork capabilities. You can still view and delete locally saved sessions.

### "Preparing agent..."

The agent is still initializing. Wait a moment for the agent to become ready.

### "No previous sessions"

No sessions have been saved yet for the current agent and vault. Start a new conversation to create your first session.
