<h1>
	<img src="assets/icons/obsius-o.svg" alt="O" width="28" height="28" style="vertical-align: -4px;" />
	bsius — AI Agents in Obsidian
</h1>

Bring AI agents into your Obsidian vault with fine-grained context controls.



## Requirements

- Obsidian `1.11.5` or later
- Desktop only (not supported on mobile)

## Secure API Keys

Built-in agent API keys (Claude, Codex, Gemini) are stored in Obsidian secure storage, not in this plugin's settings JSON.

### How to use

1. Open `Settings` -> `Community plugins` -> `Obsius`.
2. Go to each built-in agent section (`Claude Code`, `Codex`, `Gemini CLI`).
3. Paste your API key into the `API key` field.
4. Start a chat with that agent as usual.

### Notes

- Keys are stored via Obsidian's secure storage on desktop.
- Keys are device-local and are not synced through your vault files.
- If you use multiple devices, enter the key once on each device.

### Recommendation

For desktop users, we recommend [cc-switch](https://github.com/farion1231/cc-switch), a GUI tool that makes it easier to customize and switch agent configurations.

## Acknowledgments

- [obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client) — Brilliant work that this project is forked from
- [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol) — Built on by Zed
- [Claudian](https://github.com/YishenTu/claudian) — Design inspiration
- [cursor.com](https://cursor.com) — Design inspiration
- [@lobehub/icons](https://github.com/lobehub/lobe-icons) — AI brand icons

## License

Apache License 2.0. This project is modified from [obsidian-agent-client](https://github.com/RAIT-09/obsidian-agent-client). See [LICENSE](LICENSE) for details.
