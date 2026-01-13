# Note Mentions

Reference your Obsidian notes directly in conversations with AI agents.

## Auto-Mention Active Note

When enabled, the plugin automatically includes the currently active note in your message. This is useful when you want to discuss or work on the note you're viewing.

Enable this in **Settings → Agent Client → Mentions → Auto-mention active note**.

### How Auto-Mention Works

Unlike manual mentions, auto-mention only passes the **note's file path** to the agent—not its full content. The agent can then use its Read tool to examine the file if needed.

When auto-mention is active, a badge appears above the input field showing the current note name (e.g., `@My Note`).

### Temporary Disable

You can temporarily disable auto-mention for a single message by clicking the **×** button next to the badge. Click the **+** button to re-enable it. This toggle only affects the current message—auto-mention will be active again for subsequent messages.

<p align="center">
  <img src="/images/temporary-disable.gif" alt="Temporarily disabling auto-mention" />
</p>

### Selection Context

If you select text in your note, the selected lines are passed as context to the agent. The badge will show the line range (e.g., `@My Note:5-10`), and the agent receives both the file path and the selected content.

<p align="center">
  <img src="/images/selection-context.gif" alt="Selection context feature" />
</p>

## Manual Mentions

Use the `@` syntax to reference specific notes:

```
@[[My Note]]
```

As you type `@`, a dropdown appears with matching notes from your vault. Select a note to insert the mention.

### How Manual Mentions Work

When you send a message with manual mentions:

1. The plugin reads the content of the mentioned notes
2. The note content is included in the message sent to the agent
3. The agent can then reference, analyze, or modify the note content

## Length Limits

To prevent excessively large messages, the plugin limits the amount of content included:

| Setting | Default | Description |
|---------|---------|-------------|
| **Max note length** | 10,000 characters | Maximum characters per mentioned note |
| **Max selection length** | 10,000 characters | Maximum characters for text selection in auto-mention |

Configure these in **Settings → Agent Client → Mentions**.

::: tip
Content exceeding the limit is truncated with a note indicating the original length.
:::

## Tips

- Use manual mentions to include specific notes as context
- Mention multiple notes to give the agent a broader understanding
- For large notes, consider selecting the relevant portion and using auto-mention instead
