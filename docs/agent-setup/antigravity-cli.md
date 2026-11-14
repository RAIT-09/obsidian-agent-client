# Antigravity CLI Setup

Antigravity CLI is Google's coding agent. Agent Client connects directly through `agy acp`, available since CLI 1.5.0. Use the latest CLI release for subsequent ACP fixes. No separate ACP adapter is needed. See the [official ACP guide](https://antigravity.google/docs/cli/acp/) and [CLI changelog](https://antigravity.google/docs/changelog?tab=cli).

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows).

1. Install Antigravity CLI with the [official installer](https://antigravity.google/docs/getting-started):

::: code-group

```bash [macOS/Linux]
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

```powershell [Windows]
irm https://antigravity.google/cli/install.ps1 | iex
```

:::

2. Verify the installation and ACP support:

```bash
agy --version
agy acp --help
```

3. Open **Settings → Agent Client → Preset agents → Antigravity CLI**. The default command is `agy`. If it is not found, click **Auto-detect** or enter its absolute path. You can find it with `which agy` on macOS/Linux or `where.exe agy` on Windows.

4. Leave **Arguments** as `acp` (set by default).

## Authentication

### Google Account Login

1. Run `agy` in a terminal and complete sign-in and any initial setup prompts. Alternatively, run `agy acp --login` for the terminal login flow.
2. In **Settings → Agent Client → Preset agents → Antigravity CLI**, leave the **API key** field empty. The ACP process reuses your saved credentials.

See the [official authentication guide](https://antigravity.google/docs/install?tab=cli) for account and enterprise options.

### Gemini API Key

For ACP API-key authentication, obtain a key from [Google AI Studio](https://aistudio.google.com/apikey). In **Settings → Agent Client → Preset agents → Antigravity CLI → API key**, click **Link...** and select or create an Obsidian Keychain secret.

Agent Client passes the key as `GEMINI_API_KEY`, which the ACP server's `gemini-api-key` authentication method reads. See the [official ACP authentication instructions](https://antigravity.google/docs/ide/extensions/acp/#authentication) for authentication-method configuration.

::: tip Migrating from a custom agent
Custom agent settings are not automatically copied to this preset. A custom agent with the id `antigravity-cli` is renamed to `antigravity-cli-2` (or the next available suffix) to make room for the preset. Copy any custom path, arguments, and environment variables into the preset before removing the old entry. Saved sessions and code blocks using `antigravity-cli` resolve to the new preset.

If your custom agent stored `GEMINI_API_KEY` in its environment variables, use the preset's **API key** field instead so the key is stored in Obsidian's Keychain.
:::

## Verify Setup

1. Open a chat view and select **Antigravity CLI** from the agent menu.
2. Send a message, then try asking the agent to read or edit a vault note.
3. Review any permission request in the chat before approving it.

Models, thinking levels, and modes are supplied by the agent and depend on your account and CLI version. Antigravity reads project instructions from `AGENTS.md`, `GEMINI.md`, and `.agents/rules/`; see [Context Files](/usage/context-files) and Google's [rules documentation](https://antigravity.google/docs/rules/).

Having issues? See [Troubleshooting](/help/troubleshooting).
