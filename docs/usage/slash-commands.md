# Slash Commands

Use slash commands to trigger actions provided by your current agent.

## Agent Support

Slash commands are agent-specific. Not all agents support slash commands.

::: tip
If the input field placeholder shows `/ for commands`, the current agent supports slash commands. If not, the agent does not support this feature.
:::

## Using Slash Commands

1. Type `/` in the input field
2. A dropdown appears showing available commands
3. Select a command or continue typing to filter
4. Press `Enter` to execute the command

<p align="center">
  <img src="/images/slash-commands-1.webp" alt="Slash commands dropdown" width="400" />
</p>

<p align="center">
  <img src="/images/slash-commands-2.webp" alt="Filtering slash commands" width="400" />
</p>

## Available Commands

Available commands are determined entirely by the agent—not by this plugin. Each agent provides its own set of commands.

For example, Claude Code offers commands like `/compact`, `/init`, and `/review`, while other agents may have completely different commands or none at all.

Refer to your agent's documentation for a full list of supported commands.

## Command Arguments

Some commands accept arguments:

```
/command keyword
```

Type the command followed by a space and your arguments.
