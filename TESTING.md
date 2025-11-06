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

- **Use Cases**: 95.92% coverage (58 tests)
  - `SendMessageUseCase`: 15 tests
  - `ManageSessionUseCase`: 15 tests
  - `HandlePermissionUseCase`: 16 tests
  - `SwitchAgentUseCase`: 12 tests

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

- **Use Cases**: Target 90%+ (currently 95.92%)
- **Adapters**: Target 80%+
- **ViewModels**: Target 85%+
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
All files          |   26.64 |    80.14 |    55.1 |   26.64 |
 core/use-cases    |   95.92 |     85.6 |     100 |   95.92 |
  ...n.use-case.ts |     100 |    91.66 |     100 |     100 | 86,111
  ...n.use-case.ts |     100 |    96.96 |     100 |     100 | 220
  ...e.use-case.ts |   91.99 |    76.36 |     100 |   91.99 | ...89-506,572-579
  ...t.use-case.ts |     100 |    84.61 |     100 |     100 | 70-74
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

### Planned Test Coverage

1. **Adapters** (currently 0%)
   - VaultAdapter: Obsidian API integration
   - AcpAdapter: Agent communication protocol
   - SettingsStore: Settings persistence

2. **ViewModels** (currently 0%)
   - ChatViewModel: UI state management

3. **Utilities** (currently 20.54%)
   - chat-exporter: Export chat to markdown
   - path-utils: Path manipulation
   - wsl-utils: WSL integration

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
**Coverage**: 95.92% (Use Cases)
