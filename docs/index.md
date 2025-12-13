---
layout: home

hero:
  name: "Agent Client"
  text: "AI Agents in Obsidian"
  tagline: Chat with Claude Code, Codex, Gemini CLI, and more — right from your vault
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/RAIT-09/obsidian-agent-client

features:
  - icon: 🤖
    title: Direct Agent Integration
    details: Chat with AI coding agents in a dedicated right-side panel
  - icon: 📝
    title: Note Mentions
    details: Mention any note with @notename to include its content in your prompt
  - icon: ⚡
    title: Slash Commands
    details: Use / commands to quickly trigger agent actions
  - icon: 🔄
    title: Multi-Agent Support
    details: Switch between Claude Code, Codex, Gemini CLI, and custom agents
  - icon: 🎛️
    title: Mode & Model Selection
    details: Change AI models and agent modes directly from the chat
  - icon: 💻
    title: Terminal Integration
    details: Let your agent execute commands and return results in chat
---

## What is Agent Client?

Agent Client is an Obsidian plugin that brings AI coding agents directly into your vault. Built on the [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/agent-client-protocol), it enables seamless communication with various AI agents.

### Supported Agents

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](https://github.com/anthropics/claude-code)** | Anthropic | via [Zed’s SDK adapter](https://github.com/zed-industries/claude-code-acp) |
| **[Codex](https://github.com/openai/codex)** | OpenAI | via [Zed’s adapter](https://github.com/zed-industries/codex-acp) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Google | with `--experimental-acp` option |
| **Custom** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., OpenCode, Qwen Code) |

### Key Features

- **Note Mentions**: Reference your Obsidian notes in conversations with `@notename`
- **File Editing**: Let agents read and modify files with permission controls
- **Chat Export**: Save conversations for future reference
- **Terminal Integration**: Agents can execute shell commands and show results inline

Ready to get started? Check out the [Installation Guide](/getting-started/).
