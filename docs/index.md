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

<div style="max-width: 800px; margin: 2rem auto;">
  <video controls autoplay loop muted playsinline style="width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
    <source src="/demo.mp4" type="video/mp4">
  </video>
</div>

## What is Agent Client?

Agent Client is an Obsidian plugin that brings AI coding agents directly into your vault. Built on the [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/agent-client-protocol), it enables seamless communication with various AI agents.

### Supported Agents

| Agent | Provider | Integration |
|-------|----------|-------------|
| **[Claude Code](https://github.com/anthropics/claude-code)** | Anthropic | via [ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp) |
| **[Codex](https://github.com/openai/codex)** | OpenAI | via [ACP adapter](https://github.com/agentclientprotocol/codex-acp) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Google | with `--experimental-acp` option |
| **[Mistral Vibe](https://github.com/mistralai/mistral-vibe)** | Mistral AI | with built-in ACP support (`vibe-acp`) |
| **[OpenCode](https://github.com/anomalyco/opencode)** | Multi-provider | with built-in ACP support (`opencode acp`) |
| **[Kiro](https://kiro.dev/)** | AWS | with built-in ACP support (`kiro-cli acp`) |
| **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** | Multi-provider | with built-in ACP support (`hermes acp`) |
| **[Pi](https://github.com/earendil-works/pi)** | Multi-provider | via [ACP adapter](https://github.com/svkozak/pi-acp) (`pi-acp`) |
| **[Grok Build](https://docs.x.ai/build/overview)** | xAI | with built-in ACP support (`grok agent stdio`) |
| **Custom** | Various | [Any ACP-compatible agent](https://agentclientprotocol.com/overview/agents) (e.g., Qwen Code) |

### Key Features

- **Note Mentions**: Reference your Obsidian notes in conversations with `@notename`
- **File Editing**: Let agents read and modify files with permission controls
- **Chat Export**: Save conversations for future reference
- **Terminal Integration**: Agents can execute shell commands and show results inline

Ready to get started? Check out the [Installation Guide](/getting-started/).
