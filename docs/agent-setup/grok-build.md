# Grok Build Setup

Grok Build is xAI's coding agent. It communicates via ACP through the `grok agent stdio` command (Grok Build CLI **1.0** and later). Confirm with `grok --version`.

This is the official xAI CLI (`grok`), not a third-party Grok wrapper.

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
# Example output: /Users/username/.local/bin/grok
```

```cmd [Windows]
where.exe grok
```

:::

3. Open **Settings → Agent Client**. The default command (`grok`) works in many cases. If the agent is not found automatically, set the **Grok Build path** to the path found above, or click **Auto-detect**.

Leave the arguments as `agent` and `stdio`. Agent Client handles permission prompts in the chat, so do not add `--always-approve`.

## Authentication

Choose one of the following methods:

### Option A: Sign In (Interactive)

1. Run the login flow in your terminal:

```bash
grok login
```

2. Complete the browser sign-in (SuperGrok or X Premium+).

3. In **Settings → Agent Client**, leave the **API key field empty** — the `grok agent stdio` process started by Agent Client reuses your session from `~/.grok/auth.json`.

### Option B: xAI API Key

Use this when there is **no** active `grok login` session — for example CI, a machine that never signed in, or after `grok logout`. API keys are created at [console.x.ai](https://console.x.ai) and bill API credits, which is a different account path from SuperGrok / X Premium+.

1. Generate a key in the xAI console
2. Enter it in **Settings → Agent Client → Preset agents → Grok Build → API key** (stored in Obsidian's Keychain)

The plugin injects the secret as `XAI_API_KEY`. An active `grok login` session in `~/.grok/auth.json` takes precedence over that environment variable, so a linked key does not override an existing browser login (and will not switch billing to the API-key account). To use the key, run `grok logout` first, or delete `~/.grok/auth.json`.

A per-model `api_key` / `env_key` in `~/.grok/config.toml` is a separate, higher-precedence override. It is not the plugin API-key field.

::: tip Migrating from a custom agent
If you previously ran Grok Build as a custom agent, its settings are not migrated automatically. A custom agent with the id `grok-build` is renamed to `grok-build-2` to make room for the preset — copy any custom path or environment variables into the preset settings, then delete the leftover custom entry. If your custom agent carried `XAI_API_KEY` in its environment variables, consider moving it to the **API key** field so it is stored in Obsidian's Keychain instead of plain text.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Grok Build from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
