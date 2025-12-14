# Troubleshooting

This guide covers common issues and solutions for Agent Client.

## Connection Issues

### "Connecting to [Agent]..." doesn't complete

The plugin is trying to start the agent process but isn't receiving a response.

**Common causes:**
- Incorrect agent path
- Missing Node.js
- Agent not installed

**Solutions:**

1. **Verify the agent path** in **Settings → Agent Client → [Agent Name] → Path**
   - On macOS/Linux, find the path with: `which claude-code-acp`
   - On Windows, find the path with: `where claude-code-acp`

2. **Verify Node.js path** in **Settings → Agent Client → Node.js path**
   - Many agents require Node.js
   - Find it with: `which node` (macOS/Linux) or `where node` (Windows)

3. **Reload the plugin** after changing path settings (disable then re-enable in Settings → Community plugins)

### "Command Not Found" error

The agent executable cannot be found at the specified path.

**Solutions:**

1. Use the full absolute path (e.g., `/usr/local/bin/claude-code-acp` instead of just `claude-code-acp`)
2. Verify the agent is installed by running it directly in Terminal
3. On Windows, include the `.cmd` extension if needed

## Authentication Issues

### "Authentication Required" error

The agent requires authentication before processing requests.

**For Claude Code:**
- **API key**: Set in **Settings → Agent Client → Claude Code (ACP) → API key**
- **Account login**: Run `claude` in Terminal first and complete the login flow

**For Codex:**
- Set your OpenAI API key in **Settings → Agent Client → Codex → API key**

**For Gemini CLI:**
- Set your Google API key in **Settings → Agent Client → Gemini CLI → API key**
- Or run `gemini` in Terminal first to authenticate with your Google account

### "No Authentication Methods" error

The agent didn't provide authentication options.

**Solution:** Check your agent configuration. The agent may not be properly initialized—try reloading the plugin.

## Rate Limiting

### "Rate Limit Exceeded" error

You've sent too many requests.

**Solutions:**

1. Wait before sending another message
2. Check your usage limits at the provider's console:
   - Anthropic: [console.anthropic.com](https://console.anthropic.com/)
   - OpenAI: [platform.openai.com](https://platform.openai.com/)
   - Google: [console.cloud.google.com](https://console.cloud.google.com/)

## Session Issues

### "Session Creation Failed" error

The agent connected but couldn't create a session.

**Solutions:**

1. Click **New Chat** (+ button in header) to create a fresh session
2. Check if your vault path contains special characters that might cause issues
3. Reload the plugin

### "Agent Not Found" error

The selected agent ID doesn't exist in settings.

**Solution:** Go to **Settings → Agent Client** and select a valid agent from the **Active agent** dropdown.

## Message Sending Issues

### "Cannot Send Message" error

No active session available.

**Solutions:**

1. Wait for the connection to complete (status shows agent name, not "Connecting...")
2. Click **New Chat** to create a fresh session

### "Send Message Failed" error

The message was sent but the agent returned an error.

**Solutions:**

1. Check the error message for details
2. Verify your API key or login status
3. Try a simpler message to test the connection

## Export Issues

### "Failed to export chat" notification

The conversation couldn't be saved.

**Solutions:**

1. Check that the export folder exists (**Settings → Agent Client → Export → Export folder**)
2. Verify the folder name is valid (no special characters that aren't allowed in folder names)
3. Check the filename template for invalid characters (**Settings → Agent Client → Export → Filename**)

## Windows-Specific Issues

### WSL mode not working

**Prerequisites:**
- WSL must be installed: Run `wsl --status` in Command Prompt
- A Linux distribution must be installed: Run `wsl --list`

**Settings:**
- Enable **Settings → Agent Client → Windows Subsystem for Linux → Enable WSL mode**
- Optionally specify your distribution in **WSL distribution**

### Agent works in Terminal but not in Obsidian

The PATH environment may differ between Terminal and Obsidian.

**Solutions:**

1. Use full absolute paths for both agent and Node.js
2. Enable WSL mode for better compatibility
3. Add the agent's directory to your system PATH (not just user PATH)

## macOS-Specific Issues

### Agent installed via Homebrew not found

Homebrew binaries may not be in Obsidian's PATH.

**Solution:** Use the full path. Find it with `which <agent-name>` in Terminal.

## Linux-Specific Issues

### Agent not found when using Flatpak version of Obsidian

The Flatpak version of Obsidian runs in a sandbox that cannot access paths like `/usr/local/bin`.

**Solution:** Use the AppImage or .deb version of Obsidian instead of Flatpak.

### Agent works in Terminal but not in Obsidian

Desktop applications on Linux may not inherit PATH settings from `.bashrc`.

**Solutions:**

1. Use the full absolute path (e.g., `/usr/local/bin/gemini` instead of `gemini`)
2. Ensure the agent is installed in a standard location (`/usr/bin` or `/usr/local/bin`)

## Debug Mode

If you need more detailed information about an issue, enable Debug mode:

1. Go to **Settings → Agent Client → Developer → Debug mode**
2. Enable the toggle
3. Open DevTools:
   - macOS: `Cmd + Option + I`
   - Windows/Linux: `Ctrl + Shift + I`
4. Go to the **Console** tab
5. Filter by these prefixes:
   - `[AcpAdapter]` - Agent communication
   - `[useChat]` - Message handling
   - `[useAgentSession]` - Session management

## Common Error Messages

| Error | Meaning | Quick Fix |
|-------|---------|-----------|
| Command Not Found | Agent executable not at specified path | Check Path setting |
| Authentication Required | API key missing or login needed | Add API key or run agent in Terminal first |
| No Authentication Methods | Agent configuration issue | Reload the plugin |
| Rate Limit Exceeded | Too many API requests | Wait and retry |
| Session Creation Failed | Agent couldn't start session | Click New Chat |
| Agent Not Found | Invalid agent ID in settings | Select valid agent |
| Cannot Send Message | No active session | Wait for connection or click New Chat |
| Send Message Failed | Agent returned an error | Check error details |

## Getting Help

If you're still experiencing issues:

1. Enable **Debug mode** and check console logs
2. Search [GitHub Issues](https://github.com/RAIT-09/obsidian-agent-client/issues)
3. Open a new issue with:
   - Your OS and Obsidian version
   - The agent you're using
   - Steps to reproduce
   - Error messages from Debug mode
