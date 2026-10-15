# IBM Bob Setup

IBM Bob is IBM's AI coding agent. This page covers how to set it up to work with Agent Client via the `bob acp` command.

## Install and Configure

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run the following commands.

1. Install Bob Shell by following the [IBM Bob installation guide](https://bob.ibm.com/docs/shell/getting-started/install-and-setup).

2. Verify the installation:

```bash
bob --version
```

3. Find the installation path if needed:

::: code-group

```bash [macOS/Linux]
which bob
# Example output: /usr/local/bin/bob
```

```cmd [Windows]
where.exe bob
```

:::

4. Open **Settings → Agent Client**. The default command (`bob`) with the argument `acp` is pre-configured. If the agent is not found automatically, set the **IBM Bob path** to the path found above, or click **Auto-detect**.

5. Leave **Arguments** as `acp` (set by default). This is required to start IBM Bob in ACP mode.

## Authentication

Bob supports a saved browser login or an API key. An API key is optional if you have already signed in to Bob Shell on this machine. See IBM's [ACP authentication documentation](https://bob.ibm.com/docs/shell/features/acp#authentication).

### Browser Login

1. Open a terminal in your vault directory and run `bob`.
2. Complete the browser sign-in when prompted.
3. Exit Bob Shell and connect to IBM Bob from Agent Client. Bob reuses the saved token; leave the plugin's API key field empty.

### API Key

1. Obtain your IBM Bob API key from your IBM account.
2. In **Settings → Agent Client**, go to **Preset agents → IBM Bob → API key**.
3. Click **Link...** and enter or create a secret in Obsidian's Keychain.

The API key is injected as the `BOBSHELL_API_KEY` environment variable when the agent starts.

## Workspace Trust

Bob requires a trusted workspace before creating an ACP session, regardless of the authentication method. In a terminal, change to your vault directory, run `bob`, and confirm workspace trust when prompted. Then exit Bob Shell and reconnect from Agent Client. For **New chat in directory**, trust that directory instead.

See IBM's [workspace trust documentation](https://bob.ibm.com/docs/shell/features/acp#workspace-trust).

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Switch to IBM Bob from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
