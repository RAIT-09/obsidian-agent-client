# Claude Code Setup

Claude Code is Anthropic's AI coding assistant. You can use it with either an **API key** or by **logging in with your Anthropic account**.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install claude-code-acp:

```bash
npm install -g @zed-industries/claude-code-acp
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which claude-code-acp
# Example output: /usr/local/bin/claude-code-acp
```

```cmd [Windows]
where.exe claude-code-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd
```

:::

3. Open **Settings → Agent Client** and set the **Claude Code path** to the path found above.

## Authentication

Choose one of the following methods:

### Option A: API Key

1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Enter the API key in **Settings → Agent Client → Claude Code → API key**

### Option B: Account Login

If you have a Claude subscription and prefer not to use an API key, you can log in with your Anthropic account.

::: warning Important
This requires installing **Claude Code CLI** separately. The CLI creates the login session that the plugin uses.
:::

1. Install Claude Code CLI by running the following command in your terminal:

::: code-group

```bash [macOS/Linux]
curl -fsSL https://claude.ai/install.sh | bash
```

```powershell [Windows]
irm https://claude.ai/install.ps1 | iex
```

:::

2. Login via CLI by running:

```bash
claude
```

Follow the prompts to authenticate with your Anthropic account.

3. In **Settings → Agent Client**, leave the **API key field empty**.

::: tip
The Claude Desktop app uses a different authentication system. Having Claude Desktop running does **not** authenticate the plugin — you must log in via the CLI.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open agent chat"**
2. You should see the chat panel open and connect to Claude Code
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
