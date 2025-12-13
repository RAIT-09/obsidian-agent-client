# FAQ

Frequently asked questions about Agent Client.

## General

### What is Agent Client?

Agent Client is an Obsidian plugin that lets you chat with AI agents directly within Obsidian. It supports Claude Code, Codex, Gemini CLI, and any ACP-compatible agent. The plugin uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) to communicate with agents.

### Is this an official Anthropic/OpenAI/Google plugin?

No. Agent Client is a community-developed plugin. It uses official agent packages but is not affiliated with any AI provider.

### Does this work on mobile?

No. Agent Client is desktop-only. Agents run as local processes, which is not supported on mobile devices.

### Is my data sent to AI providers?

Yes. When you send a message, it's processed by the AI provider behind your selected agent (Anthropic, OpenAI, Google, etc.). Review each provider's privacy policy for details.

## Note Mentions

### How do I reference my notes in a conversation?

Type `@` in the input field and a dropdown appears with matching notes. Select a note to insert a mention in `@[[Note Name]]` format. The note's content (up to 10,000 characters) is sent to the agent.

See [Note Mentions](/usage/mentions) for details.

### What is auto-mention?

When enabled (**Settings → Agent Client → Auto-mention active note**), the currently open note is automatically included as context. Unlike manual mentions, auto-mention only sends the note's file path—not its content. The agent can use its Read tool to access the content if needed.

### Can I include just part of a note?

Yes. If you select text in your note, only that selection is sent as context. The auto-mention badge shows the line range (e.g., `@My Note:5-10`).

### How do I temporarily disable auto-mention?

Click the **×** button next to the auto-mention badge above the input field. Click **+** to re-enable it. This only affects the current message.

## Agents

### How do I switch between agents?

Open plugin settings via the gear icon in the chat header, then select a different agent from the **Active agent** dropdown. If no conversation has started, the agent switches immediately. Otherwise, click **New Chat** to apply the change.

You can also use the command palette (`Cmd/Ctrl + P`) and search for **"New chat with [Agent Name]"**.

### Can I use multiple agents?

Yes. Configure multiple agents in settings and switch between them as needed. Each agent has its own configuration (API key, arguments, etc.).

### What is a custom agent?

Any ACP-compatible agent beyond the built-in ones (Claude Code, Codex, Gemini CLI). You can add custom agents in **Settings → Agent Client → Custom agents**. See [Custom Agents](/agent-setup/custom-agents).

### Do all agents support the same features?

No. Features like slash commands, modes, and models depend on the agent. The plugin adapts its UI based on what the agent supports. For example, the mode dropdown only appears if the agent provides multiple modes.

## Slash Commands

### Why don't I see slash commands?

Slash commands are provided by the agent, not the plugin. If the input placeholder doesn't show `/ for commands`, your current agent doesn't support slash commands.

### Why are the commands different from what I expected?

Each agent provides its own commands. Claude Code, Codex, and Gemini CLI all have different command sets. Refer to your agent's documentation for available commands.

## Permissions

### Why does the agent ask for permission?

Some agents request permission before performing certain actions (like editing files or running commands). This is a safety feature controlled by the agent.

### Can I auto-approve all permissions?

Yes. Enable **Settings → Agent Client → Auto-allow permissions**. Use with caution—this gives agents full access without confirmation prompts.

### Some agents don't ask for permission at all?

Correct. Permission behavior is agent-specific. Some agents may edit files directly without requesting permission.

## Exporting

### How do I export a conversation?

Click the **export button** in the chat header. The conversation is saved as a Markdown file in your vault.

### Where are exports saved?

By default, exports are saved to the `Agent Client` folder in your vault. You can change this in **Settings → Agent Client → Export → Export folder**.

### Can I auto-export conversations?

Yes. Enable **Auto-export on new chat** or **Auto-export on close chat** in export settings.

## Windows

### What is WSL mode?

WSL (Windows Subsystem for Linux) mode runs agents inside a Linux environment on Windows. Enable it in **Settings → Agent Client → Windows Subsystem for Linux → Enable WSL mode**. This is useful for agents that work better in Linux environments.

### Do I need to specify a WSL distribution?

Only if you have multiple WSL distributions installed and want to use a specific one. Leave it empty to use your default distribution.

## Cost & Billing

### Is Agent Client free?

The plugin itself is free and open source. However, using AI agents may incur costs depending on the agent and your authentication method.

### API key vs account login—what's the difference?

- **API key**: Billed per usage by the AI provider. You pay for what you use.
- **Account login**: Uses your subscription's included usage. May have limits depending on your plan.

## Getting Help

### Where can I get help?

1. Check the [Troubleshooting](/help/troubleshooting) page
2. Search [GitHub Issues](https://github.com/RAIT-09/obsidian-agent-client/issues)
3. Open a new issue if your problem isn't covered

### How do I report a bug?

[Open an issue on GitHub](https://github.com/RAIT-09/obsidian-agent-client/issues/new) with:
- Your OS and Obsidian version
- The agent you're using
- Steps to reproduce
- Error messages (enable **Debug Mode** in **Settings → Agent Client → Developer**)
