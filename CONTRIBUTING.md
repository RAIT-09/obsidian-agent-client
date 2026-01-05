# Contributing to Agent Client Plugin

Thank you for your interest in contributing to the Agent Client plugin!

## Before You Start

### Please Open an Issue First

**For significant changes, please open an issue before writing code:**

- New features
- Architecture changes
- Adding or modifying external dependencies
- Implementing draft/experimental ACP specifications

This helps ensure alignment with the project direction and saves time for both contributors and maintainers.

**You can submit a PR directly for:**

- Obvious bug fixes (typos, crashes, etc.)
- Fixes for existing issues
- Documentation improvements

### Project Scope

This plugin focuses on **ACP client implementation** + **features that make ACP convenient to use in Obsidian**.

**In scope:**

- ACP protocol implementation
- Note mentions (`@[[note]]` to pass note content to agents)
- Obsidian-specific UI integration

**Out of scope:**

- Features achievable via standard protocols like MCP (these should be provided as MCP servers for a consistent experience across all agents)
- Agent-specific features (these should be handled via agent-specific config files, e.g., `.claude/` directory)

## Development Setup

### Prerequisites

- Node.js 18.x or later
- npm

### Setup Steps

```bash
# Navigate to your vault's plugins directory
cd /path/to/your/vault/.obsidian/plugins

# Clone the repository as "agent-client"
# The directory name must match the id in manifest.json
git clone https://github.com/RAIT-09/obsidian-agent-client.git agent-client
cd agent-client

# Install dependencies
npm install

# Start development build (watch mode)
npm run dev
```

### Testing in Obsidian

1. After cloning to `.obsidian/plugins/agent-client`, run `npm run dev`
2. Enable the plugin in Obsidian Settings → Community Plugins
3. Code changes trigger automatic rebuilds, but you need to reload the plugin (toggle it off/on in Community Plugins) to see changes

## Available Commands

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Development build (watch mode)                   |
| `npm run build`     | Production build (includes TypeScript type check)|
| `npm run lint`      | Run ESLint                                       |
| `npm run lint:fix`  | Run ESLint with auto-fix                         |
| `npm run format`    | Format code with Prettier                        |
| `npm run format:check` | Check formatting (used in CI)                 |

## Code Style

### Prettier Configuration

| Setting        | Value         |
| -------------- | ------------- |
| Indentation    | Tabs (width 4)|
| Semicolons     | Yes           |
| Quotes         | Double        |
| Trailing comma | All           |
| Print width    | 80            |
| End of line    | LF            |

### ESLint

We use `eslint-plugin-obsidianmd` for Obsidian-specific rules and `typescript-eslint` for TypeScript.

### Obsidian Plugin Guidelines

1. **No innerHTML/outerHTML** — Use `createEl`, `createDiv`, `createSpan`
2. **Don't detach leaves in onunload** — This is an anti-pattern
3. **Styles in CSS only** — No JS style manipulation
4. **Use Platform API** — Don't use `process.platform`
5. **Minimize `any`** — Use proper types

### File Naming Conventions

- **Ports**: `*.port.ts`
- **Adapters**: `*.adapter.ts`
- **Hooks**: `use*.ts`
- **Components**: `PascalCase.tsx`
- **Utils/Models**: `kebab-case.ts`

## Branch Naming

```
{username}/{type}/{description}
```

**Types:**

- `feature/` — New feature
- `fix/` — Bug fix
- `refactor/` — Refactoring
- `docs/` — Documentation
- `hotfix/` — Urgent fix

**Examples:**

- `yourname/feature/add-export`
- `yourname/fix/message-rendering`

## Commit Messages

We recommend [Conventional Commits](https://www.conventionalcommits.org/) style:

```
<type>: <description>

<optional body>
```

**Types:**

- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Refactoring
- `docs:` — Documentation
- `chore:` — Build/dependencies
- `style:` — Formatting (no functional changes)

## Pull Request Process

### Workflow

1. Create a branch from `master`
   - `master` is the stable branch, `dev` is for development
   - Feature PRs typically target `dev`, hotfixes target `master`
2. Make your changes and commit
3. Create a pull request
4. Ensure CI passes (lint, build)
5. Wait for review

### PR Checklist

Before submitting, please verify:

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Tested in Obsidian
- [ ] Existing functionality still works
- [ ] Documentation updated if needed

### CI

Pull requests automatically run:

- ESLint (`npx eslint src/`)
- Build (`npm run build`)

Please ensure these pass locally before submitting.

**Note:** "Use sentence case for UI text" lint errors are acceptable for brand names and proper nouns (e.g., "Claude Code", "Gemini CLI").

## Architecture Overview

```
src/
├── domain/         # Pure domain models + ports (interfaces)
│   ├── models/     # agent-config, chat-message, session-update, etc.
│   └── ports/      # IAgentClient, ISettingsAccess, IVaultAccess
├── adapters/       # Interface implementations
│   ├── acp/        # ACP protocol implementation
│   └── obsidian/   # Obsidian-specific implementations
├── hooks/          # React custom hooks (state + logic)
├── components/     # UI components
└── shared/         # Utility functions
```

### Architecture Principles

1. **Hooks for state and logic** — No ViewModel or Use Case classes
2. **Pure functions in shared/** — Non-React business logic
3. **Ports absorb protocol changes** — IAgentClient interface provides isolation
4. **Domain has zero dependencies** — No `obsidian` or `@agentclientprotocol/sdk` imports

For more details, see `CLAUDE.md`.

## ACP Notes

- Prioritize implementations that conform to the official (stable) ACP specification
- If implementing draft/experimental specs, please discuss in an issue first
- Implementations should work with official ACP-compatible agents (e.g., `@zed-industries/claude-code-acp`)

## Questions?

Open an issue if you have any questions!
