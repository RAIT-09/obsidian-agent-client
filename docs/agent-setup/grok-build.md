# Grok Build Setup

Grok Build is xAI's coding agent. This page covers the official xAI CLI (`grok`) — not a third-party Grok wrapper — which communicates via ACP through the `grok agent stdio` command (available since Grok Build CLI 1.0).

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install Grok Build:

::: code-group

```bash [macOS/Linux]
curl -fsSL https://x.ai/cli/install.sh | bash
```

```powershell [Windows]
irm https://x.ai/cli/install.ps1 | iex
```

:::

Other options are listed in the [Grok Build docs](https://docs.x.ai/build/overview).

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which grok
# Example output: /Users/username/.local/bin/grok (a symlink to ~/.grok/bin/grok)
```

```cmd [Windows]
where.exe grok
```

:::

3. Open **Settings → Agent Client**. The default command (`grok`) works in many cases. If the agent is not found automatically, set the **Grok Build path** to the path found above, or click **Auto-detect**.

::: tip "grok" not found (macOS/Linux)
The installer puts `grok` in `~/.grok/bin` and, when `~/.local/bin` or `/usr/local/bin` is already on your PATH, symlinks it there too. Agent Client starts agents from a login shell that reads `~/.zprofile` / `~/.profile` but not `~/.zshrc` / `~/.bashrc`, so the default command resolves only if one of those directories is exported there. If it is not found, click **Auto-detect** or set the **Grok Build path** to `~/.grok/bin/grok`. On Windows the installer adds `%USERPROFILE%\.grok\bin` to your user PATH, which Agent Client reads directly.
:::

4. Leave **Arguments** as `agent stdio` (set by default). Agent Client handles permission prompts in the chat, so do not add `--always-approve`.

## Authentication

Choose one of the following methods:

### Option A: Sign In (Interactive)

1. Run the login flow in your terminal:

```bash
grok login
```

2. Complete the browser sign-in.

3. In **Settings → Agent Client**, leave the **API key field empty** — the `grok agent stdio` process started by Agent Client reuses your session from `~/.grok/auth.json`.

### Option B: xAI API Key

API keys are created at [console.x.ai](https://console.x.ai) and bill API credits rather than a SuperGrok / X Premium subscription:

1. Generate a key in the xAI console
2. Enter it in **Settings → Agent Client → Preset agents → Grok Build → API key** (stored in Obsidian's Keychain)

A signed-in session takes precedence over the API key, so setting a key never breaks an existing login. To use the key instead, run `grok logout`.

::: tip Migrating from a custom agent
If you previously ran Grok Build as a custom agent, its settings are not migrated automatically. A custom agent with the id `grok-build` is renamed to `grok-build-2` to make room for the preset — copy any custom path or environment variables into the preset settings, then delete the leftover custom entry. If your custom agent carried `XAI_API_KEY` in its environment variables, consider moving it to the **API key** field so it is stored in Obsidian's Keychain instead of plain text.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Grok Build from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
