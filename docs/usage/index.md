# Basic Usage

## Opening the Chat Panel

You can open the Agent Client chat panel in two ways:

- **Ribbon Icon**: Click the robot icon in the left ribbon

<p align="center">
  <img src="/images/ribbon-icon.webp" alt="Ribbon Icon" />
</p>

- **Command Palette**: Open the command palette (`Cmd/Ctrl + P`) and search for **"Open agent chat"**

The chat panel opens in the right sidebar.

## Sending Messages

1. Type your message in the input field at the bottom
2. Press `Enter` or click the send button
3. Wait for the agent's response

<p align="center">
  <img src="/images/sending-messages.webp" alt="Sending Messages" />
</p>

## Switching Agents

To switch between agents:

1. Open plugin settings via **Obsidian Settings → Agent Client**, or click the **gear icon** in the chat header
2. Select an agent from the **Active agent** dropdown

<p align="center">
  <img src="/images/switching-agents.webp" alt="Switching Agents" />
</p>

::: tip
- If no conversation has started, the agent switches immediately.
- If a conversation is in progress, click **New Chat** to apply the change.
- You can also use the command palette (`Cmd/Ctrl + P`) and search for **"New chat with [Agent Name]"** to switch agents directly.
:::

## Changing Models and Modes

Below the input field, you'll find dropdowns to:

- **Change Model**: Switch between different AI models (e.g., Sonnet, Haiku for Claude)
- **Change Mode**: Switch agent modes (e.g., Plan Mode)

::: tip
Available models and modes depend on the active agent.
:::

## Starting a New Chat

Click the **New Chat** button in the header to start a fresh conversation. The previous chat can optionally be exported (see Settings).

## Stopping Generation

If the agent is generating a response and you want to stop it, click the **Stop** button that appears during generation.
