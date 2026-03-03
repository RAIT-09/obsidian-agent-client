# Domain Layer Guide

Pure types and interfaces — **ZERO external dependencies**. No `obsidian`, no `@agentclientprotocol/sdk`, no React.

## Structure

```
domain/
├── models/          # Data types (8 files, ~1056 lines)
│   ├── chat-message.ts      # ChatMessage, MessageContent union, Role, ToolCallStatus, ToolKind (~203 lines)
│   ├── session-update.ts    # SessionUpdate union (8 routed types) — agent → UI event stream (~181 lines)
│   ├── chat-session.ts      # ChatSession state, SessionState, SlashCommand, AuthenticationMethod, modes, models (~266 lines)
│   ├── agent-error.ts       # AcpErrorCode constants, ErrorInfo, AcpError, ProcessError, ProcessErrorType (~122 lines)
│   ├── agent-config.ts      # BaseAgentSettings, ClaudeAgentSettings, GeminiAgentSettings, CodexAgentSettings, OpenCodeAgentSettings, CustomAgentSettings (~100 lines)
│   ├── session-info.ts      # SessionInfo, ListSessionsResult, LoadSessionResult, ResumeSessionResult, ForkSessionResult, SavedSessionInfo (~92 lines)
│   ├── prompt-content.ts    # PromptContent union (text, image, resource), ResourceAnnotations (~72 lines)
│   └── chat-input-state.ts  # ChatInputState, AttachedImage (for broadcast) (~20 lines)
└── ports/           # Interface contracts (4 files, ~771 lines)
    ├── agent-client.port.ts    # IAgentClient — 423 lines, full agent communication contract
    ├── settings-access.port.ts # ISettingsAccess — settings CRUD + session persistence (~131 lines)
    ├── chat-view-container.port.ts # IChatViewContainer + ChatViewContextReference — view registration, focus, broadcast, context (~123 lines)
    └── vault-access.port.ts    # IVaultAccess — note search, read, binary read, active file tracking (~110 lines)
```

## Critical Types

**SessionUpdate** (`session-update.ts`): Discriminated union — the backbone of agent -> UI communication:
`agent_message_chunk` | `agent_thought_chunk` | `user_message_chunk` | `tool_call` | `tool_call_update` | `plan` | `available_commands_update` | `current_mode_update`

**MessageContent** (`chat-message.ts`): Union of content types within a `ChatMessage`:
`text` | `text_with_context` | `image` | `tool_call` | `agent_thought` | `plan` | `permission_request` | `terminal`

**ChatSession** (`chat-session.ts`): Full session state including `SessionState`, available modes/models (`SessionModeState`, `SessionModelState`), agent capabilities, slash commands.

**ChatViewContextReference** (`chat-view-container.port.ts`): Context reference types (`selection` | `file` | `folder`) for editor context menu integration.

## Ports -> Implementations

| Port | Adapter |
|------|---------|
| `IAgentClient` | `adapters/acp/acp.adapter.ts` -> `AcpAdapter` |
| `IVaultAccess` | `adapters/obsidian/vault.adapter.ts` -> `ObsidianVaultAdapter` |
| `ISettingsAccess` | `adapters/obsidian/settings-store.adapter.ts` -> `SettingsStore` |
| `IChatViewContainer` | `components/chat/ChatView.tsx` |

## Zero-Dep Rule Enforcement

**NEVER add these imports in `domain/`:**
- `import { ... } from "obsidian"`
- `import * as acp from "@agentclientprotocol/sdk"`
- `import { ... } from "react"`
- `import { ... } from "../../adapters/..."` — adapters depend on domain, never the reverse
- `import { ... } from "../../hooks/..."` — hooks depend on domain, never the reverse
- `import { ... } from "../../components/..."` — components depend on domain, never the reverse

**Why**: Domain types flow everywhere (hooks, components, adapters, shared). If domain imports `obsidian`, the entire dependency graph tightens. ACP SDK evolves rapidly — isolation keeps domain stable across protocol changes.

**For LLM-assisted coding**: When asked to add a new capability, the correct pattern is:
1. Define the **interface** in `domain/ports/` (e.g., a new method on `IAgentClient`)
2. Define any new **types** in `domain/models/`
3. Implement the concrete behavior in `adapters/` (e.g., `AcpAdapter`)
4. **Never** pull adapter logic into domain — if you need to reference an adapter type, you’re going the wrong direction

**Only exception**: `settings-access.port.ts` imports `AgentClientPluginSettings` from `../../plugin` — pragmatic coupling to the plugin's settings type, not an external library.

## Port Completeness

All capabilities consumed by `hooks/` and `components/` MUST be exposed through a Port interface in this directory. If a hook needs a method that only exists on a concrete adapter class (e.g., `IAcpClient` in `adapters/acp/`), the correct response is to **promote that method to the Port interface**, not to import the adapter directly.

Current ports and their adapter implementations:

| Port | Adapter | Notes |
|------|---------|---------|
| `IAgentClient` | `AcpAdapter` | Core agent communication |
| `IVaultAccess` | `ObsidianVaultAdapter` | Vault file operations |
| `ISettingsAccess` | `SettingsStore` | Settings persistence |
| `IChatViewContainer` | `ChatView` | View lifecycle management |

## Key Port Methods

**IVaultAccess** (`vault-access.port.ts`):
- `readNote(path)` — read text file content
- `readBinaryFile(path)` — read binary file bytes as `Uint8Array` (used for image attachments)
- `searchNotes(query)` — fuzzy search
- `getActiveFile()` / `getActiveFileSelection()` — active editor state tracking

## Adding a New Domain Type

1. Create/extend in `models/` — pure TypeScript interfaces/types only
2. If it represents an agent event → add variant to `SessionUpdate` union
3. If it needs adapter conversion → update `AcpTypeConverter` in `adapters/acp/`
4. If it's a new capability → extend `IAgentClient` port, then implement in `AcpAdapter`
5. If it's a new vault operation → extend `IVaultAccess` port, then implement in `ObsidianVaultAdapter`

## Anti-Patterns (Domain Layer)

- **Don't define domain types that reference adapter-specific concepts** (e.g., `acp.TerminalOutputRequest` is an ACP SDK type and must not appear in any Port signature)
- **Don't put business orchestration logic in domain** — domain is types + interfaces only; orchestration belongs in `hooks/` or `application/`
- **Don't duplicate Port methods** across multiple Ports — each capability should have exactly one canonical Port owner
- **Don't add optional methods to Ports without documenting when they're available** — consumers need to know if a method might be `undefined`
