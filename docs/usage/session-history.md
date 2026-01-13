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
| **Restore** | Resume the session where you left off |
| **Fork** | Create a new branch from that point in the conversation |
| **Delete** | Remove the session from history |

::: tip
Not all actions are available for every agent. The modal shows only the actions supported by your current agent.
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

::: warning
Deletion removes the session from the plugin's local storage only. The session still exists on the agent side.
:::

## Troubleshooting

### "This agent does not support session restoration"

The current agent doesn't provide session restore/fork capabilities. You can still view and delete locally saved sessions.

### "Preparing agent..."

The agent is still initializing. Wait a moment for the agent to become ready.

### "No previous sessions"

No sessions have been saved yet for the current agent and vault. Start a new conversation to create your first session.
