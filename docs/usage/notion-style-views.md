# Notion-Style Chat Views

Agent Client introduces two new ways to interact with your AI agents, inspired by Notion's flexible interface: **Floating Chat** and **Code Block Chat**. These views allow for a more seamless and integrated workflow.

## Floating Chat

The Floating Chat is a persistent, collapsible chat window that stays with you as you navigate your vault. It's perfect for quick questions or ongoing tasks that don't require a dedicated pane.

### Features

-   **Floating Action Button**: A customizable button (defaulting to the bottom-right corner) toggles the chat window.
-   **Persistent State**: The chat stays open or closed as you switch between notes.
-   **Independent Session**: The floating chat maintains its own session, separate from other chat views.
-   **Agent Switching**: Easily switch between agents directly from the floating header.

### Configuration

You can customize the Floating Chat in **Settings → Agent Client**:

-   **Show Floating Button**: Toggle the feature on or off.
-   **Button Image**: Provide a path to a custom image (local path or URL) to replace the default icon.
    -   *Tip:* Local images from your vault are fully supported!
-   **Window Size**: Adjust the default width and height of the floating window.
-   **Window Position**: The window's position is saved automatically when you move it.

## Code Block Chat

Embed a chat interface directly into any note using a Markdown code block. This allows you to contextually place AI interactions alongside your content, ideal for guided workflows or specific task contexts.

### Usage

Create a code block with the language `agent-client`:

```agent-client
image: path/to/avatar.png
agent: claude-code-acp
```

### Configuration Options

You can configure the embedded chat using YAML syntax within the code block:

-   `image`: Path to an image to display in the header (local vault path or URL).
-   `agent`: The ID of the agent to start with (e.g., `claude-code-acp`, `gemini-cli`).
-   `model`: (Optional) The specific model ID to use.
-   `height`: (Optional) CSS height value (e.g., `400px`).

### Example

```markdown
# Research Assistant

I'm using this agent to help summarize my daily notes.

```agent-client
image: Attachments/robot-avatar.png
agent: gemini-cli
```
```