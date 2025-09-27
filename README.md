# Agent Client Plugin for Obsidian

Bring your AI coding buddies directly into Obsidian! This plugin lets you chat with Claude Code, Gemini CLI, and other AI agents right from your vault. Your coding companion is now just a side panel away.

## Features

- **Direct Agent Integration**: Chat with AI coding agents in a dedicated right-side panel
- **Note Mention Support**: Use `@notename` to reference notes in your vault within agent conversations
- **Multi-Agent Support**: Switch between Claude Code, Gemini CLI, and custom agents
- **Terminal Integration**: Execute commands and see results directly in the chat
- **Permission Management**: Fine-grained control over agent actions

## Installation

1. Download the latest release
2. Extract to your Obsidian plugins folder: `VaultFolder/.obsidian/plugins/agent-client/`
3. Enable the plugin in Obsidian Settings → Community Plugins

## Configuration

1. Open Settings → Agent Client
2. Configure your preferred agents:
   - **Claude Code**: Set command path, and API key if you're not logging in with your Anthropic account
   - **Gemini CLI**: Set command path, and API key if you're not logging in with your Google account
   - **Custom Agents**: Add any ACP-compatible agents

## Usage

- Use the command palette: "Open Agent Chat"
- Click the robot icon in the ribbon
- Chat with your configured agent in the right panel
- Reference notes using `@notename` syntax
- Switch agents using the dropdown in plugin settings

## Requirements

- For **Claude Code**:
  ```bash
  npm install -g @zed-industries/claude-code-acp
  ```

- For **Gemini CLI**:
  ```bash
  npm install -g @google/gemini-cli
  ```

- Any other Agent Client Protocol compatible tools

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

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
