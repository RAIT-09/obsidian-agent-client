# Agent Setup Overview

Agent Client supports multiple AI agents through the [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol). This section covers how to set up each supported agent.

## Supported Agents

| Agent | Provider | Package |
|-------|----------|---------|
| [Claude Code](./claude-code) | Anthropic | `@zed-industries/claude-code-acp` |
| [Codex](./codex) | OpenAI | `@zed-industries/codex-acp` |
| [Gemini CLI](./gemini-cli) | Google | `@google/gemini-cli` |
| [Custom Agents](./custom-agents) | Various | Any ACP-compatible agent |

## Common Setup Steps

All agents follow a similar setup pattern:

1. **Install the agent package** via npm
2. **Find the installation path** using `which` (macOS/Linux) or `where.exe` (Windows)
3. **Configure the path** in Settings → Agent Client
4. **Set up authentication** (API key or account login)

## WSL Mode (Windows)

For Windows users, we recommend using **WSL Mode** for better compatibility:

1. Install [WSL](https://docs.microsoft.com/en-us/windows/wsl/install)
2. Install Node.js and agents inside WSL
3. Enable **WSL Mode** in Settings → Agent Client
4. Use Linux-style paths (e.g., `/usr/local/bin/node`)

## Switching Agents

Once you have multiple agents configured, you can switch between them using the dropdown in Settings → Agent Client.
