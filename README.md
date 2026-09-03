<h1 align="center">Agent Client Plugin for Obsidian</h1>

<p align="center">
  <img src="https://img.shields.io/github/downloads/RAIT-09/obsidian-agent-client/total" alt="GitHub Downloads">
  <img src="https://img.shields.io/github/license/RAIT-09/obsidian-agent-client" alt="License">
  <img src="https://img.shields.io/github/v/release/RAIT-09/obsidian-agent-client" alt="GitHub release">
  <img src="https://img.shields.io/github/last-commit/RAIT-09/obsidian-agent-client" alt="GitHub last commit">
  <a href="https://github.com/RAIT-09/obsidian-agent-client/discussions"><img src="https://img.shields.io/github/discussions/RAIT-09/obsidian-agent-client" alt="GitHub Discussions"></a>
</p>

<p align="center">
  <a href="https://github.com/RAIT-09/obsidian-agent-client/blob/master/README.ja.md">日本語はこちら</a>
</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/agent-client" target="_blank"><img src="https://img.shields.io/badge/Add%20to%20Obsidian-7c3aed?logo=obsidian&logoColor=white&style=for-the-badge" alt="Add to Obsidian"></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/rait09" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" height="50" ></a>
</p>

Chat with Claude Code, Codex, Gemini CLI, and any ACP agent right in Obsidian — mention your notes with `@` and let the agent read and edit them in your vault. No copy-paste.

MCP servers, Agent Skills, slash commands, permission prompts — whatever your agent can do, it works here out of the box.

Built on the [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/agent-client-protocol) by Zed.

![Chat with an agent in the sidebar, right next to your notes](https://raw.githubusercontent.com/RAIT-09/obsidian-agent-client/master/docs/public/images/readme-hero-sidebar.webp)

## Turn Your Vault into a Front End for Your Agents

**Side by side.** Run several agents at once — in sidebar tabs, editor tabs, or floating windows — each with its own session and model. Broadcast a prompt to all of them, or cycle focus with a hotkey.

![Three agents running side by side in editor tabs](https://raw.githubusercontent.com/RAIT-09/obsidian-agent-client/master/docs/public/images/readme-multi-session.webp)

**Any folder.** Point a chat at any directory with *New chat in directory* — a code project, a writing project, wherever your agent normally works. The agent picks up that folder's context files and project configuration, and you can still hand it vault notes with `@` mentions.

**In your notes.** Embed a live chat inside any note with a code block — pin an agent, and let the conversation survive restarts with `persist`. Or add one-click agent buttons that fire a prepared prompt.

**Mission control.** The Session Manager lists every open conversation across sidebar, tabs, floating windows, and notes, with live status icons — including "waiting for permission". Click any entry to jump straight there.

**Any ACP agent.** Eight presets — Claude Code, Codex, Gemini CLI, Mistral Vibe, OpenCode, Kiro, Hermes Agent, Pi — plus any ACP-compatible agent as a custom entry. New agent ships ACP support tomorrow? Add it as a custom entry — no plugin update needed.

## Features

- **Note Mentions**: Reference notes with `@` — fuzzy search over names, paths, and aliases. The active note is auto-mentioned, down to the exact lines you selected
- **Obsidian-Ready Answers**: Agents are instructed to reply with `[[wikilinks]]`, `$LaTeX$`, and clean Markdown tables (configurable)
- **Wikilink Context**: `[[links]]` inside mentioned notes are surfaced as paths so the agent can decide which ones to read
- **MCP & Skills**: Agents use the MCP servers and skills they already have — nothing to configure in the plugin
- **Slash Commands**: Your agent's `/` commands, with inline argument hints
- **Images & Files**: Paste or drag-and-drop into the chat
- **Modes, Models & Config**: Switch them mid-session from the input toolbar, with a context-usage indicator
- **Visible Edits**: Note edits show up as word-level diffs in the chat — you see exactly what changed
- **Permission Prompts**: Approve or reject each agent action — from the banner or with a hotkey. Auto-allow is opt-in
- **Session History**: Conversations are saved locally — resume or fork past sessions (agent-dependent)
- **Chat Export**: Save conversations as Markdown notes with frontmatter, manually or automatically
- **Terminal Integration**: Agents run commands with live output in the chat
- **Floating Chat**: Draggable chat windows independent of the workspace — they remember their size and position
- **WSL Mode**: Run agents inside WSL on Windows

## Installation

1. Open **Settings → Community Plugins → Browse**
2. Search for **"Agent Client"**
3. Click **Install**, then **Enable**

## Get Started

1. Install and authenticate an agent, following its setup guide:

   [Claude Code](https://rait-09.github.io/obsidian-agent-client/agent-setup/claude-code.html) · [Codex](https://rait-09.github.io/obsidian-agent-client/agent-setup/codex.html) · [Gemini CLI](https://rait-09.github.io/obsidian-agent-client/agent-setup/gemini-cli.html) · [Mistral Vibe](https://rait-09.github.io/obsidian-agent-client/agent-setup/mistral-vibe.html) · [OpenCode](https://rait-09.github.io/obsidian-agent-client/agent-setup/opencode.html) · [Kiro](https://rait-09.github.io/obsidian-agent-client/agent-setup/kiro.html) · [Hermes Agent](https://rait-09.github.io/obsidian-agent-client/agent-setup/hermes.html) · [Pi](https://rait-09.github.io/obsidian-agent-client/agent-setup/pi.html) · [Custom Agents](https://rait-09.github.io/obsidian-agent-client/agent-setup/custom-agents.html)

2. Open **Settings → Agent Client** and check the agent's path — **Auto-detect** usually finds it
3. Click the robot icon in the ribbon and start chatting

**[Full Documentation](https://rait-09.github.io/obsidian-agent-client/)**

## Security & Permissions

Agent Client is a desktop-only plugin. It launches your locally installed agents as child processes and lets them run terminal commands — that is the core of what it does. The filesystem is only probed read-only for the **Auto-detect** button; all note reading and writing goes through Obsidian's vault API.

Keep in mind that **the agents themselves have the same full system access they have in a terminal**. The plugin surfaces every permission request so you can approve or reject each action; **Auto-allow permissions** (off by default) skips those prompts entirely — enable it only if you understand the implications.

API keys are stored in Obsidian's Keychain, never as plain text. What leaves your machine is what you send to your agent's provider: your messages, mentioned notes, and attachments.

## Other Ways to Install

### Via BRAT (Pre-release Versions)

To try pre-release versions before they are published to Community Plugins:

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Go to **Settings → BRAT → Add Beta Plugin**
3. Paste: `https://github.com/RAIT-09/obsidian-agent-client`
4. Enable **Agent Client** from the plugin list

### Manual Installation

1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/RAIT-09/obsidian-agent-client/releases)
2. Place them in `VaultFolder/.obsidian/plugins/agent-client/`
3. Enable the plugin in **Settings → Community Plugins**

## Development

```bash
npm install
npm run dev
```

For production builds:
```bash
npm run build
```

## License

Apache License 2.0 — see [LICENSE](https://github.com/RAIT-09/obsidian-agent-client/blob/master/LICENSE) for details.

## Contributors

Thanks to everyone who has contributed!

<a href="https://github.com/RAIT-09/obsidian-agent-client/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RAIT-09/obsidian-agent-client" alt="Contributors" />
</a>
