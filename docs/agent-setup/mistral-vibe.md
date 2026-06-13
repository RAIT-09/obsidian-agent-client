# Mistral Vibe Setup

Mistral Vibe is Mistral AI's coding agent. It communicates via ACP through the `vibe-acp` command.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install Mistral Vibe:

```bash
curl -LsSf https://mistral.ai/vibe/install.sh | bash
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which vibe-acp
# Example output: /Users/username/.local/bin/vibe-acp
```

```cmd [Windows]
where.exe vibe-acp
```

:::

3. Open **Settings → Agent Client**. The default command (`vibe-acp`) works in many cases. If the agent is not found automatically, set the **Mistral Vibe path** to the path found above, or click **Auto-detect**.

## Authentication

Choose one of the following methods:

### Option A: Mistral Account Login (Interactive)

If you have a Mistral account and prefer not to use an API key:

1. Run Vibe in your terminal:

```bash
vibe
```

2. Follow the setup wizard to choose your authentication method.

3. In **Settings → Agent Client**, leave the **API key field empty**.

### Option B: Mistral API Key

If you prefer to use an API key for authentication:

1. Get your API key from the [Mistral Console](https://console.mistral.ai/)
2. Enter the API key in **Settings → Agent Client → Mistral Vibe → API key**

::: tip If the key isn't picked up
If authentication still fails, set the key on the Vibe side instead: run `vibe --setup` in your terminal and configure your API key (it's stored in `~/.vibe/.env`). Then leave the **API key field empty** in Agent Client.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Mistral Vibe from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
