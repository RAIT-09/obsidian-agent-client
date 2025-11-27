# Terminal Mode & Native Settings Design

## Overview

Add Terminal Mode and Native Settings panels to the existing Agent Client plugin, providing full Claude Code CLI access and configuration within Obsidian.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Integration | Tab/toggle within existing chat view |
| Terminal rendering | xterm.js with WebGL acceleration |
| PTY backend | Python helper script |
| Settings scope | Full parity with Claude's `/config` |
| Performance | GPU rendering, lazy loading, PTY pre-warming |
| Settings storage | Direct read/write of `~/.claude/` config files |
| Mode toggle UI | Tab bar at top of view |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ChatView.tsx (unified)                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │    [Chat]    [Terminal]    [Settings]                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌───────────────┐ ┌─────────────────┐ ┌──────────────────┐    │
│  │  ChatPanel    │ │ TerminalPanel   │ │  SettingsPanel   │    │
│  │  (existing)   │ │ (new)           │ │  (new)           │    │
│  │               │ │                 │ │                  │    │
│  │  ACP Protocol │ │ xterm.js        │ │  React forms     │    │
│  │  React render │ │ Python PTY      │ │  Claude config   │    │
│  └───────────────┘ └─────────────────┘ └──────────────────┘    │
│                              │                                   │
│              ┌───────────────┴───────────────┐                  │
│              ▼                               ▼                  │
│  ┌─────────────────────────┐    ┌─────────────────────────┐    │
│  │    PtyManager           │    │   ClaudeConfigService   │    │
│  │    (infrastructure)     │    │   (adapters)            │    │
│  │                         │    │                         │    │
│  │  - Python process mgmt  │    │  - Read ~/.claude/*     │    │
│  │  - Resize handling      │    │  - Write settings.json  │    │
│  │  - Signal forwarding    │    │  - Watch for changes    │    │
│  └─────────────────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## New File Structure

```
src/
├── infrastructure/
│   └── pty/
│       ├── pty-manager.ts          # Spawns/manages Python helper
│       ├── pty-helper.py           # Python script (bundled)
│       ├── pty-protocol.ts         # JSON message types
│       └── python-detector.ts      # Find Python installation
│
├── adapters/
│   └── claude-config/
│       ├── claude-config.service.ts
│       ├── claude-config.types.ts
│       └── claude-config.watcher.ts
│
├── presentation/
│   └── components/
│       ├── shared/
│       │   └── TabBar.tsx
│       ├── terminal/
│       │   ├── TerminalPanel.tsx
│       │   ├── useTerminal.ts
│       │   └── terminal.css
│       └── settings/
│           ├── SettingsPanel.tsx
│           ├── ModelSelector.tsx
│           ├── PermissionsEditor.tsx
│           ├── McpServerManager.tsx
│           ├── CustomInstructionsEditor.tsx
│           └── settings-panel.css
```

## Component Details

### 1. Tab Bar

Three tabs: Chat, Terminal, Settings

- Keyboard shortcuts: Mod+1, Mod+2, Mod+3
- Status indicator on Terminal tab when process running
- Accessible with proper ARIA roles

### 2. Terminal Panel

**Dependencies:**
- @xterm/xterm ^5.5.0
- @xterm/addon-webgl ^0.18.0
- @xterm/addon-fit ^0.10.0
- @xterm/addon-web-links ^0.11.0

**Features:**
- GPU-accelerated rendering via WebGL (canvas fallback)
- 10,000 line scrollback buffer (configurable)
- Auto-fit to container with debounced resize
- Clickable URLs
- Obsidian theme integration

### 3. PTY Manager

**Protocol (JSON over stdio):**

```typescript
// Plugin → Python
{ "type": "spawn", "cmd": "claude", "args": [], "cwd": "/path", "env": {...} }
{ "type": "write", "data": "user input here\n" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "kill" }

// Python → Plugin
{ "type": "output", "data": "...terminal output..." }
{ "type": "exit", "code": 0 }
{ "type": "error", "message": "..." }
```

**Lifecycle:**
- Pre-warm Python helper on plugin load
- Reuse PTY process between sessions
- Graceful shutdown with 100ms timeout

### 4. Settings Panel

**Sections:**
- Model selection (Opus, Sonnet, Haiku)
- Permissions (allowed/denied tools, auto-approve)
- MCP Servers (add, remove, edit, test connection)
- Custom Instructions (textarea)
- Theme (dark, light, system)

**Config Files:**
```
~/.claude/
├── settings.json          # Main settings
├── settings.local.json    # Local overrides
├── credentials.json       # API keys
├── allowed_tools.json     # Tool permissions
└── mcp_servers.json       # MCP configurations
```

### 5. Claude Config Service

```typescript
interface ClaudeSettings {
  model: 'opus' | 'sonnet' | 'haiku';
  theme: 'dark' | 'light' | 'system';
  customInstructions: string;
  permissions: {
    allowedTools: string[];
    deniedTools: string[];
    autoApprove: boolean;
  };
  memory: {
    enabled: boolean;
    contextWindow: number;
  };
  mcpServers: McpServerConfig[];
}

class ClaudeConfigService {
  async getSettings(): Promise<ClaudeSettings>;
  async updateSettings(updates: Partial<ClaudeSettings>): Promise<void>;
  watch(callback: (settings: ClaudeSettings) => void): () => void;
  async addMcpServer(config: McpServerConfig): Promise<void>;
  async removeMcpServer(name: string): Promise<void>;
  async testMcpServer(name: string): Promise<boolean>;
}
```

## Performance Targets

| Metric | Target |
|--------|--------|
| First terminal prompt | <100ms after tab click |
| Rendering framerate | 60fps during rapid output |
| Memory (terminal) | <50MB with 10K scrollback |
| Plugin startup impact | <50ms (PTY warms in background) |
| xterm.js lazy load | ~80ms first time, cached after |

### Optimization Strategies

1. **GPU Rendering:** WebGL addon with canvas fallback
2. **Lazy Loading:** xterm.js loaded only when Terminal tab opened
3. **PTY Pre-warming:** Python helper spawned on plugin load
4. **Debounced Resize:** 50ms debounce on container resize
5. **Scrollback Limit:** 10K lines default, configurable
6. **Memory Cleanup:** Clear buffer on tab switch if >50K lines

## Error Handling

| Scenario | Detection | Response |
|----------|-----------|----------|
| Python not installed | `findPython()` returns null | Show install guide banner |
| PTY spawn fails | Error message from helper | Toast + reconnect button |
| Claude CLI not found | Exit code 127 | Installation instructions |
| PTY process crashes | Unexpected exit | "Disconnected. [Reconnect]" |
| Config file corrupt | JSON parse error | Offer reset to defaults |
| Config permissions | EACCES error | Permission instructions |
| WebGL unavailable | Addon throws | Auto-fallback to canvas |

### Settings Conflict Resolution

When external changes detected while user has unsaved changes:
1. Show conflict modal
2. Options: Keep mine / Use external / Merge manually

## Graceful Degradation

- Terminal tab shows install guide if Python unavailable
- WebGL falls back to canvas automatically
- Settings panel works even if some config files missing

## Process Lifecycle

```
Plugin Load
    ├─► Detect Python (async, ~10ms) → Cache result
    ├─► Pre-warm PTY helper (background)
    └─► Ready

Tab Switch to Terminal
    ├─► Load xterm.js (lazy, first time)
    ├─► Initialize Terminal instance
    ├─► Send spawn command
    └─► Claude prompt visible

Plugin Unload
    ├─► Send kill to PTY helper
    ├─► Wait for graceful exit (100ms)
    ├─► Force kill if needed
    └─► Cleanup xterm.js
```

## Testing Strategy

1. **Unit Tests:** PtyManager, ClaudeConfigService, protocol parsing
2. **Integration Tests:** PTY communication, config file read/write
3. **E2E Tests:** Tab switching, terminal input/output, settings save
4. **Performance Tests:** Rendering benchmarks, memory profiling

## Future Considerations

- Session persistence (restore terminal state on reopen)
- Multiple terminal instances
- Terminal themes beyond Obsidian integration
- Settings sync across devices
