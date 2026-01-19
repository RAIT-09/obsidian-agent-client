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

3. Open **Settings → Agent Client** and set the **Codex path** to the path found above.

## Authentication

Choose one of the following methods:

### Option A: API Key

1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Enter the API key in **Settings → Agent Client → Codex → API key**

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
The ChatGPT app uses a different authentication system. Having ChatGPT running does **not** authenticate the plugin — you must log in via the CLI.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open agent chat"**
2. Switch to Codex from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
