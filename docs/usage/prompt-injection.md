# Prompt Injection

Guide agents to produce **Obsidian-flavored Markdown** by giving them short formatting instructions for each session.

## Why?

AI agents are trained on standard Markdown, but Obsidian uses extended syntax for some elements. Without guidance, agents may produce output that misses out on Obsidian features:

- Notes referenced as `[Note](note.md)` instead of `[[Note Name]]` wikilinks, which are how Obsidian links notes by name and builds the backlink graph
- Math formulas wrapped in `\(...\)` or `\[...\]` instead of `$...$` or `$$...$$`, which Obsidian does not render as math
- Markdown tables placed without a leading blank line, causing them to render as plain text

Prompt injection adds short, focused instructions so the agent produces output that looks right in Obsidian from the start.

## How it works

The plugin gives the agent one or more short instruction sentences, which it applies across the session. How they reach the agent depends on the agent:

- **As part of the system prompt**, for agents that take one from the client (ACP's `systemPrompt`; recent versions of Claude Code and Codex do). When the plugin starts a session, it asks the agent to append the instructions to its own system prompt. It saves them with the session and sends the same ones again when it restores or forks the session. They stay in effect for the whole session, also after the agent compacts the conversation, and they are not part of your messages.
- **With your first message**, for other agents. The plugin adds the instructions to the first message of the session, in an `<obsidian_system_instruction>` block. A slash command doesn't carry them, since the agent reads the command from the start of the message; they go with your first message that isn't one. They are then part of the conversation, which the agent may summarize away when it compacts it.

::: info
Changes to these settings apply to the sessions you start afterwards; a session keeps the instructions it started with. A chat starts its session as soon as it opens, though, and with an agent that takes a system prompt, that is when the session gets the instructions. If you change the settings while such a chat is still empty, instructions you turn on go with your first message instead, and ones you turn off stay in that session until you restart the agent.
:::

## Settings

Configure in **Settings → Agent Client → Prompt injection**:

<p align="center">
  <img src="/images/prompt-injection-settings.webp" alt="Prompt injection settings" width="600" />
</p>

| Setting | Default | Description |
|---------|---------|-------------|
| **Inject Obsidian Markdown instructions** | On | Master toggle — turn off to disable all injection |
| **Wikilink formatting** | On | Instruct agents to use `[[Note Name]]` syntax when referencing notes |
| **Markdown table spacing** | On | Instruct agents to leave a blank line before Markdown tables |
| **LaTeX math formatting** | On | Instruct agents to use `$...$` and `$$...$$` delimiters for math |

When the master toggle is off, no instructions are injected regardless of the sub-toggle states. When the master toggle is on, only the enabled sub-toggles are injected.

::: warning Not the same as "Expand wikilink context"
**Wikilink formatting** here asks the agent to *write* `[[Note Name]]` links in its replies. The separate **Mentions → Expand wikilink context** setting *resolves* `[[links]]` already inside your notes into file paths. Different direction, different setting—see [Note Mentions](/usage/mentions#expand-wikilink-context).
:::

## Instruction Text

For reference, the exact strings injected when each toggle is on:

- **Wikilink**: *"When referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links."*
- **Tables**: *"Always leave a blank line before Markdown tables; without it Obsidian renders them as plain text."*
- **LaTeX math**: *"This client uses Obsidian Flavored Markdown. For math, use $...$ for inline and $$...$$ for display (not \\(...\\) or \\[...\\])."*

## When to Disable

You may want to turn off some or all toggles if:

- You are writing prose that doesn't reference notes, math, or tables
- The agent already follows Obsidian conventions reliably for your use case
- You want to keep the agent's context as small as possible for performance or cost reasons

::: tip
If an agent ignores some instructions despite the toggle being on, that is an agent limitation rather than a plugin bug. Try a different model or agent, or rephrase the instruction in your own message.
:::

## See Also

- [Context Files](/usage/context-files) — agent-side guidance via `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`
- [Note Mentions](/usage/mentions) — sharing note content with the agent
