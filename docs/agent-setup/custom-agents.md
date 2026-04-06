# Custom Agents Setup

You can use any agent that implements the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/agents).

## Install and Configure

1. Install your ACP-compatible agent (e.g., [OpenCode](https://github.com/anomalyco/opencode), [Qwen Code](https://github.com/QwenLM/qwen-code), [Kiro](https://kiro.dev/)).

2. Open **Settings → Agent Client** and scroll to **Custom Agents** section.

3. Click **Add custom agent**.

4. Configure the agent:
   - **Agent ID**: Unique identifier (e.g., `my-agent`)
   - **Display name**: Name shown in menus (e.g., `My Agent`)
   - **Path**: Command name or absolute path to the agent executable. The command name alone (e.g., `opencode`) works in many cases. If the agent is not found automatically, set the full path, or click **Auto-detect**.
   - **Arguments**: Command-line arguments, one per line (if required)
   - **Environment variables**: `KEY=VALUE` pairs, one per line (if required)

## Configuration Examples

### OpenCode

| Field | Value |
|-------|-------|
| **Agent ID** | `opencode` |
| **Display name** | `OpenCode` |
| **Path** | `opencode` |
| **Arguments** | `acp` |
| **Environment variables** | (optional) |

### Qwen Code

| Field | Value |
|-------|-------|
| **Agent ID** | `qwen-code` |
| **Display name** | `Qwen Code` |
| **Path** | `qwen` |
| **Arguments** | `--experimental-acp` |
| **Environment variables** | (optional) |

### Kiro

| Field | Value |
|-------|-------|
| **Agent ID** | `kiro-cli` |
| **Display name** | `Kiro` |
| **Path** | `kiro-cli` |
| **Arguments** | `acp` |
| **Environment variables** | (optional) |

## Authentication

Authentication depends on the specific agent. Common patterns:

- **API Key**: Add to **Environment variables** (e.g., `MY_API_KEY=xxx`)
- **Account Login**: Run the agent's CLI to authenticate, then leave environment variables empty

Refer to your agent's documentation for specific authentication instructions.

## Verify Setup

1. Click the robot icon in the ribbon or use the command palette: **"Open chat view"**
2. Select your custom agent from the agent dropdown in the chat header
3. Try sending a message to verify the connection

Having issues? See [Troubleshooting](/help/troubleshooting).
