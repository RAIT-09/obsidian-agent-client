# Installation

## Install the Plugin

### From Community Plugins (Recommended)

1. In Obsidian, open **Settings → Community Plugins → Browse**
2. Search for **"Agent Client"**
3. Click **Install**, then **Enable**

<p align="center">
  <a href="obsidian://show-plugin?id=agent-client" style="display:inline-block;padding:10px 24px;background:#7c3aed;color:white;border-radius:8px;text-decoration:none;font-weight:600;">Add to Obsidian</a>
</p>

### Via BRAT (Pre-release Versions)

To try pre-release versions before they are published to Community Plugins:

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

If auto-detect doesn't find Node.js, you can locate it manually. Open a terminal (Terminal on macOS/Linux, PowerShell on Windows) and run:

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

In most cases, the plugin automatically finds Node.js through your login shell's PATH, so no configuration is needed. If Node.js is not detected automatically:

1. Open **Settings → Agent Client**
2. Click the **Auto-detect** button next to the **Node.js path** field, or enter the path manually

## Next Steps

Continue to [Quick Start](./quick-start) to set up your first agent and start chatting!
