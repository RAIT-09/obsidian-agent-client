# Codex Setup

Codex is OpenAI's AI coding assistant. You can use it with either an **API key** or by **logging in with your OpenAI account**.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install codex-acp:

```bash
npm install -g @zed-industries/codex-acp
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which codex-acp
# Example output: /usr/local/bin/codex-acp
```

```cmd [Windows]
where.exe codex-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\codex-acp.cmd
```

:::

3. Open **Settings → Agent Client**. The default command (`codex-acp`) works in many cases. If the agent is not found automatically, set the **Codex path** to the path found above, or click **Auto-detect**.

## Authentication

Choose one of the following methods:

### Option A: API Key

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Open **Settings → Agent Client → Built-in agents → Codex → API key**
3. Click the **Link...** button next to the API key field
4. In the **Select secret** dialog:
   - To use an existing secret: select it from the list and click **Save**
   - To create a new one: click **Add secret...**, enter an ID (lowercase letters, numbers, and dashes only — e.g., `openai-api-key`), paste your API key, then click **Save**

Once linked, the field shows the masked secret value with a **Change** button to swap secrets.

::: tip Managing secrets
API keys are stored in **Obsidian's Keychain** (Settings → Keychain). You can rename, edit, or delete secrets there at any time. The same secret can be shared across plugins by referencing the same ID.
:::

::: info Upgrading from a previous version
If you previously stored your OpenAI API key in this plugin (v0.10.x or earlier), it is automatically migrated to Obsidian's Keychain as `openai-api-key` the first time you load the upgraded plugin. A one-time notification confirms the migration.

If `openai-api-key` is already in use by another plugin with a different value, your key is preserved under `agent-client-openai-api-key` instead. You can rename it from **Settings → Keychain** if you prefer.
:::

### Option B: Account Login

If you have a ChatGPT subscription and prefer not to use an API key, you can log in with your OpenAI account.

::: warning Important
This requires installing **Codex CLI** separately. The CLI creates the login session that the plugin uses.
:::

1. Install Codex CLI by running the following command in your terminal:

```bash
npm install -g @openai/codex
```

2. Login via CLI by running:

```bash
codex
```

Follow the prompts to authenticate with your OpenAI account.

3. In **Settings → Agent Client**, leave the **API key field empty**.

::: tip
The ChatGPT app and Codex app use a different authentication system. Having ChatGPT running does **not** authenticate the plugin — you must log in via the CLI.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Codex from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
