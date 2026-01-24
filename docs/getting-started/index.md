# Installation

::: info 🚧 Under Review
This plugin is awaiting approval for **Obsidian Community Plugins**. For now, use **BRAT** (recommended) or manual installation.
:::

## Install the Plugin

### Via BRAT (Recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the Community Plugins browser
2. In Obsidian settings, go to **Community Plugins → BRAT → Add Beta Plugin**
3. Paste this repo URL:
   ```
   https://github.com/RAIT-09/obsidian-agent-client
   ```
4. BRAT will download the latest release and keep it auto-updated
5. Enable **Agent Client** from the plugin list

### Manual Installation

1. Download the latest release files from [GitHub Releases](https://github.com/RAIT-09/obsidian-agent-client/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create the plugin folder: `VaultFolder/.obsidian/plugins/agent-client/`
3. Place the downloaded files in this folder
4. Enable the plugin in **Obsidian Settings → Community Plugins**

## Prerequisites

### Node.js

::: tip Not always required
Node.js is needed for npm-based agents like Claude Code, Codex, and Gemini CLI. If your agent is a standalone binary, you can skip this step.
:::

If you need Node.js:

1. Download from [nodejs.org](https://nodejs.org/)
2. Install the LTS version (recommended)

### Find Your Node.js Path

Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run:

::: code-group

```bash [macOS/Linux]
which node
# Example output: /usr/local/bin/node
```

```cmd [Windows]
where.exe node
# Example output: C:\Program Files\nodejs\node.exe
```

:::

### Configure Node.js Path

1. Open **Settings → Agent Client**
2. Enter the Node.js path in the **Node.js path** field

## Next Steps

Continue to [Quick Start](./quick-start) to set up your first agent and start chatting!
