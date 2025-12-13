# Troubleshooting

This guide covers common issues and their solutions based on actual error patterns in Agent Client.

## Connection Issues

### "Connecting to [Agent]..." stuck or spinning indefinitely

The plugin is trying to start the agent process but not receiving a response.

**Check the agent path:**
- Verify the path in **Settings → Agent Client → [Agent] → Agent path**
- Test by running the command directly in Terminal:
  - macOS/Linux: `which claude` or `which gemini`
  - Windows: `where.exe claude` or `where.exe gemini`

**Check Node.js path:**
- Many agents require Node.js. Verify the path in **Settings → Agent Client → General → Node.js path**
- Test: `which node` (macOS/Linux) or `where.exe node` (Windows)

**Restart Obsidian:**
- After changing any path settings, restart Obsidian completely

### "Command Not Found" error

The agent executable cannot be found at the specified path.

**Solutions:**
1. Use the full absolute path to the agent (e.g., `/usr/local/bin/claude` instead of just `claude`)
2. On Windows, include the `.cmd` extension if applicable (e.g., `claude.cmd`)
3. Verify the agent is installed by running it directly in Terminal

**Platform-specific tips:**
- macOS/Linux: Use `which <command>` to find the correct path
- Windows: Use `where.exe <command>` to find the correct path

### "Agent process stdin/stdout not available"

The agent process started but communication failed.

**Solutions:**
1. Check that the agent package is properly installed
2. Reinstall the agent package:
   - Claude Code: `npm install -g @anthropics/claude-code`
   - Gemini CLI: `npm install -g @anthropics/gemini-cli`
3. Verify Node.js is working: `node --version`

## Authentication Issues

### "Authentication Required" or "Authentication failed"

The agent requires authentication before it can process requests.

**For Claude Code:**
- **API key method**: Set your API key in **Settings → Agent Client → Claude Code → API Key**, or set the `ANTHROPIC_API_KEY` environment variable
- **Account login**: Run `claude` in Terminal first and complete the login flow

**For Codex:**
- Set your OpenAI API key in **Settings → Agent Client → Codex → API Key**, or set the `OPENAI_API_KEY` environment variable

**For Gemini CLI:**
- Run `gemini` in Terminal first to authenticate with your Google account
- Or set the `GOOGLE_API_KEY` environment variable

### "No Authentication Methods"

The agent didn't provide any authentication options.

**Solution:** Check your agent configuration in settings. The agent may not be properly initialized.

## Rate Limiting

### "Rate Limit Exceeded"

You've sent too many requests in a short period.

**Solutions:**
1. Wait a few moments before sending another message
2. If using an API key, check your usage limits at the provider's console:
   - Anthropic: [console.anthropic.com](https://console.anthropic.com/)
   - OpenAI: [platform.openai.com](https://platform.openai.com/)
   - Google: [console.cloud.google.com](https://console.cloud.google.com/)

## Session Issues

### "Session Creation Failed"

The agent connected but couldn't create a new chat session.

**Possible causes:**
1. Agent process crashed after startup
2. Working directory issues (your vault path may have special characters)
3. Agent-specific initialization problems

**Solutions:**
1. Try clicking **New Chat** to create a fresh session
2. Check if your vault path contains special characters that might cause issues
3. Enable Debug Mode to see detailed error information

### "Connection not initialized"

The plugin tried to perform an action before the agent was ready.

**Solution:** Wait for the connection to complete, or click **New Chat** to restart.

## Message Sending Issues

### "Cannot Send Message"

A message couldn't be sent to the agent.

**Common causes:**
1. No active session (connection was lost)
2. Agent process crashed
3. Previous request still processing

**Solutions:**
1. Click **New Chat** to create a fresh session
2. If the agent seems unresponsive, click the stop button (⏹) then try again

### "Send Message Failed"

The message was sent but the agent returned an error.

**Solutions:**
1. Check the error message for specific details
2. If authentication-related, verify your API key or login status
3. Try sending a simpler message to test the connection

## Export Issues

### "Failed to export chat"

The conversation couldn't be saved to a file.

**Possible causes:**
1. Export folder doesn't exist
2. File permissions issue
3. Invalid filename template

**Solutions:**
1. Check that the export folder exists in your vault (**Settings → Agent Client → Export → Export folder**)
2. Verify the folder is writable
3. Check the filename template for invalid characters

## Windows-Specific Issues

### WSL mode not working

**Prerequisites:**
1. WSL must be installed: Run `wsl --status` in Command Prompt
2. A Linux distribution must be installed: Run `wsl --list`

**Settings:**
- Enable **Settings → Agent Client → Windows Subsystem for Linux → Enable WSL mode**
- If you have multiple distributions, specify which one to use in **WSL Distribution**

### "Failed to convert Windows path to WSL format"

The vault path couldn't be converted to WSL format.

**Solutions:**
1. Ensure your vault is on a drive accessible from WSL (e.g., `C:\` maps to `/mnt/c/`)
2. Avoid special characters in your vault path
3. Try specifying the correct WSL distribution name

### Agent works in Terminal but not in Obsidian

On Windows, the PATH environment may differ between Terminal and Obsidian.

**Solutions:**
1. Use full absolute paths for both the agent and Node.js
2. Try WSL mode for better compatibility
3. Add the agent's directory to your system PATH (not just user PATH)

## macOS-Specific Issues

### "Permission denied" when starting agent

The agent executable doesn't have execute permissions.

**Solution:**
```bash
chmod +x /path/to/agent
```

### Agent installed via Homebrew not found

Homebrew binaries may not be in Obsidian's PATH.

**Solution:** Use the full path. Find it with:
```bash
which claude  # or your agent name
```

## Debug Mode

When troubleshooting, enable Debug Mode to see detailed logs:

1. Open **Settings → Agent Client → Developer → Debug Mode**
2. Enable the toggle
3. Open DevTools:
   - macOS: `Cmd + Option + I`
   - Windows/Linux: `Ctrl + Shift + I`
4. Go to the **Console** tab
5. Look for logs prefixed with:
   - `[AcpAdapter]` - Agent communication
   - `[useChat]` - Message handling
   - `[useAgentSession]` - Session management
   - `[TerminalManager]` - Command execution

## Common Error Messages Reference

| Error | Meaning | Quick Fix |
|-------|---------|-----------|
| `ENOENT` | Command/file not found | Check agent path |
| `exit code 127` | Command not found (Linux/macOS) | Verify installation |
| `empty response text` | Agent returned empty response | Usually safe to ignore |
| `user aborted` | Operation was cancelled | Normal when clicking stop |

## Getting Help

If you're still experiencing issues:

1. **Enable Debug Mode** and capture the error logs
2. **Search existing issues**: [GitHub Issues](https://github.com/RAIT-09/obsidian-agent-client/issues)
3. **Open a new issue** with:
   - Your OS and Obsidian version
   - The agent you're using and how it's configured
   - Steps to reproduce the problem
   - Error messages from Debug Mode console
