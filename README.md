# 🤖 Agent Client Plugin for Obsidian

[日本語はこちら](README.ja.md)

<a href="https://www.buymeacoffee.com/rait09" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" height="50" ></a>

Bring your AI agents directly into Obsidian! This plugin lets you chat with Claude Code, Codex, Gemini CLI, and other AI agents right from your vault. Your AI assistant is now just a side panel away. ✨

Built on [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol) by Zed.

https://github.com/user-attachments/assets/567f22dc-dd32-446d-8fc5-c8cdec8b2744

## ✨ Features

- 🔗 **Direct Agent Integration**: Chat with AI coding agents in a dedicated right-side panel
- 📝 **Note Mention Support**: Automatically include the active note in conversations, or manually use `@notename` to reference specific notes
- ⚡ **Slash Command Support**: Use `/` commands to browse and trigger actions provided by your current agent
- 🔄 **Multi-Agent Support**: Switch between Claude Code, Codex, Gemini CLI, and custom agents
- 💻 **Terminal Integration**: Let your agent execute terminal commands and return the results in chat
- 🔐 **Permission Management**: Fine-grained control over agent actions

## 📦 Installation
### 🧪 Install via BRAT
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the Community Plugins browser.
2. In Obsidian settings, go to Community Plugins → BRAT → Add Beta Plugin.
3. Paste this repo URL:
   ```
   https://github.com/RAIT-09/obsidian-agent-client
   ```
4. BRAT will download the latest release and keep it auto-updated.
5. Enable Agent Client from the plugin list.

### 💻 Manual Installation
1. Download the latest release files from [GitHub Releases](https://github.com/RAIT-09/obsidian-agent-client/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create plugin folder and place the files in: `VaultFolder/.obsidian/plugins/agent-client/`
3. Enable the plugin in Obsidian Settings → Community Plugins

## ⚙️ Configuration

### Step 1: 📦 Install Required Dependencies

- For **Claude Code**:
  ```bash
  npm install -g @zed-industries/claude-code-acp
  ```

- For **Codex**:
  ```bash
  npm install -g @zed-industries/codex-acp
  ```

- For **Gemini CLI**:
  ```bash
  npm install -g @google/gemini-cli
  ```

### Step 2: 🔍 Find Installation Paths

After installing the agents, you need to find their absolute paths:

**On macOS/Linux:**
```bash
# Find Node.js path
which node
# Example output: /usr/local/bin/node

# Find Claude Code path
which claude-code-acp
# Example output: /usr/local/bin/claude-code-acp

# Find Codex path
which codex-acp
# Example output: /usr/local/bin/codex-acp

# Find Gemini CLI path
which gemini
# Example output: /usr/local/bin/gemini
```

**On Windows:**
```cmd
# Find Node.js path
where.exe node
# Example output: C:\Program Files\nodejs\node.exe

# Find Claude Code path
where.exe claude-code-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd

# Find Codex path
where.exe codex-acp
# Example output: C:\Users\Username\AppData\Roaming\npm\codex-acp.cmd

# Find Gemini CLI path
where.exe gemini
# Example output: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
```

### Step 3: 🛠️ Configure Plugin Settings

1. Open **Settings → Agent Client**
2. Configure your node path:
   - **Node.js path**: Enter the absolute path found above (e.g., `/usr/local/bin/node` or `C:\Program Files\nodejs\node.exe`)
3. Configure your preferred agents:
   - **Claude Code**:
     - **Path**: Enter absolute path (e.g., `/usr/local/bin/claude-code-acp`)
     - **API key**: Optional if logged in to Anthropic account
   - **Codex**
	   - **Path**: Enter absolute path (e.g., `/usr/local/bin/codex-acp`)
	   - **API key**: Optional if logged in to OpenAI account
   - **Gemini CLI**:
     - **Path**: Enter absolute path (e.g., `/usr/local/bin/gemini`)
     - **API key**: Optional if logged in to Google account
   - **Custom Agents**: Add any ACP-compatible agents

### 📋 Example Configuration

**macOS/Linux Example:**
```
Settings:
├── Node.js path: /usr/local/bin/node

Built-in agents:
├── Claude Code
│   ├── Path: /usr/local/bin/claude-code-acp
│   └── API key: (optional)
├── Codex
│   ├── Path: /usr/local/bin/codex-acp
│   └── API key: (optional)
└── Gemini CLI
    ├── Path: /usr/local/bin/gemini
    └── API key: (optional)
```

**Windows Example:**
```
Settings:
├── Node.js path: C:\Program Files\nodejs\node.exe

Built-in agents:
├── Claude Code
│   ├── Path: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd
│   └── API key: (optional)
├── Codex
│   ├── Path: C:\Users\Username\AppData\Roaming\npm\codex-acp.cmd
│   └── API key: (optional)
└── Gemini CLI
    ├── Path: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
    └── API key: (optional)
```

## 🚀 Usage

- 🎯 Use the command palette: "Open agent chat"
- 🤖 Click the robot icon in the ribbon
- 💬 Chat with your configured agent in the right panel
- 📝 Reference notes using `@notename` syntax
- 🔄 Switch agents using the dropdown in plugin settings

## 👨‍💻 Development

```bash
npm install
npm run dev
```

For production builds:
```bash
npm run build
```

## 🗺️ Roadmap

- **Model Switching Support**: Change the active model for each agent directly from the chat interface
- **Edit Tracking**: Automatically follow the agent’s edits — open affected notes and move the cursor as they edit
- **Chat History Access**: Browse, search, and restore previous chat sessions with agents

Have ideas or feature requests? Feel free to [open an issue](https://github.com/RAIT-09/obsidian-agent-client/issues) on GitHub!

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
