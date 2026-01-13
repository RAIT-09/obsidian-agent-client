# ACP Protocol Support

This page documents which Agent Client Protocol (ACP) features are supported by this plugin.

## What is ACP?

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) is an open standard for communication between AI agents and client applications. It defines how clients send prompts, receive responses, handle permissions, and manage sessions.

Agent Client implements ACP as a **client**, communicating with ACP-compatible agents like Claude Code, Codex, and Gemini CLI.

## Methods

### Client → Agent

Methods the plugin can call on agents.

| Method | Status | Notes |
|--------|--------|-------|
| `initialize` | ✅ Supported | |
| `authenticate` | ✅ Supported | |
| `session/new` | ✅ Supported | |
| `session/prompt` | ✅ Supported | |
| `session/cancel` | ✅ Supported | |
| `session/set_mode` | ✅ Supported | |
| `session/load` | ✅ Supported | |
| `session/set_model` | ✅ Supported | Unstable API |
| `session/list` | ✅ Supported | Unstable API |
| `session/resume` | ✅ Supported | Unstable API |
| `session/fork` | ✅ Supported | Unstable API |

::: tip
Methods marked "Unstable API" may change in future ACP versions. They are prefixed with `unstable_` in the SDK.
:::

### Agent → Client (Notifications)

Session updates the plugin can receive from agents via `session/update`.

| Update Type | Status | Notes |
|-------------|--------|-------|
| `agent_message_chunk` | ✅ Supported | Text only |
| `agent_thought_chunk` | ✅ Supported | Text only |
| `user_message_chunk` | ✅ Supported | Text only; used for session history replay |
| `tool_call` | ✅ Supported | |
| `tool_call_update` | ✅ Supported | |
| `plan` | ✅ Supported | |
| `available_commands_update` | ✅ Supported | |
| `current_mode_update` | ✅ Supported | |

### Agent → Client (Requests)

Requests agents can make to the plugin.

| Method | Status | Notes |
|--------|--------|-------|
| `session/request_permission` | ✅ Supported | |
| `terminal/create` | ✅ Supported | |
| `terminal/output` | ✅ Supported | |
| `terminal/wait_for_exit` | ✅ Supported | |
| `terminal/kill` | ✅ Supported | |
| `terminal/release` | ✅ Supported | |
| `fs/read_text_file` | — | Agents use their own Read tools |
| `fs/write_text_file` | — | Agents use their own Write tools |

## Content Types

### Prompt Content (Client → Agent)

Content types the plugin can send in `session/prompt`.

| Type | Status | Notes |
|------|--------|-------|
| `text` | ✅ Supported | |
| `image` | ✅ Supported | Requires agent support |
| `audio` | ❌ Not supported | |
| `resource_link` | ❌ Not supported | |
| `resource` | ✅ Supported | Embedded context; requires agent support |

### Tool Call Content (Agent → Client)

Content types the plugin can display in tool calls.

| Type | Status | Notes |
|------|--------|-------|
| `diff` | ✅ Supported | |
| `terminal` | ✅ Supported | |
| `content` | ❌ Not supported | |

## Client Capabilities

Capabilities advertised to agents during initialization.

| Capability | Value |
|------------|-------|
| `fs.readTextFile` | `false` |
| `fs.writeTextFile` | `false` |
| `terminal` | `true` |

::: info
The plugin does not implement filesystem operations (`fs/read_text_file`, `fs/write_text_file`). Agents handle file operations through their own tools.
:::

## See Also

- [Agent Client Protocol Specification](https://agentclientprotocol.com/)
- [ACP Schema Reference](https://agentclientprotocol.com/protocol/schema)
