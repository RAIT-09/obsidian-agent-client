# Shared Utilities Guide

Pure, stateless utility modules used across layers.

## Purity Rules (CRITICAL)

`shared/` is only for pure/stateless helpers.

A module belongs here only if it:
1. Is deterministic for the same input.
2. Has no lifecycle/state orchestration.
3. Does not perform file I/O, process spawning, or network calls.
4. Does not import from `adapters/`, `hooks/`, or `components/`.

Side-effectful code must live in `application/` or `adapters/`.

## Completed Migrations

The following modules were moved out of `shared/` during cleanup:
- Prompt orchestration -> `src/application/use-cases/prompt/`
- Session restore (`SnapshotManager`, file discovery) -> `src/application/services/session-restore/`
- Chat view registry -> `src/application/services/chat-view-registry.ts`
- Terminal manager -> `src/adapters/acp/terminal-manager.ts`
- Secret storage wrapper -> `src/adapters/obsidian/secret-storage.adapter.ts`

Do not reintroduce these concerns in `shared/`.

## Current Utility Catalog

- `acp-error-utils.ts`: ACP error normalization/helpers.
- `agent-display-name.ts`: Resolve display labels for configured agents.
- `chat-context-token.ts`: Encode/decode/extract context reference tokens.
- `command-classification.ts`: Categorize slash commands.
- `completion-sound.ts`: Play completion chime.
- `display-settings.ts`: Parse/sanitize display settings.
- `logger.ts`: Debug-mode aware logger singleton.
- `mention-utils.ts`: Mention parsing and note resolution helpers.
- `mentionable-files.ts`: Mentionable extension + image mime utilities.
- `path-utils.ts`: Path helpers and file URI builder.
- `plugin-notice.ts`: Plugin-prefixed Obsidian notice helper.
- `session-capability-utils.ts`: Capability flag extraction.
- `settings-migrations.ts`: Settings schema migrations.
- `settings-schema.ts`: Runtime schema validation.
- `settings-utils.ts`: Settings normalization/conversion helpers.
- `shell-utils.ts`: Shell/environment command resolution helpers.
- `slash-command-token.ts`: Slash command token encoding.
- `tool-icons.ts`: Tool icon/title mapping.
- `tool-summary.ts`: Tool summary extraction utilities.
- `vault-path.ts`: Vault base path helper.
- `windows-env.ts`: Windows PATH enhancement helpers.
- `wsl-utils.ts`: Windows -> WSL path/command helpers.

## Notes

- `mention-utils.ts`, `shell-utils.ts`, `windows-env.ts`, `vault-path.ts`, and `plugin-notice.ts` intentionally depend on platform/Obsidian APIs but remain utility-level and stateless.
- Keep this directory free of business workflow orchestration.

## Anti-Patterns

- Adding adapter construction or lifecycle code.
- Adding mutable manager classes with long-lived state.
- Moving application use-cases into utility helpers.
- Importing from higher layers (`hooks/`, `components/`).
