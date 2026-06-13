# Claude Code Setup

Claude Code is Anthropic's AI coding assistant. You can use it with either an **API key** or by **logging in with your Anthropic account**.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install claude-agent-acp:

```bash
npm install -g @agentclientprotocol/claude-agent-acp
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which claude-agent-acp
# Example output: /usr/local/bin/claude-agent-acp
```

```cmd [Windows]
where.exe claude-agent-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\claude-agent-acp.cmd
```

:::

3. Open **Settings → Agent Client**. The default command (`claude-agent-acp`) works in many cases. If the agent is not found automatically, set the **Claude Code path** to the path found above, or click **Auto-detect**.

## Authentication

Choose one of the following methods:

### Option A: API Key

1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Open **Settings → Agent Client → Built-in agents → Claude Code → API key**
3. Click the **Link...** button next to the API key field
4. In the **Select secret** dialog:
   - To use an existing secret: select it from the list and click **Save**
   - To create a new one: click **Add secret...**, enter an ID (lowercase letters, numbers, and dashes only — e.g., `claude-api-key`), paste your API key, then click **Save**

Once linked, the field shows the masked secret value with a **Change** button to swap secrets.

::: tip Managing secrets
API keys are stored in **Obsidian's Keychain** (Settings → Keychain). You can rename, edit, or delete secrets there at any time. The same secret can be shared across plugins by referencing the same ID.
:::

::: info Upgrading from a previous version
If you previously stored your Claude API key in this plugin (v0.10.x or earlier), it is automatically migrated to Obsidian's Keychain as `claude-api-key` the first time you load the upgraded plugin. A one-time notification confirms the migration.

If `claude-api-key` is already in use by another plugin with a different value, your key is preserved under `agent-client-claude-api-key` instead. You can rename it from **Settings → Keychain** if you prefer.
:::

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

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. You should see the chat panel open and connect to Claude Code
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
