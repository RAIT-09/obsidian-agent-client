# Pi Setup

[Pi](https://github.com/earendil-works/pi) is a minimal, hackable terminal coding agent. It communicates via ACP through [pi-acp](https://github.com/svkozak/pi-acp), an adapter that spawns `pi --mode rpc` and bridges events between Agent Client and pi.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install pi and pi-acp (requires Node.js 22 or later):

```bash
npm install -g @earendil-works/pi-coding-agent pi-acp
```

2. Find the installation path:

::: code-group

```bash [macOS/Linux]
which pi-acp
# Example output: /Users/username/.npm-global/bin/pi-acp
```

```cmd [Windows]
where.exe pi-acp
```

:::

3. Open **Settings → Agent Client**. The default command (`pi-acp`) works in many cases. If the agent is not found automatically, set the **Pi path** to the path found above, or click **Auto-detect**.

::: tip "Could not start pi" error
`pi-acp` spawns `pi` as a child process, resolved via PATH. When an absolute Pi path is configured, Agent Client prepends that directory to PATH, so a `pi` installed next to `pi-acp` (the usual case) is found automatically. If `pi` lives in a different directory, make sure that directory is on your login shell's PATH (e.g. exported from `~/.zprofile` for zsh or `~/.profile` for bash — not only `~/.zshrc` / `~/.bashrc`).
:::

## Authentication

Pi manages provider credentials itself, so there is no API key field for it in Agent Client.

1. Run pi in your terminal and complete the interactive setup — pick a model, sign in with `/login`, or configure a provider API key (see the [pi docs](https://github.com/earendil-works/pi)):

```bash
pi
```

Alternatively, `pi-acp --terminal-login` launches the same interactive login directly.

2. Verify that a normal chat works in the terminal before connecting from Obsidian.

Credentials are stored under `~/.pi/agent/` and are picked up by the `pi-acp` process that Agent Client starts.

::: tip Migrating from a custom agent
If you previously ran Pi as a custom agent, its settings are not migrated automatically. A custom agent with the id `pi-acp` is renamed to `pi-acp-2` to make room for the preset — copy any custom path or environment variables into the preset settings, then delete the leftover custom entry.
:::

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to Pi from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
