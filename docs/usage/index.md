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

## Sending Images

You can attach images to your messages by pasting or dragging and dropping.

1. **Paste**: Copy an image to your clipboard and paste (`Cmd/Ctrl + V`) in the input field
2. **Drag and Drop**: Drag image files directly onto the input area

Attached images appear as thumbnails below the text area. Click the **×** on a thumbnail to remove it.

<p align="center">
  <img src="/images/sending-images.webp" alt="Sending Images" width="400" />
</p>

::: tip
Image attachments require agent support. If the agent doesn't support images, a notification will appear when you try to attach one.
:::

See [Sending Images](/usage/sending-images) for more details.

## Switching Agents

To switch agents for the current view:

1. Click the **⋮** (ellipsis) menu in the chat header
2. Select **"Switch agent"**
3. The agent switches immediately

This is a one-time change for that view only.

<p align="center">
  <img src="/images/switch-agent.webp" alt="Switch agent menu" width="400" />
</p>

::: tip
To change the default agent for new chat views, go to **Settings → Agent Client → Default agent**.

<img src="/images/switch-default-agent.webp" alt="Default agent setting" />
:::

## Multiple Chat Views

You can open multiple chat views to run independent conversations simultaneously. Each view has its own agent process and session.

See [Multi-Session Chat](/usage/multi-session) for details on:
- Opening multiple views
- Broadcast commands
- Focus navigation

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
