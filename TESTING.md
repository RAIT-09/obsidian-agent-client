# Testing Guide

This guide covers testing practices and infrastructure for the Agent Client Plugin.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Test Infrastructure](#test-infrastructure)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Writing Tests](#writing-tests)
- [Coverage Reports](#coverage-reports)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

The project uses [Vitest](https://vitest.dev/) as the testing framework, chosen for its:

- Native TypeScript and ESM support
- Fast execution with instant hot module reload
- Compatible API with Jest
- Built-in coverage reporting with v8
- Elegant UI mode for visual test exploration

### Current Test Coverage

**Overall Project Coverage**: 50.47% (142 tests total)

- **Use Cases**: 95.92% coverage (58 tests)
  - `SendMessageUseCase`: 15 tests
  - `ManageSessionUseCase`: 15 tests
  - `HandlePermissionUseCase`: 16 tests
  - `SwitchAgentUseCase`: 12 tests

- **ViewModels**: 98.31% coverage (84 tests)
  - `ChatViewModel`: 84 tests covering all 27 public methods
    - Observer Pattern (5 tests)
    - State Initialization (5 tests)
    - Computed Properties (4 tests)
    - Session Management (6 tests)
    - Message Operations (10 tests)
    - Permission Handling (3 tests)
    - Agent Management (2 tests)
    - Mention Management (12 tests)
    - Slash Command Management (11 tests)
    - Lifecycle (1 test)

### Technology Stack

- **Framework**: Vitest 1.6.1
- **DOM Environment**: happy-dom (lightweight DOM implementation)
- **Coverage**: @vitest/coverage-v8
- **React Testing**: @testing-library/react (for future component tests)

## Quick Start

### Installation

```bash
npm install
```

The project includes `.npmrc` with `legacy-peer-deps=true` to handle `@types/node` version differences between the project (v16) and Vitest (requires v18+).

### Run Tests

```bash
# Run tests in watch mode (recommended for development)
npm test

# Run tests once and exit (for CI)
npm run test:run

# Run tests with UI mode
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Test Infrastructure

### Configuration Files

#### `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,                    // Enable global test APIs
    environment: 'happy-dom',         // Lightweight DOM implementation
    setupFiles: ['./test/setup.ts'],  // Global setup
    coverage: {
      provider: 'v8',
      exclude: [
        'node_modules/',
        'test/',
        'src/infrastructure/**',      // External framework code
        'src/presentation/**',        // UI components (future)
      ],
    },
    alias: {
      obsidian: path.resolve(__dirname, './test/mocks/obsidian.ts'),
    },
  },
});
```

#### `test/setup.ts`

Global test setup including:
- Crypto API mock for UUID generation
- Global test utilities
- Environment configuration
- **Dynamic require() interception**: Redirects runtime `require('obsidian')` calls to the mock module

#### `test/mocks/obsidian.ts`

Comprehensive mock of Obsidian API including:
- `Vault`: File operations (read, getAbstractFileByPath, etc.)
- `TFile`, `TFolder`: File system abstractions
- `Plugin`: Plugin lifecycle
- `Platform`: Platform detection
- Settings and events

#### `test/mocks/codemirror.ts`

Mock of CodeMirror editor API for editor-related tests.

## Running Tests

### Watch Mode (Development)

```bash
npm test
```

Features:
- Automatically reruns tests on file changes
- Press `p` to filter by file name
- Press `t` to filter by test name
- Press `f` to run only failed tests
- Press `a` to run all tests
- Press `q` to quit

### Single Run (CI)

```bash
npm run test:run
```

Runs all tests once and exits. Ideal for continuous integration pipelines.

### UI Mode (Visual)

```bash
npm run test:ui
```

Opens a browser-based UI at `http://localhost:51204/__vitest__/` with:
- Interactive test explorer
- Side-by-side source and test code view
- Real-time test execution
- Detailed error inspection

### Run Specific Tests

```bash
# Run a specific test file
npm test src/core/use-cases/send-message.use-case.test.ts

# Run tests matching a pattern
npm test -- --grep="auto-mention"
```

### Coverage Report

```bash
npm run test:coverage
```

Generates:
- Console output with coverage summary
- HTML report in `coverage/` directory
- JSON report (`coverage/coverage-final.json`)

Open `coverage/index.html` in a browser for detailed, line-by-line coverage visualization:
- 🟢 Green: Tested code
- 🟡 Yellow: Partially tested (some branches covered)
- 🔴 Red: Untested code

## Test Structure

### Use Case Tests

Use Case tests follow the **Arrange-Act-Assert** pattern:

```typescript
describe('SendMessageUseCase', () => {
  let useCase: SendMessageUseCase;
  let mockAgentClient: IAgentClient;
  let mockVaultAccess: IVaultAccess;
  let mockMentionService: NoteMentionService;

  beforeEach(() => {
    // Arrange: Set up mocks and test subject
    mockAgentClient = {
      sendMessage: vi.fn(),
      // ... other methods
    } as unknown as IAgentClient;

    mockVaultAccess = {
      readNote: vi.fn(),
      // ... other methods
    } as unknown as IVaultAccess;

    useCase = new SendMessageUseCase(
      mockAgentClient,
      mockVaultAccess,
      mockMentionService
    );
  });

  it('should prepare message with auto-mention', async () => {
    // Arrange: Set up test data
    const activeNote = { path: 'notes/test.md', name: 'test' };
    vi.mocked(mockVaultAccess.readNote)
      .mockResolvedValue('Note content');

    // Act: Execute the use case
    const result = await useCase.prepareMessage({
      message: 'Test message',
      activeNote,
      vaultBasePath: '/vault',
    });

    // Assert: Verify the result
    expect(result.agentMessage).toContain('obsidian_opened_note');
    expect(result.agentMessage).toContain('/vault/notes/test.md');
  });
});
```

### ChatViewModel Tests

The `ChatViewModel` is the presentation layer that manages UI state and coordinates between Use Cases, serving as the bridge between React components and business logic. With 1,069 lines of code and 27 public methods, comprehensive testing ensures reliability of the user-facing chat interface.

**Location**: `src/adapters/view-models/chat.view-model.test.ts`

**Coverage**: 98.31% (84 tests)

#### Why Test ChatViewModel?

1. **Central Coordinator**: Orchestrates multiple Use Cases and manages complex state transitions
2. **React Integration**: Implements Observer pattern for `useSyncExternalStore` hook
3. **Complex State Machine**: Manages session lifecycle (disconnected → initializing → ready → busy → error)
4. **User-Facing**: Errors in ViewModel directly impact user experience
5. **Streaming Responses**: Handles incremental message updates from agent

#### Test Architecture

ChatViewModel tests follow the **Arrange-Act-Assert** pattern with comprehensive mocking:

```typescript
describe('ChatViewModel', () => {
  let viewModel: ChatViewModel;
  let mockPlugin: AgentClientPlugin;
  let mockSendMessageUseCase: SendMessageUseCase;
  let mockManageSessionUseCase: ManageSessionUseCase;
  let mockHandlePermissionUseCase: HandlePermissionUseCase;
  let mockSwitchAgentUseCase: SwitchAgentUseCase;
  let mockVaultAccess: IVaultAccess;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock plugin with settings
    mockPlugin = {
      settings: {
        activeAgentId: 'claude-code-acp',
        autoMention: true,
        autoAllowPermissions: false,
        // ... other settings
      },
      saveSettings: vi.fn(),
    } as unknown as AgentClientPlugin;

    // Create mock Use Cases
    mockSendMessageUseCase = {
      prepareMessage: vi.fn(),
      sendPreparedMessage: vi.fn(),
    } as unknown as SendMessageUseCase;

    // ... other mocks

    // Instantiate ChatViewModel with all dependencies
    viewModel = new ChatViewModel(
      mockPlugin,
      mockSendMessageUseCase,
      mockManageSessionUseCase,
      mockHandlePermissionUseCase,
      mockSwitchAgentUseCase,
      mockVaultAccess,
      '/test/vault'
    );
  });

  // Tests go here
});
```

#### Test Categories

##### 1. Observer Pattern (5 tests)

Tests verify React integration via `useSyncExternalStore`:

```typescript
describe('Observer Pattern', () => {
  it('should notify listeners when state changes', () => {
    const listener = vi.fn();
    viewModel.subscribe(listener);

    viewModel.clearError(); // Trigger state change

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should allow unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = viewModel.subscribe(listener);

    unsubscribe();
    viewModel.clearError();

    expect(listener).not.toHaveBeenCalled();
  });

  it('should support multiple listeners', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    viewModel.subscribe(listener1);
    viewModel.subscribe(listener2);
    viewModel.clearError();

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});
```

**Why This Matters**: Ensures memory leak prevention and proper React component re-rendering.

##### 2. State Management (6 tests)

Tests verify session lifecycle and state transitions:

```typescript
describe('Session Management', () => {
  it('should create new session', async () => {
    vi.mocked(mockManageSessionUseCase.createSession)
      .mockResolvedValue({
        sessionId: 'test-session-123',
        state: 'ready',
        agentId: 'claude-code-acp',
        authMethods: [],
        availableCommands: [],
        createdAt: new Date(),
        lastActivityAt: new Date(),
        workingDirectory: '/test/vault',
      });

    await viewModel.createNewSession();

    const state = viewModel.getSnapshot();
    expect(state.session.sessionId).toBe('test-session-123');
    expect(state.session.state).toBe('ready');
  });

  it('should transition through states correctly', async () => {
    // State: disconnected → initializing → ready
    let state = viewModel.getSnapshot();
    expect(state.session.state).toBe('disconnected');

    const createPromise = viewModel.createNewSession();

    // Check intermediate state (if needed)
    state = viewModel.getSnapshot();
    // May be 'initializing' depending on timing

    await createPromise;

    state = viewModel.getSnapshot();
    expect(state.session.state).toBe('ready');
  });
});
```

##### 3. Message Operations (10 tests)

Tests verify message sending, streaming, and error handling:

```typescript
describe('Message Operations', () => {
  it('should prepare message and add to UI immediately', async () => {
    vi.mocked(mockSendMessageUseCase.prepareMessage)
      .mockResolvedValue({
        displayMessage: 'Test message',
        agentMessage: 'Test message',
      });
    vi.mocked(mockSendMessageUseCase.sendPreparedMessage)
      .mockResolvedValue();

    await viewModel.sendMessage('Test message');

    const state = viewModel.getSnapshot();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content[0].text).toBe('Test message');
  });

  it('should update last message incrementally (streaming)', () => {
    // Add initial assistant message
    viewModel.addMessage({
      id: 'msg-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: new Date(),
    });

    // Simulate streaming update
    viewModel.updateLastMessage({
      type: 'text',
      text: ' world',
    });

    const state = viewModel.getSnapshot();
    expect(state.messages[0].content[0].text).toBe('Hello world');
  });

  it('should handle send errors gracefully', async () => {
    vi.mocked(mockSendMessageUseCase.prepareMessage)
      .mockResolvedValue({
        displayMessage: 'Test',
        agentMessage: 'Test',
      });
    vi.mocked(mockSendMessageUseCase.sendPreparedMessage)
      .mockRejectedValue(new Error('Network error'));

    await viewModel.sendMessage('Test');

    const state = viewModel.getSnapshot();
    expect(state.errorInfo).toBeTruthy();
    expect(state.errorInfo?.title).toContain('Error');
  });
});
```

##### 4. Mention System (12 tests)

Tests verify @[[note]] autocomplete and navigation:

```typescript
describe('Mention Management', () => {
  it('should detect mention trigger and show suggestions', async () => {
    vi.mocked(mockVaultAccess.searchNotes).mockResolvedValue([
      {
        path: 'notes/test.md',
        name: 'test',
        basename: 'test',
        extension: 'md',
      },
    ]);

    await viewModel.updateMentionSuggestions('test @', 6);

    const state = viewModel.getSnapshot();
    expect(state.mentionDropdown.isVisible).toBe(true);
    expect(state.mentionDropdown.suggestions).toHaveLength(1);
    expect(state.mentionDropdown.suggestions[0].name).toBe('test');
  });

  it('should insert mention with @[[syntax]] when selected', () => {
    viewModel['mentionDropdown'] = {
      isVisible: true,
      query: 'test',
      cursorPos: 6,
      suggestions: [
        {
          path: 'notes/test.md',
          name: 'test',
          basename: 'test',
          extension: 'md',
        },
      ],
      selectedIndex: 0,
    };

    const result = viewModel.selectMention('Hello @', 6);

    expect(result.newMessage).toBe('Hello @[[test]]');
    expect(result.newCursorPos).toBe(15); // After @[[test]]
  });
});
```

##### 5. Slash Command System (11 tests)

Tests verify ACP protocol slash command integration:

```typescript
describe('Slash Command Management', () => {
  it('should detect slash command at message start', async () => {
    const commands: SlashCommand[] = [
      { name: 'web', description: 'Search the web', hint: 'query' },
      { name: 'test', description: 'Run tests', hint: null },
    ];

    viewModel.updateAvailableCommands(commands);
    await viewModel.updateSlashCommandSuggestions('/we', 3);

    const state = viewModel.getSnapshot();
    expect(state.slashCommandDropdown.isVisible).toBe(true);
    expect(state.slashCommandDropdown.suggestions).toHaveLength(1);
    expect(state.slashCommandDropdown.suggestions[0].name).toBe('web');
  });

  it('should insert slash command and show hint overlay', () => {
    viewModel['slashCommandDropdown'] = {
      isVisible: true,
      query: 'we',
      cursorPos: 3,
      suggestions: [
        { name: 'web', description: 'Search the web', hint: 'query' },
      ],
      selectedIndex: 0,
    };

    const result = viewModel.selectSlashCommand('/we', 3);

    expect(result.newMessage).toBe('/web ');
    expect(result.newCursorPos).toBe(5);
    expect(result.showHintOverlay).toBe(true);
    expect(result.hintText).toBe('query');
  });
});
```

#### Testing Async Operations

**Pattern**: Use controlled promises for precise state capture:

```typescript
it('should set isSending to true during message send', async () => {
  let resolvePrepare: (value: any) => void;
  const preparePromise = new Promise((resolve) => {
    resolvePrepare = resolve;
  });

  vi.mocked(mockSendMessageUseCase.prepareMessage)
    .mockReturnValue(preparePromise as any);
  vi.mocked(mockSendMessageUseCase.sendPreparedMessage)
    .mockImplementation(() => new Promise(() => {})); // Never resolves

  const sendPromise = viewModel.sendMessage('Test');

  // Manually control when prepare completes
  resolvePrepare!({
    displayMessage: 'Test',
    agentMessage: 'Test',
  });
  await new Promise(resolve => setTimeout(resolve, 10));

  const state = viewModel.getSnapshot();
  expect(state.isSending).toBe(true);
  expect(state.session.state).toBe('busy');

  // Clean up (don't wait forever)
  vi.mocked(mockSendMessageUseCase.sendPreparedMessage)
    .mockResolvedValue();
  await sendPromise;
});
```

**Alternative**: Test final states for simpler scenarios:

```typescript
it('should reset isSending after message sent', async () => {
  vi.mocked(mockSendMessageUseCase.prepareMessage)
    .mockResolvedValue({ displayMessage: 'Test', agentMessage: 'Test' });
  vi.mocked(mockSendMessageUseCase.sendPreparedMessage)
    .mockResolvedValue();

  await viewModel.sendMessage('Test');

  const state = viewModel.getSnapshot();
  expect(state.isSending).toBe(false);
  expect(state.session.state).toBe('ready');
});
```

#### Testing Streaming Responses

The ViewModel handles incremental updates from the agent:

```typescript
it('should concatenate text content', () => {
  viewModel.addMessage({
    id: 'msg-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    timestamp: new Date(),
  });

  viewModel.updateLastMessage({ type: 'text', text: ' world' });

  expect(viewModel.getSnapshot().messages[0].content[0].text)
    .toBe('Hello world');
});

it('should add newlines between thoughts', () => {
  viewModel.addMessage({
    id: 'msg-1',
    role: 'assistant',
    content: [{ type: 'agent_thought', text: 'Thinking' }],
    timestamp: new Date(),
  });

  viewModel.updateLastMessage({ type: 'agent_thought', text: 'More' });

  expect(viewModel.getSnapshot().messages[0].content[0].text)
    .toBe('Thinking\nMore');
});

it('should replace tool calls by ID', () => {
  viewModel.addMessage({
    id: 'msg-1',
    role: 'assistant',
    content: [{
      type: 'tool_call',
      id: 'tool-1',
      name: 'read_file',
      input: { path: '/test.md' },
      status: 'pending',
    }],
    timestamp: new Date(),
  });

  viewModel.updateLastMessage({
    type: 'tool_call',
    id: 'tool-1',
    name: 'read_file',
    input: { path: '/test.md' },
    status: 'success',
    output: 'File content',
  });

  const content = viewModel.getSnapshot().messages[0].content[0];
  expect(content.status).toBe('success');
  expect(content.output).toBe('File content');
});
```

### Key Testing Patterns

#### 1. Dependency Injection

Use Cases receive all dependencies via constructor, making them easy to mock:

```typescript
const useCase = new SendMessageUseCase(
  mockAgentClient,    // IAgentClient implementation
  mockVaultAccess,    // IVaultAccess implementation
  mockMentionService  // NoteMentionService mock
);
```

#### 2. Mock Setup with Vitest

```typescript
// Mock method to return a value
vi.mocked(mockAgentClient.initialize)
  .mockResolvedValue({ authMethods: [], protocolVersion: 1 });

// Mock method to throw an error
vi.mocked(mockAgentClient.sendMessage)
  .mockRejectedValue(new Error('Network error'));

// Verify method was called
expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
  'session-123',
  'Hello'
);

// Verify method was called with specific arguments
expect(mockAgentClient.initialize).toHaveBeenCalledWith(
  expect.objectContaining({
    env: expect.objectContaining({
      ANTHROPIC_API_KEY: 'test-api-key',
    }),
  })
);
```

#### 3. Testing Async Operations

```typescript
it('should handle async operations', async () => {
  const promise = useCase.createSession({
    workingDirectory: '/test',
    agentId: 'claude-code-acp',
  });

  await expect(promise).resolves.toEqual(
    expect.objectContaining({
      sessionId: 'test-session-123',
    })
  );
});
```

#### 4. Testing Error Cases

```typescript
it('should handle errors gracefully', async () => {
  vi.mocked(mockAgentClient.sendMessage)
    .mockRejectedValue(new Error('Connection failed'));

  await expect(
    useCase.sendPreparedMessage({
      sessionId: 'test-session',
      message: 'Hello',
    })
  ).rejects.toThrow('Connection failed');
});
```

## Writing Tests

### Adding Tests for a New Use Case

1. **Create Test File**: `src/core/use-cases/[use-case-name].use-case.test.ts`

2. **Import Dependencies**:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YourUseCase } from './your.use-case';
import type { IAgentClient } from '../domain/ports/agent-client.port';
// ... other imports
```

3. **Set Up Test Suite**:
```typescript
describe('YourUseCase', () => {
  let useCase: YourUseCase;
  let mockDependency: IDependency;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Create fresh instances
    mockDependency = {
      method: vi.fn(),
    } as unknown as IDependency;

    useCase = new YourUseCase(mockDependency);
  });

  // Tests go here
});
```

4. **Write Test Cases**:
```typescript
describe('methodName', () => {
  it('should handle normal case', () => {
    // Arrange
    const input = { /* ... */ };

    // Act
    const result = useCase.methodName(input);

    // Assert
    expect(result).toBe(expectedValue);
  });

  it('should handle edge case', () => {
    // Test edge cases
  });

  it('should handle error case', () => {
    // Test error scenarios
  });
});
```

### Test Organization Guidelines

#### Group Related Tests

```typescript
describe('SendMessageUseCase', () => {
  describe('prepareMessage', () => {
    it('should return simple message as-is', () => { /* ... */ });
    it('should convert @[[mentions]] to paths', () => { /* ... */ });
    it('should add auto-mention when enabled', () => { /* ... */ });
  });

  describe('sendPreparedMessage', () => {
    it('should send message to agent client', () => { /* ... */ });
    it('should handle network errors', () => { /* ... */ });
    it('should retry on auth failure', () => { /* ... */ });
  });
});
```

#### Use Descriptive Test Names

- ✅ Good: `'should convert @[[note]] to absolute path'`
- ❌ Bad: `'mention conversion'`

- ✅ Good: `'should throw error when session not found'`
- ❌ Bad: `'error test'`

#### Test One Thing Per Test

```typescript
// ✅ Good: Single responsibility
it('should add auto-mention when enabled', () => {
  const result = useCase.prepareMessage({ /* ... */ });
  expect(result.agentMessage).toContain('obsidian_opened_note');
});

// ❌ Bad: Testing multiple things
it('should prepare message correctly', () => {
  const result = useCase.prepareMessage({ /* ... */ });
  expect(result.agentMessage).toContain('obsidian_opened_note');
  expect(result.displayMessage).toBe('original message');
  expect(mockVaultAccess.readNote).toHaveBeenCalled();
  // Too many assertions
});
```

### Mocking Best Practices

#### Mock at the Right Level

```typescript
// ✅ Good: Mock at the port (interface) level
const mockAgentClient: IAgentClient = {
  sendMessage: vi.fn(),
  // ... other methods
} as unknown as IAgentClient;

// ❌ Bad: Don't mock implementation details
vi.mock('../adapters/acp/acp.adapter.ts');  // Too specific
```

#### Use Type-Safe Mocks

```typescript
// ✅ Good: Type-safe mock access
vi.mocked(mockAgentClient.sendMessage)
  .mockResolvedValue(undefined);

// ❌ Bad: Unsafe casting
(mockAgentClient.sendMessage as any)
  .mockResolvedValue(undefined);
```

#### Reset Mocks Between Tests

```typescript
beforeEach(() => {
  vi.clearAllMocks();  // Clear call history
  // OR
  vi.resetAllMocks();  // Reset implementations too
});
```

## Coverage Reports

### Understanding Coverage Metrics

- **Statements**: Percentage of statements executed
- **Branches**: Percentage of conditional branches taken
- **Functions**: Percentage of functions called
- **Lines**: Percentage of lines executed

### Coverage Goals

- **Use Cases**: Target 90%+ (✅ currently 95.92%)
- **ViewModels**: Target 85%+ (✅ currently 98.31%)
- **Adapters**: Target 80%+
- **Utilities**: Target 70%+

### Viewing Coverage

#### Console Output

```bash
npm run test:coverage
```

Output:
```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   50.47 |    82.15 |   67.25 |   50.47 |
 core/use-cases    |   95.92 |     85.6 |     100 |   95.92 |
  ...n.use-case.ts |     100 |    91.66 |     100 |     100 | 86,111
  ...n.use-case.ts |     100 |    96.96 |     100 |     100 | 220
  ...e.use-case.ts |   91.99 |    76.36 |     100 |   91.99 | ...89-506,572-579
  ...t.use-case.ts |     100 |    84.61 |     100 |     100 | 70-74
 adapters/view-models |   98.31 |    94.12 |     100 |   98.31 |
  ...view-model.ts |   98.31 |    94.12 |     100 |   98.31 | 245,287
-------------------|---------|----------|---------|---------|-------------------
```

#### HTML Report

Open `coverage/index.html` in a browser for:
- Interactive file explorer
- Line-by-line coverage highlighting
- Branch coverage details
- Uncovered code identification

### Coverage Configuration

Excluded from coverage (in `vitest.config.ts`):
- `node_modules/` - Third-party code
- `test/` - Test code itself
- `src/infrastructure/**` - External framework integration
- `src/presentation/**` - UI components (future consideration)

## Troubleshooting

### Common Issues

#### 1. Installation Fails with Peer Dependency Error

**Problem**:
```
npm error ERESOLVE could not resolve
npm error peerOptional @types/node@"^18.0.0 || >=20.0.0" from vitest@1.6.1
```

**Solution**:
The project includes `.npmrc` with `legacy-peer-deps=true`. Ensure you have the latest code:
```bash
git pull origin your-branch
npm install
```

#### 2. Tests Fail with "crypto.randomUUID is not a function"

**Problem**: Missing crypto mock in test environment.

**Solution**: Already handled in `test/setup.ts`. Ensure you're using the latest version.

#### 3. Obsidian API Methods Not Available

**Problem**: Tests fail with "undefined is not a function" for Obsidian API calls.

**Solution**: Check that `test/mocks/obsidian.ts` includes the required method. Add if missing:
```typescript
export class Vault {
  // Add missing method
  newMethod = vi.fn();
}
```

#### 3.5. Dynamic require('obsidian') Fails in Tests

**Problem**: Tests fail with "Cannot find module 'obsidian'" when code uses `require('obsidian')` at runtime (not static import).

**Example Error**:
```
Error: Cannot find module 'obsidian'
Require stack:
- /home/user/obsidian-agent-client/src/adapters/view-models/chat.view-model.ts
```

**Root Cause**: Vitest's module alias configuration only works for static imports (`import ... from 'obsidian'`), not dynamic `require('obsidian')` calls at runtime. This happens when code needs to conditionally import Obsidian (e.g., platform detection).

**Solution**: The `test/setup.ts` file now intercepts Node.js's require mechanism globally:

```typescript
// Mock require() for dynamic Obsidian imports
const Module = require('module');
const path = require('path');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
  if (id === 'obsidian') {
    // Return mocked Obsidian module using absolute path
    const mockPath = path.join(__dirname, 'mocks', 'obsidian.ts');
    return originalRequire.call(this, mockPath);
  }
  return originalRequire.apply(this, arguments);
};
```

This solution:
- Intercepts all `require()` calls globally
- Redirects `require('obsidian')` to the mock file
- Uses absolute path to ensure reliable resolution
- Preserves original behavior for other modules

**When to Use**: If you add code that uses `require('obsidian')` at runtime, this setup will automatically handle it. No additional configuration needed.

#### 4. Tests Pass Locally but Fail in CI

**Checklist**:
- ✅ Ensure all test files are committed
- ✅ Check Node.js version matches (v16+)
- ✅ Verify npm version (v8+)
- ✅ Confirm `.npmrc` is committed
- ✅ Check for timing-dependent tests (use `vi.useFakeTimers()`)

### Debugging Tests

#### Enable Verbose Output

```bash
npm test -- --reporter=verbose
```

#### Debug Single Test

```bash
# Run only tests matching a pattern
npm test -- --grep="should handle auto-mention"
```

#### Add Debug Logging

```typescript
it('should do something', () => {
  console.log('Debug info:', someValue);  // Printed to console
  expect(result).toBe(expected);
});
```

#### Use VS Code Debugger

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Current Test File",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "--", "${relativeFile}"],
  "console": "integratedTerminal"
}
```

## Best Practices

### 1. Follow Clean Architecture Principles

Test business logic (Use Cases) in isolation from infrastructure:

```typescript
// ✅ Good: Test Use Case with mocked ports
const mockAgentClient: IAgentClient = { /* ... */ };
const useCase = new SendMessageUseCase(mockAgentClient, /* ... */);

// ❌ Bad: Test Use Case with real adapter
const realAdapter = new AcpAdapter();
const useCase = new SendMessageUseCase(realAdapter, /* ... */);
```

### 2. Keep Tests Fast

- Use mocks instead of real I/O operations
- Avoid unnecessary `setTimeout` or delays
- Use `vi.useFakeTimers()` for time-dependent tests

```typescript
it('should timeout after 5 seconds', () => {
  vi.useFakeTimers();

  const promise = useCase.waitForResponse();

  vi.advanceTimersByTime(5000);

  expect(promise).rejects.toThrow('Timeout');

  vi.useRealTimers();
});
```

### 3. Test Behavior, Not Implementation

```typescript
// ✅ Good: Test observable behavior
it('should send message to agent', async () => {
  await useCase.sendMessage({ message: 'Hello' });
  expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
    expect.any(String),
    'Hello'
  );
});

// ❌ Bad: Test internal state
it('should set internal flag', async () => {
  await useCase.sendMessage({ message: 'Hello' });
  expect(useCase['_internalFlag']).toBe(true);  // Fragile
});
```

### 4. Use Factories for Test Data

```typescript
// Create reusable test data factories
function createMockNote(overrides?: Partial<NoteMetadata>): NoteMetadata {
  return {
    path: 'notes/test.md',
    name: 'test',
    basename: 'test',
    extension: 'md',
    ...overrides,
  };
}

it('should handle note', () => {
  const note = createMockNote({ name: 'Custom Note' });
  // Use note in test
});
```

### 5. Write Tests First (TDD)

When adding new features:
1. Write failing test for desired behavior
2. Implement minimum code to pass test
3. Refactor while keeping tests green
4. Repeat

### 6. Maintain Test Quality

- Review test code as rigorously as production code
- Refactor tests when refactoring production code
- Delete tests for removed features
- Keep test code DRY (Don't Repeat Yourself)

### 7. Document Complex Test Scenarios

```typescript
it('should handle concurrent requests correctly', async () => {
  // Scenario: Two messages sent simultaneously to same session
  // Expected: Both should succeed, order preserved

  const promise1 = useCase.sendMessage({ message: 'First' });
  const promise2 = useCase.sendMessage({ message: 'Second' });

  await Promise.all([promise1, promise2]);

  // Verify order
  const calls = vi.mocked(mockAgentClient.sendMessage).mock.calls;
  expect(calls[0][1]).toBe('First');
  expect(calls[1][1]).toBe('Second');
});
```

---

## Next Steps

### Completed Test Coverage

1. ✅ **Use Cases** (95.92% coverage, 58 tests)
   - SendMessageUseCase, ManageSessionUseCase, HandlePermissionUseCase, SwitchAgentUseCase

2. ✅ **ViewModels** (98.31% coverage, 84 tests)
   - ChatViewModel: All 27 public methods tested with comprehensive coverage

### Planned Test Coverage

1. **Adapters** (currently 0%)
   - VaultAdapter: Obsidian API integration
   - AcpAdapter: Agent communication protocol
   - SettingsStore: Settings persistence
   - ObsidianVaultAdapter: File operations and search

2. **Utilities** (currently 20.54%)
   - mention-utils: Mention detection and conversion
   - chat-exporter: Export chat to markdown
   - path-utils: Path manipulation
   - wsl-utils: WSL integration
   - settings-utils: Settings normalization

### Contributing

When adding tests:
1. Follow the patterns established in existing tests
2. Aim for 90%+ coverage on new code
3. Include both happy path and error cases
4. Document complex test scenarios
5. Run tests locally before committing: `npm test`

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Clean Architecture Testing](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)

---

**Last Updated**: November 2025
**Test Framework**: Vitest 1.6.1
**Overall Coverage**: 50.47% (142 tests)
- **Use Cases**: 95.92% (58 tests)
- **ViewModels**: 98.31% (84 tests)
