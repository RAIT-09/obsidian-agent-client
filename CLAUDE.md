# Agent Client Plugin - Development Documentation

## Project Overview

The **Agent Client Plugin for Obsidian** enables users to interact with AI coding agents (Claude Code, Gemini CLI, and custom agents) directly within Obsidian. The plugin provides a dedicated chat interface in the right sidebar with support for note mentions, terminal integration, and permission management.

## Architecture

### Core Structure

```
src/
├── main.ts                      # Plugin entry point, settings management
├── ChatView.tsx                 # Main React chat interface
├── settings-store.ts            # Reactive settings state management  
├── terminal-manager.ts          # Terminal process management
├── services/
│   ├── acp-client.ts           # Agent Client Protocol communication
│   └── mention-service.ts      # Note mention functionality
├── components/
│   ├── chat/                   # Chat UI components
│   ├── settings/               # Settings UI components
│   └── ui/                     # Common UI components
├── utils/
│   ├── logger.ts               # Debug logging system
│   ├── mention-utils.ts        # Mention parsing utilities
│   └── settings-utils.ts       # Settings validation helpers
└── types/
    └── acp-types.ts            # TypeScript type definitions
```

### Key Technologies

- **Agent Client Protocol (ACP)**: Communication with AI agents
- **React 19**: UI framework for chat interface
- **TypeScript**: Type safety throughout codebase
- **Obsidian Plugin API**: Desktop-only plugin architecture

## Core Components

### 1. Main Plugin Class (`main.ts`)

**Purpose**: Plugin lifecycle management, settings persistence, view registration

**Key Features**:
- Manages agent configurations (Claude Code, Gemini CLI, custom agents)
- Handles settings loading/saving with validation
- Registers chat view and ribbon icon
- Maintains reactive settings store

**Settings Structure**:
```typescript
interface AgentClientPluginSettings {
  gemini: GeminiAgentSettings;
  claude: ClaudeAgentSettings; 
  customAgents: CustomAgentSettings[];
  activeAgentId: string;
  autoAllowPermissions: boolean;
  debugMode: boolean;  // Added for log management
}
```

### 2. Chat Interface (`ChatView.tsx`)

**Purpose**: Main React component providing chat UI and agent interaction

**Key Features**:
- Real-time chat with selected AI agent
- Note mention support using `@notename` syntax
- Message rendering with markdown, thoughts, and terminal output
- Input handling with mention dropdown suggestions
- Agent switching and connection management

**State Management**:
- Uses `useSyncExternalStore` for reactive settings
- Manages chat messages, session state, and UI state
- Handles mention context and suggestions

### 3. ACP Client (`services/acp-client.ts`)

**Purpose**: Handles communication with AI agents via Agent Client Protocol

**Key Features**:
- Session management (create, authenticate, cancel)
- Message sending and response handling
- Terminal operation proxying
- Permission request management
- Streaming response processing

**Integration Points**:
- Receives plugin instance for logger access
- Manages TerminalManager for command execution
- Provides callbacks for UI updates

### 4. Terminal Manager (`terminal-manager.ts`)

**Purpose**: Manages terminal processes spawned by AI agents

**Key Features**:
- Process lifecycle management (spawn, monitor, cleanup)
- Output capture with byte limits
- Exit status tracking
- Graceful termination handling

**Security Considerations**:
- Processes run with inherited environment
- Working directory control
- Output size limitations

### 5. Mention System

**Components**:
- `NoteMentionService`: Indexes vault files for fuzzy search
- `mention-utils.ts`: Parsing and conversion utilities
- `MentionDropdown`: UI for selecting mentioned notes

**Flow**:
1. User types `@` in chat input
2. System detects mention context
3. Fuzzy search provides file suggestions
4. Selected mentions convert to file paths for agents

## Settings System

### Configuration Hierarchy
1. **Built-in Agents**: Claude Code and Gemini CLI with predefined defaults
2. **Custom Agents**: User-defined ACP-compatible tools
3. **General Settings**: Auto-permissions and debug mode

### Settings Store Pattern
- Reactive store using observer pattern
- React components subscribe to settings changes
- Automatic UI updates on settings modifications

### Validation & Migration
- Settings are validated and normalized on load
- Handles legacy field names and missing properties
- Ensures active agent ID remains valid

## Debug System

### Logger Implementation (`utils/logger.ts`)

**Purpose**: Conditional logging based on debug mode setting

**Features**:
- Respects `debugMode` setting in plugin configuration
- Provides standard console methods (log, error, warn, info)
- Used consistently across all components

**Usage Pattern**:
```typescript
// In classes
constructor(plugin: AgentClientPlugin) {
  this.logger = new Logger(plugin);
}
this.logger.log("Debug message", data);

// In React components  
const logger = useMemo(() => new Logger(plugin), [plugin]);
logger.log("Component debug info");
```

### Debug Mode Control
- Toggle in Settings → Developer Settings
- Default: `false` (disabled for production)
- Instantly affects all logging throughout application

## Development Guidelines

### Obsidian Plugin Review Requirements

**CRITICAL: These rules must be followed to pass Obsidian's automated review:**

1. **Security**: Never use `innerHTML`, `outerHTML`, or similar APIs
   - Use DOM API or Obsidian helper functions: `createEl`, `createDiv`, `createSpan`
   - Reference: https://docs.obsidian.md/Plugins/User+interface/HTML+elements

2. **Plugin Lifecycle**: Do NOT detach leaves with custom views in `onunload`
   - This is an antipattern that causes issues
   - Reference: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Don't+detach+leaves+in+%60onunload%60

3. **Styling**: Move all styles to CSS files
   - Do NOT assign styles via JavaScript or inline in HTML
   - Allows themes and snippets to adapt styles
   - Use CSS classes instead of direct style manipulation

4. **Platform Detection**: Use Obsidian's `Platform` interface
   - Do NOT use `process.platform` or other Node.js APIs directly
   - Ensures proper cross-platform compatibility

5. **Type Safety**: Minimize `any` casting
   - Use proper TypeScript types throughout
   - Only use `any` when absolutely necessary for Obsidian API limitations

### Code Patterns

1. **Error Handling**: Always handle async operations with try-catch
2. **TypeScript**: Strict typing, avoid `any` except for plugin API limitations
3. **React**: Use hooks consistently, memoize expensive operations
4. **Settings**: Always validate and provide defaults
5. **Logging**: Use Logger class instead of direct console calls

### File Organization

- Components are grouped by functionality (chat/, settings/, ui/)
- Services handle external communication and business logic  
- Utils contain pure functions and helpers
- Types centralize TypeScript definitions

### Testing Strategy

- Build validation via TypeScript compiler
- Manual testing in Obsidian development environment
- Settings validation on load prevents runtime errors

## Common Issues & Solutions

### 1. Agent Connection Failures
- **Cause**: Incorrect command paths or missing dependencies
- **Solution**: Verify agent installation and path configuration
- **Debug**: Enable debug mode to see detailed connection logs

### 2. Permission Requests
- **Cause**: Agents request file/system access
- **Solution**: Use auto-allow for trusted agents or approve manually
- **Security**: Review permissions carefully before allowing

### 3. Terminal Process Cleanup
- **Cause**: Long-running processes may persist after session end
- **Solution**: TerminalManager handles cleanup on plugin unload
- **Monitoring**: Debug logs track process lifecycle

### 4. Mention Resolution
- **Cause**: File paths may not resolve correctly across platforms
- **Solution**: Uses Obsidian's TFile API for reliable path handling
- **Fallback**: Original mention preserved if file not found

## Future Considerations

1. **Performance**: Large vaults may need mention indexing optimization
2. **Security**: Consider sandboxing for untrusted custom agents  
3. **UI**: Mobile support would require significant rework
4. **Testing**: Automated test suite for core functionality
5. **Internationalization**: UI strings are currently hardcoded

## Development Setup

1. Install dependencies: `npm install`
2. Development build: `npm run dev` (watches for changes)
3. Production build: `npm run build`
4. Link to Obsidian vault plugins folder for testing

## Agent Requirements

Compatible agents must support the Agent Client Protocol (ACP) specification. Examples:
- `@zed-industries/claude-code-acp`
- `@google/gemini-cli` (with --experimental-acp flag)

Custom agents need to implement ACP's JSON-RPC protocol over stdin/stdout.