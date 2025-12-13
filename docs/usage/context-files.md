# Context Files

Provide additional context to your AI agent using context files.

## What are Context Files?

Context files are special Markdown files that contain instructions, preferences, or information that the agent should know about. These files are automatically read by the agent at the start of a session.

::: tip
Context files are an agent feature, not a plugin feature. Refer to your agent's documentation for details.
:::

## Supported Context Files

Each agent uses its own context file:

| Agent | Context File |
|-------|--------------|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Place the context file in your **vault root** to have the agent read it automatically.

## Example

```markdown
# Vault Context

## Overview
This vault contains my personal notes and research.

## Preferences
- Write in a concise, clear style
- Use bullet points for lists
- Prefer Markdown formatting

## Important Notes
- `Templates/` - Note templates
- `Daily/` - Daily notes

## Conventions
- Use YYYY-MM-DD format for dates
- Tag notes with relevant topics
```

## Best Practices

1. **Keep it focused**: Include only relevant information
2. **Update regularly**: Keep context current with your vault
3. **Be specific**: Provide concrete examples and preferences

## What to Avoid

- Sensitive information (API keys, passwords)
- Very long files (agents have context limits)
- Outdated information
