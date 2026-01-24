# Custom Agents Setup

You can use any agent that implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/overview/agents).

## Install and Configure

1. Install your ACP-compatible agent (e.g., [OpenCode](https://github.com/sst/opencode), [Qwen Code](https://github.com/QwenLM/qwen-code)).

2. Find the installation path by running the following command in your terminal (Terminal on macOS/Linux, PowerShell on Windows):

::: code-group

```bash [macOS/Linux]
which your-agent
# Example output: /usr/local/bin/your-agent
```

```cmd [Windows]
where.exe your-agent
# Example output: C:\Users\Username\AppData\Roaming\npm\your-agent.cmd
```

:::

3. Open **Settings → Agent Client** and scroll to **Custom Agents** section.

4. Click **Add custom agent**.

5. Configure the agent:
   - **Agent ID**: Unique identifier (e.g., `my-agent`)
   - **Display name**: Name shown in menus (e.g., `My Agent`)
   - **Path**: Absolute path to the agent executable
   - **Arguments**: Command-line arguments, one per line (if required)
   - **Environment variables**: `KEY=VALUE` pairs, one per line (if required)

## Authentication

Authentication depends on the specific agent. Common patterns:

- **API Key**: Add to **Environment variables** (e.g., `MY_API_KEY=xxx`)
- **Account Login**: Run the agent's CLI to authenticate, then leave environment variables empty

Refer to your agent's documentation for specific authentication instructions.

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open agent chat"**
2. Select your custom agent from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
