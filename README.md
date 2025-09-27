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

### Step 1: Install Required Dependencies

- For **Claude Code**:
  ```bash
  npm install -g @zed-industries/claude-code-acp
  ```

- For **Gemini CLI**:
  ```bash
  npm install -g @google/gemini-cli
  ```

### Step 2: Find Installation Paths

After installing the agents, you need to find their absolute paths:

**On macOS/Linux:**
```bash
# Find Node.js path
which node
# Example output: /usr/local/bin/node

# Find Claude Code path
which claude-code-acp
# Example output: /usr/local/bin/claude-code-acp

# Find Gemini CLI path
which gemini
# Example output: /usr/local/bin/gemini
```

**On Windows:**
```cmd
# Find Node.js path
where node
# Example output: C:\Program Files\nodejs\node.exe

# Find Claude Code path
where claude-code-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd

# Find Gemini CLI path
where gemini
# Example output: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
```

### Step 3: Configure Plugin Settings

1. Open **Settings → Agent Client**
2. In **General Settings**:
   - **Node.js path**: Enter the absolute path found above (e.g., `/usr/local/bin/node` or `C:\Program Files\nodejs\node.exe`)
3. Configure your preferred agents:
   - **Claude Code**:
     - **Path**: Enter absolute path (e.g., `/usr/local/bin/claude-code-acp`)
     - **API key**: Optional if logged in to Anthropic account
   - **Gemini CLI**:
     - **Path**: Enter absolute path (e.g., `/usr/local/bin/gemini`)
     - **API key**: Optional if logged in to Google account
   - **Custom Agents**: Add any ACP-compatible agents

### Example Configuration

**macOS/Linux Example:**
```
General Settings:
├── Node.js path: /usr/local/bin/node

Built-in agents:
├── Claude Code
│   ├── Path: /usr/local/bin/claude-code-acp
│   └── API key: (optional)
└── Gemini CLI
    ├── Path: /usr/local/bin/gemini
    └── API key: (optional)
```

**Windows Example:**
```
General Settings:
├── Node.js path: C:\Program Files\nodejs\node.exe

Built-in agents:
├── Claude Code
│   ├── Path: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd
│   └── API key: (optional)
└── Gemini CLI
    ├── Path: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
    └── API key: (optional)
```

## Usage

- Use the command palette: "Open Agent Chat"
- Click the robot icon in the ribbon
- Chat with your configured agent in the right panel
- Reference notes using `@notename` syntax
- Switch agents using the dropdown in plugin settings

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
