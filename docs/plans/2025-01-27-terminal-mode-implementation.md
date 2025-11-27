# Terminal Mode & Native Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Terminal Mode (xterm.js + Python PTY) and Native Settings panels to the agent-client plugin, enabling full Claude Code CLI access within Obsidian.

**Architecture:** Unified tab interface with three panels (Chat, Terminal, Settings). Terminal uses xterm.js for rendering and a Python helper script for PTY allocation. Settings read/write directly to `~/.claude/` config files.

**Tech Stack:** xterm.js 5.5+, Python 3 (pty module), React 19, TypeScript

**Design Document:** `docs/plans/2025-01-27-terminal-mode-and-native-settings-design.md`

---

## Phase 1: Infrastructure - PTY System

### Task 1.1: PTY Protocol Types

**Files:**
- Create: `src/infrastructure/pty/pty-protocol.ts`

**Step 1: Create the protocol types file**

```typescript
// src/infrastructure/pty/pty-protocol.ts

/**
 * Messages sent from plugin to Python PTY helper.
 */
export type PtyCommand =
  | { type: 'spawn'; cmd: string; args: string[]; cwd: string; env: Record<string, string> }
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' };

/**
 * Messages received from Python PTY helper.
 */
export type PtyEvent =
  | { type: 'spawned'; pid: number }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }
  | { type: 'killed' };

/**
 * Serialize command to JSON line for sending to Python.
 */
export function serializeCommand(cmd: PtyCommand): string {
  return JSON.stringify(cmd) + '\n';
}

/**
 * Parse JSON line from Python into event.
 */
export function parseEvent(line: string): PtyEvent | null {
  try {
    return JSON.parse(line.trim()) as PtyEvent;
  } catch {
    return null;
  }
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/infrastructure/pty/pty-protocol.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/infrastructure/pty/pty-protocol.ts
git commit -m "feat(pty): add protocol types for PTY communication"
```

---

### Task 1.2: Python Detector

**Files:**
- Create: `src/infrastructure/pty/python-detector.ts`

**Step 1: Create the Python detector**

```typescript
// src/infrastructure/pty/python-detector.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import { Platform } from 'obsidian';

const execAsync = promisify(exec);

/**
 * Python detection result.
 */
export interface PythonDetectionResult {
  found: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

/**
 * Candidate paths to search for Python 3.
 */
const PYTHON_CANDIDATES = Platform.isMacOS
  ? [
      '/opt/homebrew/bin/python3',  // Apple Silicon Homebrew
      '/usr/local/bin/python3',      // Intel Homebrew
      '/usr/bin/python3',            // System Python
      'python3',                      // PATH lookup
    ]
  : Platform.isLinux
    ? [
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        'python3',
      ]
    : [
        'python3',
        'python',
        'py -3',
      ];

/**
 * Cache for Python detection result.
 */
let cachedResult: PythonDetectionResult | null = null;

/**
 * Detect Python 3 installation.
 * Results are cached for the session.
 */
export async function detectPython(): Promise<PythonDetectionResult> {
  if (cachedResult) {
    return cachedResult;
  }

  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { stdout } = await execAsync(`${candidate} --version`, {
        timeout: 5000,
      });

      const versionMatch = stdout.match(/Python\s+(3\.\d+\.\d+)/);
      if (versionMatch) {
        cachedResult = {
          found: true,
          path: candidate,
          version: versionMatch[1],
          error: null,
        };
        return cachedResult;
      }
    } catch {
      // Try next candidate
    }
  }

  cachedResult = {
    found: false,
    path: null,
    version: null,
    error: 'Python 3 not found. Please install Python 3.8 or later.',
  };
  return cachedResult;
}

/**
 * Clear the cached detection result.
 * Useful for testing or after user installs Python.
 */
export function clearPythonCache(): void {
  cachedResult = null;
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/infrastructure/pty/python-detector.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/infrastructure/pty/python-detector.ts
git commit -m "feat(pty): add Python 3 detection utility"
```

---

### Task 1.3: Python PTY Helper Script

**Files:**
- Create: `src/infrastructure/pty/pty-helper.py`

**Step 1: Create the Python helper script**

```python
#!/usr/bin/env python3
"""
PTY helper for Obsidian Agent Client plugin.
Allocates pseudo-terminal and bridges to parent process via JSON over stdio.

Protocol:
  Plugin -> Helper (stdin):
    {"type": "spawn", "cmd": "...", "args": [...], "cwd": "...", "env": {...}}
    {"type": "write", "data": "..."}
    {"type": "resize", "cols": N, "rows": N}
    {"type": "kill"}

  Helper -> Plugin (stdout):
    {"type": "spawned", "pid": N}
    {"type": "output", "data": "..."}
    {"type": "exit", "code": N}
    {"type": "error", "message": "..."}
    {"type": "killed"}
"""

import sys
import os
import pty
import select
import signal
import json
import fcntl
import struct
import termios
from typing import Optional, Dict, List, Any


class PtyHelper:
    def __init__(self):
        self.master_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self.running = False

    def spawn(self, cmd: str, args: List[str], cwd: str, env: Dict[str, str]) -> None:
        """Spawn process in PTY."""
        merged_env = {**os.environ, **env}

        self.pid, self.master_fd = pty.fork()

        if self.pid == 0:
            # Child process
            try:
                os.chdir(cwd)
            except OSError:
                pass  # Use current dir if cwd invalid
            os.execvpe(cmd, [cmd] + args, merged_env)
        else:
            # Parent process
            self.running = True
            self._set_nonblocking(self.master_fd)
            self._send({"type": "spawned", "pid": self.pid})

    def resize(self, cols: int, rows: int) -> None:
        """Handle terminal resize."""
        if self.master_fd is not None:
            try:
                winsize = struct.pack('HHHH', rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def write(self, data: str) -> None:
        """Write to PTY stdin."""
        if self.master_fd is not None:
            try:
                os.write(self.master_fd, data.encode('utf-8'))
            except OSError as e:
                self._send({"type": "error", "message": f"Write failed: {e}"})

    def kill(self) -> None:
        """Kill the PTY process."""
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        self.running = False
        self._send({"type": "killed"})

    def run(self) -> None:
        """Main event loop."""
        stdin_fd = sys.stdin.fileno()
        self._set_nonblocking(stdin_fd)

        buffer = ""

        while True:
            fds = [stdin_fd]
            if self.master_fd is not None:
                fds.append(self.master_fd)

            try:
                readable, _, _ = select.select(fds, [], [], 0.05)
            except (select.error, ValueError):
                break

            # Handle input from plugin (JSON commands)
            if stdin_fd in readable:
                try:
                    chunk = os.read(stdin_fd, 4096)
                    if not chunk:
                        break  # EOF - plugin closed
                    buffer += chunk.decode('utf-8', errors='replace')
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        if line.strip():
                            self._handle_command(line)
                except OSError:
                    break

            # Handle output from PTY
            if self.master_fd is not None and self.master_fd in readable:
                try:
                    data = os.read(self.master_fd, 16384)
                    if data:
                        self._send({
                            "type": "output",
                            "data": data.decode('utf-8', errors='replace')
                        })
                    else:
                        self._check_exit()
                except OSError:
                    self._check_exit()

            # Check if child exited (even if no output)
            if self.pid is not None and not self.running:
                break

    def _handle_command(self, line: str) -> None:
        """Process command from plugin."""
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            self._send({"type": "error", "message": f"Invalid JSON: {e}"})
            return

        cmd_type = cmd.get("type")

        if cmd_type == "spawn":
            self.spawn(
                cmd.get("cmd", ""),
                cmd.get("args", []),
                cmd.get("cwd", os.getcwd()),
                cmd.get("env", {})
            )
        elif cmd_type == "write":
            self.write(cmd.get("data", ""))
        elif cmd_type == "resize":
            self.resize(cmd.get("cols", 80), cmd.get("rows", 24))
        elif cmd_type == "kill":
            self.kill()
        else:
            self._send({"type": "error", "message": f"Unknown command: {cmd_type}"})

    def _check_exit(self) -> None:
        """Check if child process has exited."""
        if self.pid is not None:
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
                if pid != 0:
                    if os.WIFEXITED(status):
                        code = os.WEXITSTATUS(status)
                    elif os.WIFSIGNALED(status):
                        code = -os.WTERMSIG(status)
                    else:
                        code = -1
                    self._send({"type": "exit", "code": code})
                    self.running = False
                    self.pid = None
            except ChildProcessError:
                self._send({"type": "exit", "code": -1})
                self.running = False
                self.pid = None

    def _send(self, msg: Dict[str, Any]) -> None:
        """Send JSON message to plugin."""
        try:
            sys.stdout.write(json.dumps(msg) + '\n')
            sys.stdout.flush()
        except (OSError, BrokenPipeError):
            pass

    def _set_nonblocking(self, fd: int) -> None:
        """Set file descriptor to non-blocking mode."""
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def main():
    helper = PtyHelper()
    try:
        helper.run()
    except KeyboardInterrupt:
        helper.kill()
    except Exception as e:
        sys.stderr.write(f"PTY helper error: {e}\n")
        sys.exit(1)


if __name__ == '__main__':
    main()
```

**Step 2: Verify Python syntax**

Run: `python3 -m py_compile /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client/src/infrastructure/pty/pty-helper.py`
Expected: No output (success)

**Step 3: Commit**

```bash
git add src/infrastructure/pty/pty-helper.py
git commit -m "feat(pty): add Python PTY helper script"
```

---

### Task 1.4: PTY Manager

**Files:**
- Create: `src/infrastructure/pty/pty-manager.ts`

**Step 1: Create the PTY manager**

```typescript
// src/infrastructure/pty/pty-manager.ts

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { Platform } from 'obsidian';
import { detectPython } from './python-detector';
import { serializeCommand, parseEvent, PtyCommand, PtyEvent } from './pty-protocol';
import { Logger } from '../../shared/logger';
import type AgentClientPlugin from '../obsidian-plugin/plugin';

export interface PtyManagerOptions {
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onError: (error: string) => void;
}

export type PtyStatus = 'idle' | 'starting' | 'running' | 'error';

/**
 * Manages the Python PTY helper process.
 * Provides methods to spawn commands in a pseudo-terminal.
 */
export class PtyManager {
  private pythonProcess: ChildProcess | null = null;
  private pythonPath: string | null = null;
  private helperPath: string;
  private logger: Logger;
  private options: PtyManagerOptions | null = null;
  private buffer = '';
  private _status: PtyStatus = 'idle';
  private warmUpPromise: Promise<void> | null = null;

  constructor(private plugin: AgentClientPlugin) {
    this.logger = new Logger(plugin);
    // Helper script is bundled alongside main.js
    this.helperPath = path.join(
      (plugin.app.vault.adapter as any).basePath,
      plugin.manifest.dir || '',
      'pty-helper.py'
    );
  }

  get status(): PtyStatus {
    return this._status;
  }

  /**
   * Pre-warm the PTY helper by detecting Python.
   * Call this on plugin load for fast terminal startup.
   */
  async warmUp(): Promise<void> {
    if (this.warmUpPromise) {
      return this.warmUpPromise;
    }

    this.warmUpPromise = (async () => {
      this.logger.log('[PtyManager] Warming up...');
      const result = await detectPython();

      if (result.found && result.path) {
        this.pythonPath = result.path;
        this.logger.log(`[PtyManager] Python found: ${result.path} (${result.version})`);
      } else {
        this.logger.error('[PtyManager] Python not found:', result.error);
      }
    })();

    return this.warmUpPromise;
  }

  /**
   * Check if Python is available.
   */
  async isPythonAvailable(): Promise<boolean> {
    await this.warmUp();
    return this.pythonPath !== null;
  }

  /**
   * Set callbacks for PTY events.
   */
  setOptions(options: PtyManagerOptions): void {
    this.options = options;
  }

  /**
   * Spawn a command in the PTY.
   */
  async spawnCommand(
    cmd: string,
    args: string[] = [],
    cwd: string = process.cwd(),
    env: Record<string, string> = {}
  ): Promise<void> {
    await this.warmUp();

    if (!this.pythonPath) {
      this._status = 'error';
      this.options?.onError('Python 3 is required for Terminal mode');
      return;
    }

    this._status = 'starting';

    // Start Python helper if not running
    if (!this.pythonProcess) {
      await this.startHelper();
    }

    // Send spawn command
    const command: PtyCommand = {
      type: 'spawn',
      cmd,
      args,
      cwd,
      env,
    };

    this.sendCommand(command);
  }

  /**
   * Write data to the PTY stdin.
   */
  write(data: string): void {
    if (this._status !== 'running') {
      this.logger.warn('[PtyManager] Cannot write: PTY not running');
      return;
    }

    this.sendCommand({ type: 'write', data });
  }

  /**
   * Resize the PTY.
   */
  resize(cols: number, rows: number): void {
    if (this.pythonProcess) {
      this.sendCommand({ type: 'resize', cols, rows });
    }
  }

  /**
   * Kill the current PTY process.
   */
  kill(): void {
    if (this.pythonProcess) {
      this.sendCommand({ type: 'kill' });
    }
  }

  /**
   * Dispose of the PTY manager and kill the helper.
   */
  async dispose(): Promise<void> {
    this.logger.log('[PtyManager] Disposing...');

    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');

      // Wait for graceful exit with timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.pythonProcess?.kill('SIGKILL');
          resolve();
        }, 100);

        this.pythonProcess?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.pythonProcess = null;
    }

    this._status = 'idle';
    this.buffer = '';
  }

  private async startHelper(): Promise<void> {
    if (!this.pythonPath) {
      throw new Error('Python not available');
    }

    this.logger.log('[PtyManager] Starting Python helper...');

    this.pythonProcess = spawn(this.pythonPath, [this.helperPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    this.pythonProcess.stdout?.setEncoding('utf8');
    this.pythonProcess.stderr?.setEncoding('utf8');

    this.pythonProcess.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    this.pythonProcess.stderr?.on('data', (data: string) => {
      this.logger.error('[PtyManager] Helper stderr:', data);
    });

    this.pythonProcess.on('error', (error) => {
      this.logger.error('[PtyManager] Helper error:', error);
      this._status = 'error';
      this.options?.onError(`PTY helper error: ${error.message}`);
    });

    this.pythonProcess.on('exit', (code, signal) => {
      this.logger.log(`[PtyManager] Helper exited: code=${code}, signal=${signal}`);
      this.pythonProcess = null;
      this._status = 'idle';
    });
  }

  private sendCommand(cmd: PtyCommand): void {
    if (!this.pythonProcess?.stdin?.writable) {
      this.logger.warn('[PtyManager] Cannot send command: stdin not writable');
      return;
    }

    const serialized = serializeCommand(cmd);
    this.pythonProcess.stdin.write(serialized);
  }

  private processBuffer(): void {
    while (this.buffer.includes('\n')) {
      const newlineIndex = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        this.handleEvent(line);
      }
    }
  }

  private handleEvent(line: string): void {
    const event = parseEvent(line);
    if (!event) {
      this.logger.warn('[PtyManager] Invalid event:', line);
      return;
    }

    switch (event.type) {
      case 'spawned':
        this._status = 'running';
        this.logger.log(`[PtyManager] Process spawned: PID ${event.pid}`);
        break;

      case 'output':
        this.options?.onData(event.data);
        break;

      case 'exit':
        this._status = 'idle';
        this.options?.onExit(event.code);
        break;

      case 'error':
        this.logger.error('[PtyManager] PTY error:', event.message);
        this.options?.onError(event.message);
        break;

      case 'killed':
        this._status = 'idle';
        this.logger.log('[PtyManager] Process killed');
        break;
    }
  }
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/infrastructure/pty/pty-manager.ts`
Expected: No errors

**Step 3: Create index export**

Create `src/infrastructure/pty/index.ts`:

```typescript
// src/infrastructure/pty/index.ts

export { PtyManager, type PtyManagerOptions, type PtyStatus } from './pty-manager';
export { detectPython, clearPythonCache, type PythonDetectionResult } from './python-detector';
export { type PtyCommand, type PtyEvent } from './pty-protocol';
```

**Step 4: Commit**

```bash
git add src/infrastructure/pty/
git commit -m "feat(pty): add PtyManager for terminal process management"
```

---

## Phase 2: Terminal Panel UI

### Task 2.1: Install xterm.js Dependencies

**Step 1: Install packages**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npm install @xterm/xterm@^5.5.0 @xterm/addon-webgl@^0.18.0 @xterm/addon-fit@^0.10.0 @xterm/addon-web-links@^0.11.0`

**Step 2: Verify installation**

Run: `npm ls @xterm/xterm`
Expected: Shows @xterm/xterm@5.5.x

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add xterm.js and addons for terminal rendering"
```

---

### Task 2.2: Terminal Hook

**Files:**
- Create: `src/presentation/hooks/useTerminal.ts`

**Step 1: Create the terminal hook**

```typescript
// src/presentation/hooks/useTerminal.ts

import { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { PtyManager } from '../../infrastructure/pty';

export interface UseTerminalOptions {
  ptyManager: PtyManager;
  isActive: boolean;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
}

export interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  isReady: boolean;
  clear: () => void;
  focus: () => void;
}

/**
 * Hook for managing xterm.js terminal instance.
 */
export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const {
    ptyManager,
    isActive,
    fontSize = 14,
    fontFamily = 'JetBrains Mono, Menlo, Monaco, monospace',
    scrollback = 10000,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const [isReady, setIsReady] = useState(false);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily,
      scrollback,
      smoothScrollDuration: 0,
      fastScrollModifier: 'alt',
      theme: {
        background: 'var(--background-primary)',
        foreground: 'var(--text-normal)',
        cursor: 'var(--text-accent)',
        cursorAccent: 'var(--background-primary)',
        selectionBackground: 'var(--text-selection)',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
    });

    // Load addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Try WebGL, fallback to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (e) {
      console.warn('WebGL addon failed, using canvas renderer:', e);
    }

    // Clickable links
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal
    terminal.open(containerRef.current);
    fitAddon.fit();

    // Handle user input -> PTY
    terminal.onData((data) => {
      ptyManager.write(data);
    });

    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      ptyManager.resize(cols, rows);
    });

    terminalRef.current = terminal;
    setIsReady(true);

    return () => {
      webglAddonRef.current?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      setIsReady(false);
    };
  }, [fontSize, fontFamily, scrollback, ptyManager]);

  // Connect PTY output to terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = terminalRef.current;

    ptyManager.setOptions({
      onData: (data) => {
        terminal.write(data);
      },
      onExit: (code) => {
        terminal.writeln(`\r\n[Process exited with code ${code}]`);
      },
      onError: (error) => {
        terminal.writeln(`\r\n[Error: ${error}]`);
      },
    });
  }, [ptyManager, isReady]);

  // Handle container resize with debounce
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current || !isActive) return;

    const handleResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 50);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Initial fit when becoming active
    fitAddonRef.current.fit();

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [isActive]);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const focus = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  return {
    containerRef,
    isReady,
    clear,
    focus,
  };
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/presentation/hooks/useTerminal.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/presentation/hooks/useTerminal.ts
git commit -m "feat(terminal): add useTerminal hook for xterm.js management"
```

---

### Task 2.3: Terminal Panel Component

**Files:**
- Create: `src/presentation/components/terminal/TerminalPanel.tsx`
- Create: `src/presentation/components/terminal/terminal.css`

**Step 1: Create the terminal CSS**

```css
/* src/presentation/components/terminal/terminal.css */

.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--background-primary);
}

.terminal-panel-container {
  flex: 1;
  overflow: hidden;
  padding: 8px;
}

.terminal-panel-container .xterm {
  height: 100%;
}

.terminal-panel-container .xterm-viewport {
  overflow-y: auto;
}

.terminal-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
}

.terminal-unavailable svg {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  color: var(--text-warning);
}

.terminal-unavailable h3 {
  margin: 0 0 8px 0;
  color: var(--text-normal);
}

.terminal-unavailable p {
  margin: 0 0 16px 0;
  max-width: 300px;
}

.terminal-unavailable a {
  color: var(--text-accent);
}

.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}

.terminal-toolbar-spacer {
  flex: 1;
}

.terminal-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.terminal-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.terminal-status-dot.running {
  background: var(--text-success);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Step 2: Create the terminal panel component**

```typescript
// src/presentation/components/terminal/TerminalPanel.tsx

import * as React from 'react';
const { useState, useEffect, useCallback } from React;
import { setIcon } from 'obsidian';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

import { useTerminal } from '../../hooks/useTerminal';
import type { PtyManager, PtyStatus } from '../../../infrastructure/pty';
import type AgentClientPlugin from '../../../infrastructure/obsidian-plugin/plugin';

export interface TerminalPanelProps {
  plugin: AgentClientPlugin;
  ptyManager: PtyManager;
  isActive: boolean;
  isPythonAvailable: boolean;
  claudePath: string;
  workingDirectory: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  plugin,
  ptyManager,
  isActive,
  isPythonAvailable,
  claudePath,
  workingDirectory,
}) => {
  const [status, setStatus] = useState<PtyStatus>('idle');
  const [hasSpawned, setHasSpawned] = useState(false);

  const { containerRef, isReady, clear, focus } = useTerminal({
    ptyManager,
    isActive,
    fontSize: 14,
    scrollback: 10000,
  });

  // Spawn Claude when terminal is ready and active for the first time
  useEffect(() => {
    if (isReady && isActive && !hasSpawned && isPythonAvailable) {
      setHasSpawned(true);
      ptyManager.spawnCommand(claudePath, [], workingDirectory);
    }
  }, [isReady, isActive, hasSpawned, isPythonAvailable, ptyManager, claudePath, workingDirectory]);

  // Track PTY status
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(ptyManager.status);
    }, 100);
    return () => clearInterval(interval);
  }, [ptyManager]);

  const handleRestart = useCallback(() => {
    ptyManager.kill();
    setTimeout(() => {
      ptyManager.spawnCommand(claudePath, [], workingDirectory);
    }, 100);
  }, [ptyManager, claudePath, workingDirectory]);

  const handleClear = useCallback(() => {
    clear();
  }, [clear]);

  // Show unavailable message if Python not found
  if (!isPythonAvailable) {
    return (
      <div className="terminal-panel">
        <div className="terminal-unavailable">
          <span
            ref={(el) => {
              if (el) setIcon(el, 'alert-triangle');
            }}
          />
          <h3>Python 3 Required</h3>
          <p>
            Terminal mode requires Python 3 to be installed.
            Most macOS systems include Python 3 by default.
          </p>
          <a
            href="https://www.python.org/downloads/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Install Python →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <button
          className="clickable-icon"
          onClick={handleRestart}
          title="Restart Claude"
          ref={(el) => {
            if (el) setIcon(el, 'refresh-cw');
          }}
        />
        <button
          className="clickable-icon"
          onClick={handleClear}
          title="Clear terminal"
          ref={(el) => {
            if (el) setIcon(el, 'trash-2');
          }}
        />
        <div className="terminal-toolbar-spacer" />
        <div className="terminal-status">
          <span className={`terminal-status-dot ${status}`} />
          <span>{status === 'running' ? 'Running' : status === 'starting' ? 'Starting...' : 'Idle'}</span>
        </div>
      </div>
      <div className="terminal-panel-container" ref={containerRef} onClick={focus} />
    </div>
  );
};
```

**Step 3: Create index export**

```typescript
// src/presentation/components/terminal/index.ts

export { TerminalPanel, type TerminalPanelProps } from './TerminalPanel';
```

**Step 4: Verify files compile**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/presentation/components/terminal/TerminalPanel.tsx`
Expected: No errors

**Step 5: Commit**

```bash
git add src/presentation/components/terminal/
git commit -m "feat(terminal): add TerminalPanel component with xterm.js"
```

---

## Phase 3: Tab Bar & View Integration

### Task 3.1: Tab Bar Component

**Files:**
- Create: `src/presentation/components/shared/TabBar.tsx`
- Create: `src/presentation/components/shared/tab-bar.css`

**Step 1: Create tab bar CSS**

```css
/* src/presentation/components/shared/tab-bar.css */

.tab-bar {
  display: flex;
  gap: 0;
  padding: 0;
  background: var(--background-secondary);
  border-bottom: 1px solid var(--background-modifier-border);
}

.tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.tab-button.active {
  color: var(--text-accent);
  border-bottom-color: var(--text-accent);
  background: var(--background-primary);
}

.tab-button svg {
  width: 16px;
  height: 16px;
}

.tab-button .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 4px;
}

.tab-button .status-dot.running {
  background: var(--text-success);
  animation: tab-pulse 2s infinite;
}

.tab-button .status-dot.dirty {
  background: var(--text-warning);
}

@keyframes tab-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Step 2: Create tab bar component**

```typescript
// src/presentation/components/shared/TabBar.tsx

import * as React from 'react';
import { setIcon } from 'obsidian';
import './tab-bar.css';

export type TabId = 'chat' | 'terminal' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { id: 'chat', label: 'Chat', icon: 'message-square', shortcut: 'Mod+1' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', shortcut: 'Mod+2' },
  { id: 'settings', label: 'Settings', icon: 'settings', shortcut: 'Mod+3' },
];

export interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  terminalStatus?: 'idle' | 'running' | 'starting' | 'error';
  settingsDirty?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  terminalStatus = 'idle',
  settingsDirty = false,
}) => {
  return (
    <div className="tab-bar" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          title={`${tab.label} (${tab.shortcut})`}
        >
          <span
            ref={(el) => {
              if (el) setIcon(el, tab.icon);
            }}
          />
          <span>{tab.label}</span>
          {tab.id === 'terminal' && terminalStatus === 'running' && (
            <span className="status-dot running" />
          )}
          {tab.id === 'settings' && settingsDirty && (
            <span className="status-dot dirty" />
          )}
        </button>
      ))}
    </div>
  );
};
```

**Step 3: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/presentation/components/shared/TabBar.tsx`
Expected: No errors

**Step 4: Commit**

```bash
git add src/presentation/components/shared/TabBar.tsx src/presentation/components/shared/tab-bar.css
git commit -m "feat(ui): add TabBar component for view switching"
```

---

### Task 3.2: Update ChatView with Tab Integration

**Files:**
- Modify: `src/presentation/views/chat/ChatView.tsx`

**Step 1: Add imports at top of ChatView.tsx**

Add after existing imports:

```typescript
import { TabBar, type TabId } from '../../components/shared/TabBar';
import { TerminalPanel } from '../../components/terminal';
import { PtyManager } from '../../../infrastructure/pty';
```

**Step 2: Add tab state and PTY manager in ChatComponent**

Add after the existing state declarations (around line 113-121):

```typescript
// Tab state
const [activeTab, setActiveTab] = useState<TabId>('chat');

// PTY Manager for terminal
const ptyManager = useMemo(() => new PtyManager(plugin), [plugin]);
const [isPythonAvailable, setIsPythonAvailable] = useState(false);

// Detect Python on mount
useEffect(() => {
  ptyManager.warmUp().then(() => {
    ptyManager.isPythonAvailable().then(setIsPythonAvailable);
  });

  return () => {
    ptyManager.dispose();
  };
}, [ptyManager]);
```

**Step 3: Update the JSX return in ChatComponent**

Replace the outer container structure with:

```typescript
return (
  <div className="chat-view-container">
    <TabBar
      activeTab={activeTab}
      onTabChange={setActiveTab}
      terminalStatus={ptyManager.status}
      settingsDirty={false}
    />

    {activeTab === 'chat' && (
      <>
        <div className="chat-view-header">
          {/* ... existing header content ... */}
        </div>

        <div ref={messagesContainerRef} className="chat-view-messages">
          {/* ... existing messages content ... */}
        </div>

        <div className="chat-input-container">
          {/* ... existing input content ... */}
        </div>

        {showSessionHistory && sessionHistoryUseCase && (
          <SessionHistoryPanel ... />
        )}
      </>
    )}

    {activeTab === 'terminal' && (
      <TerminalPanel
        plugin={plugin}
        ptyManager={ptyManager}
        isActive={activeTab === 'terminal'}
        isPythonAvailable={isPythonAvailable}
        claudePath={plugin.settings.claude.command || 'claude'}
        workingDirectory={vaultPath}
      />
    )}

    {activeTab === 'settings' && (
      <div className="settings-placeholder">
        <p>Settings panel coming soon...</p>
      </div>
    )}
  </div>
);
```

**Step 4: Add keyboard shortcuts in plugin.ts**

Add after existing command registrations:

```typescript
this.addCommand({
  id: 'switch-to-chat-tab',
  name: 'Switch to Chat tab',
  hotkeys: [{ modifiers: ['Mod'], key: '1' }],
  callback: () => {
    this.app.workspace.trigger('agent-client:switch-tab', 'chat');
  },
});

this.addCommand({
  id: 'switch-to-terminal-tab',
  name: 'Switch to Terminal tab',
  hotkeys: [{ modifiers: ['Mod'], key: '2' }],
  callback: () => {
    this.app.workspace.trigger('agent-client:switch-tab', 'terminal');
  },
});

this.addCommand({
  id: 'switch-to-settings-tab',
  name: 'Switch to Settings tab',
  hotkeys: [{ modifiers: ['Mod'], key: '3' }],
  callback: () => {
    this.app.workspace.trigger('agent-client:switch-tab', 'settings');
  },
});
```

**Step 5: Build and verify**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npm run build`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add src/presentation/views/chat/ChatView.tsx src/infrastructure/obsidian-plugin/plugin.ts
git commit -m "feat: integrate tab bar and terminal panel into ChatView"
```

---

## Phase 4: Claude Config Service

### Task 4.1: Config Types

**Files:**
- Create: `src/adapters/claude-config/claude-config.types.ts`

**Step 1: Create the config types**

```typescript
// src/adapters/claude-config/claude-config.types.ts

/**
 * Claude Code model options.
 */
export type ClaudeModel = 'claude-sonnet-4-5-20250929' | 'claude-opus-4-5-20251101' | 'claude-3-5-haiku-20241022';

/**
 * Theme options.
 */
export type ClaudeTheme = 'dark' | 'light' | 'system';

/**
 * MCP server configuration.
 */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Tool permission settings.
 */
export interface ToolPermissions {
  allowedTools: string[];
  deniedTools: string[];
  autoApprove: boolean;
}

/**
 * Memory/context settings.
 */
export interface MemorySettings {
  enabled: boolean;
}

/**
 * Complete Claude Code settings.
 */
export interface ClaudeSettings {
  model: ClaudeModel;
  theme: ClaudeTheme;
  customInstructions: string;
  permissions: ToolPermissions;
  memory: MemorySettings;
  mcpServers: McpServerConfig[];
}

/**
 * Default settings values.
 */
export const DEFAULT_CLAUDE_SETTINGS: ClaudeSettings = {
  model: 'claude-sonnet-4-5-20250929',
  theme: 'system',
  customInstructions: '',
  permissions: {
    allowedTools: [],
    deniedTools: [],
    autoApprove: false,
  },
  memory: {
    enabled: true,
  },
  mcpServers: [],
};

/**
 * Claude config file paths relative to ~/.claude/
 */
export const CONFIG_FILES = {
  settings: 'settings.json',
  settingsLocal: 'settings.local.json',
  mcpServers: 'mcp_servers.json',
} as const;
```

**Step 2: Verify file compiles**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/adapters/claude-config/claude-config.types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/adapters/claude-config/claude-config.types.ts
git commit -m "feat(config): add Claude config type definitions"
```

---

### Task 4.2: Config Service

**Files:**
- Create: `src/adapters/claude-config/claude-config.service.ts`

**Step 1: Create the config service**

```typescript
// src/adapters/claude-config/claude-config.service.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ClaudeSettings,
  McpServerConfig,
  DEFAULT_CLAUDE_SETTINGS,
  CONFIG_FILES,
} from './claude-config.types';
import { Logger } from '../../shared/logger';
import type AgentClientPlugin from '../../infrastructure/obsidian-plugin/plugin';

type SettingsListener = (settings: ClaudeSettings) => void;

/**
 * Service for reading and writing Claude Code configuration files.
 */
export class ClaudeConfigService {
  private configDir: string;
  private logger: Logger;
  private listeners: Set<SettingsListener> = new Set();
  private watcher: fs.FSWatcher | null = null;
  private cachedSettings: ClaudeSettings | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(plugin: AgentClientPlugin) {
    this.logger = new Logger(plugin);
    this.configDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Get the current Claude settings.
   */
  async getSettings(): Promise<ClaudeSettings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const settings = { ...DEFAULT_CLAUDE_SETTINGS };

    // Read main settings
    const mainSettings = await this.readJsonFile<Partial<ClaudeSettings>>(
      CONFIG_FILES.settings
    );
    if (mainSettings) {
      Object.assign(settings, mainSettings);
    }

    // Read local overrides
    const localSettings = await this.readJsonFile<Partial<ClaudeSettings>>(
      CONFIG_FILES.settingsLocal
    );
    if (localSettings) {
      Object.assign(settings, localSettings);
    }

    // Read MCP servers
    const mcpServers = await this.readJsonFile<{ mcpServers?: McpServerConfig[] }>(
      CONFIG_FILES.mcpServers
    );
    if (mcpServers?.mcpServers) {
      settings.mcpServers = mcpServers.mcpServers;
    }

    this.cachedSettings = settings;
    return settings;
  }

  /**
   * Update Claude settings.
   */
  async updateSettings(updates: Partial<ClaudeSettings>): Promise<void> {
    // Read current settings
    const current = await this.getSettings();
    const merged = { ...current, ...updates };

    // Separate MCP servers (stored in separate file)
    const { mcpServers, ...mainSettings } = merged;

    // Write main settings
    await this.writeJsonFile(CONFIG_FILES.settings, mainSettings);

    // Write MCP servers if changed
    if (updates.mcpServers !== undefined) {
      await this.writeJsonFile(CONFIG_FILES.mcpServers, { mcpServers });
    }

    // Update cache
    this.cachedSettings = merged;

    // Notify listeners
    this.notifyListeners(merged);
  }

  /**
   * Add an MCP server.
   */
  async addMcpServer(config: McpServerConfig): Promise<void> {
    const settings = await this.getSettings();
    const existing = settings.mcpServers.findIndex((s) => s.name === config.name);

    if (existing >= 0) {
      settings.mcpServers[existing] = config;
    } else {
      settings.mcpServers.push(config);
    }

    await this.updateSettings({ mcpServers: settings.mcpServers });
  }

  /**
   * Remove an MCP server.
   */
  async removeMcpServer(name: string): Promise<void> {
    const settings = await this.getSettings();
    const filtered = settings.mcpServers.filter((s) => s.name !== name);
    await this.updateSettings({ mcpServers: filtered });
  }

  /**
   * Subscribe to settings changes.
   */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);

    // Start watching if first listener
    if (this.listeners.size === 1) {
      this.startWatching();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopWatching();
      }
    };
  }

  /**
   * Clear the settings cache.
   */
  clearCache(): void {
    this.cachedSettings = null;
  }

  /**
   * Dispose of the service.
   */
  dispose(): void {
    this.stopWatching();
    this.listeners.clear();
    this.cachedSettings = null;
  }

  private async readJsonFile<T>(filename: string): Promise<T | null> {
    const filePath = path.join(this.configDir, filename);

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error(`[ClaudeConfigService] Failed to read ${filename}:`, error);
      }
      return null;
    }
  }

  private async writeJsonFile(filename: string, data: unknown): Promise<void> {
    const filePath = path.join(this.configDir, filename);

    // Ensure directory exists
    await fs.promises.mkdir(this.configDir, { recursive: true });

    // Write atomically (write to temp, then rename)
    const tempPath = `${filePath}.tmp`;
    const content = JSON.stringify(data, null, 2);

    await fs.promises.writeFile(tempPath, content, 'utf8');
    await fs.promises.rename(tempPath, filePath);

    this.logger.log(`[ClaudeConfigService] Wrote ${filename}`);
  }

  private startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = fs.watch(this.configDir, (eventType, filename) => {
        if (filename && Object.values(CONFIG_FILES).includes(filename as any)) {
          this.handleFileChange();
        }
      });
    } catch (error) {
      this.logger.error('[ClaudeConfigService] Failed to start watching:', error);
    }
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  private handleFileChange(): void {
    // Debounce to avoid multiple rapid updates
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(async () => {
      this.cachedSettings = null;
      const settings = await this.getSettings();
      this.notifyListeners(settings);
    }, 100);
  }

  private notifyListeners(settings: ClaudeSettings): void {
    for (const listener of this.listeners) {
      try {
        listener(settings);
      } catch (error) {
        this.logger.error('[ClaudeConfigService] Listener error:', error);
      }
    }
  }
}
```

**Step 2: Create index export**

```typescript
// src/adapters/claude-config/index.ts

export { ClaudeConfigService } from './claude-config.service';
export {
  type ClaudeSettings,
  type McpServerConfig,
  type ToolPermissions,
  type ClaudeModel,
  type ClaudeTheme,
  DEFAULT_CLAUDE_SETTINGS,
} from './claude-config.types';
```

**Step 3: Verify files compile**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/adapters/claude-config/claude-config.service.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add src/adapters/claude-config/
git commit -m "feat(config): add ClaudeConfigService for reading/writing Claude settings"
```

---

## Phase 5: Settings Panel UI

### Task 5.1: Settings Panel Component

**Files:**
- Create: `src/presentation/components/settings/SettingsPanel.tsx`
- Create: `src/presentation/components/settings/settings-panel.css`

**Step 1: Create settings panel CSS**

```css
/* src/presentation/components/settings/settings-panel.css */

.settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin: 0 0 12px 0;
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.settings-row label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-normal);
}

.settings-row-description {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.settings-model-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-model-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.settings-model-option:hover {
  border-color: var(--text-accent);
}

.settings-model-option.selected {
  border-color: var(--text-accent);
  background: var(--background-secondary);
}

.settings-model-option input {
  margin: 0;
}

.settings-textarea {
  width: 100%;
  min-height: 100px;
  padding: 8px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.settings-textarea:focus {
  outline: none;
  border-color: var(--text-accent);
}

.settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.settings-toggle-row label {
  flex: 1;
}

.settings-mcp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-mcp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
}

.settings-mcp-item-info {
  flex: 1;
}

.settings-mcp-item-name {
  font-weight: 500;
}

.settings-mcp-item-command {
  font-size: 12px;
  color: var(--text-muted);
  font-family: monospace;
}

.settings-mcp-item-actions {
  display: flex;
  gap: 4px;
}

.settings-add-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px dashed var(--background-modifier-border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 100%;
  justify-content: center;
}

.settings-add-button:hover {
  border-color: var(--text-accent);
  color: var(--text-accent);
}

.settings-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--background-modifier-border);
  margin-top: auto;
}

.settings-footer button {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.settings-save-button {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border: none;
}

.settings-save-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-reset-button {
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  color: var(--text-muted);
}

.settings-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}
```

**Step 2: Create settings panel component**

```typescript
// src/presentation/components/settings/SettingsPanel.tsx

import * as React from 'react';
const { useState, useEffect, useCallback } = React;
import { setIcon, Notice } from 'obsidian';
import './settings-panel.css';

import {
  ClaudeConfigService,
  type ClaudeSettings,
  type ClaudeModel,
  type McpServerConfig,
  DEFAULT_CLAUDE_SETTINGS,
} from '../../../adapters/claude-config';
import type AgentClientPlugin from '../../../infrastructure/obsidian-plugin/plugin';

export interface SettingsPanelProps {
  plugin: AgentClientPlugin;
  configService: ClaudeConfigService;
  onDirtyChange: (dirty: boolean) => void;
}

const MODEL_OPTIONS: { id: ClaudeModel; label: string; description: string }[] = [
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', description: 'Most capable' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4', description: 'Balanced' },
  { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5', description: 'Fastest' },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  plugin,
  configService,
  onDirtyChange,
}) => {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [originalSettings, setOriginalSettings] = useState<ClaudeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loaded = await configService.getSettings();
        setSettings(loaded);
        setOriginalSettings(loaded);
      } catch (error) {
        new Notice('Failed to load Claude settings');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();

    // Subscribe to external changes
    const unsubscribe = configService.subscribe((newSettings) => {
      setSettings(newSettings);
      setOriginalSettings(newSettings);
    });

    return unsubscribe;
  }, [configService]);

  // Track dirty state
  useEffect(() => {
    if (!settings || !originalSettings) {
      onDirtyChange(false);
      return;
    }

    const isDirty = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    onDirtyChange(isDirty);
  }, [settings, originalSettings, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!settings) return;

    setIsSaving(true);
    try {
      await configService.updateSettings(settings);
      setOriginalSettings(settings);
      new Notice('Settings saved');
    } catch (error) {
      new Notice('Failed to save settings');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  }, [settings, configService]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULT_CLAUDE_SETTINGS);
  }, []);

  const updateSetting = useCallback(<K extends keyof ClaudeSettings>(
    key: K,
    value: ClaudeSettings[K]
  ) => {
    setSettings((prev) => prev ? { ...prev, [key]: value } : null);
  }, []);

  const removeMcpServer = useCallback((name: string) => {
    setSettings((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        mcpServers: prev.mcpServers.filter((s) => s.name !== name),
      };
    });
  }, []);

  if (isLoading) {
    return (
      <div className="settings-panel settings-loading">
        Loading settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="settings-panel settings-loading">
        Failed to load settings
      </div>
    );
  }

  const isDirty = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  return (
    <div className="settings-panel">
      {/* Model Selection */}
      <div className="settings-section">
        <h3 className="settings-section-title">Model</h3>
        <div className="settings-model-options">
          {MODEL_OPTIONS.map((option) => (
            <label
              key={option.id}
              className={`settings-model-option ${settings.model === option.id ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="model"
                value={option.id}
                checked={settings.model === option.id}
                onChange={() => updateSetting('model', option.id)}
              />
              <div>
                <div>{option.label}</div>
                <div className="settings-row-description">{option.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Permissions */}
      <div className="settings-section">
        <h3 className="settings-section-title">Permissions</h3>
        <div className="settings-toggle-row">
          <label>
            Auto-approve safe tools
            <div className="settings-row-description">
              Automatically allow Read, Glob, Grep, and similar tools
            </div>
          </label>
          <input
            type="checkbox"
            checked={settings.permissions.autoApprove}
            onChange={(e) =>
              updateSetting('permissions', {
                ...settings.permissions,
                autoApprove: e.target.checked,
              })
            }
          />
        </div>
      </div>

      {/* Custom Instructions */}
      <div className="settings-section">
        <h3 className="settings-section-title">Custom Instructions</h3>
        <div className="settings-row">
          <textarea
            className="settings-textarea"
            value={settings.customInstructions}
            onChange={(e) => updateSetting('customInstructions', e.target.value)}
            placeholder="Add custom instructions for Claude..."
          />
        </div>
      </div>

      {/* MCP Servers */}
      <div className="settings-section">
        <h3 className="settings-section-title">MCP Servers</h3>
        <div className="settings-mcp-list">
          {settings.mcpServers.map((server) => (
            <div key={server.name} className="settings-mcp-item">
              <div className="settings-mcp-item-info">
                <div className="settings-mcp-item-name">{server.name}</div>
                <div className="settings-mcp-item-command">{server.command}</div>
              </div>
              <div className="settings-mcp-item-actions">
                <button
                  className="clickable-icon"
                  onClick={() => removeMcpServer(server.name)}
                  title="Remove server"
                  ref={(el) => {
                    if (el) setIcon(el, 'trash-2');
                  }}
                />
              </div>
            </div>
          ))}
          <button className="settings-add-button">
            <span
              ref={(el) => {
                if (el) setIcon(el, 'plus');
              }}
            />
            Add MCP Server
          </button>
        </div>
      </div>

      {/* Memory */}
      <div className="settings-section">
        <h3 className="settings-section-title">Memory</h3>
        <div className="settings-toggle-row">
          <label>
            Enable memory
            <div className="settings-row-description">
              Allow Claude to remember context across sessions
            </div>
          </label>
          <input
            type="checkbox"
            checked={settings.memory.enabled}
            onChange={(e) =>
              updateSetting('memory', {
                ...settings.memory,
                enabled: e.target.checked,
              })
            }
          />
        </div>
      </div>

      {/* Footer */}
      <div className="settings-footer">
        <button className="settings-reset-button" onClick={handleReset}>
          Reset to Defaults
        </button>
        <button
          className="settings-save-button"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};
```

**Step 3: Create index export**

```typescript
// src/presentation/components/settings/index.ts

export { SettingsPanel, type SettingsPanelProps } from './SettingsPanel';
```

**Step 4: Verify files compile**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npx tsc --noEmit src/presentation/components/settings/SettingsPanel.tsx`
Expected: No errors

**Step 5: Commit**

```bash
git add src/presentation/components/settings/
git commit -m "feat(settings): add SettingsPanel component for Claude configuration"
```

---

### Task 5.2: Integrate Settings Panel into ChatView

**Files:**
- Modify: `src/presentation/views/chat/ChatView.tsx`

**Step 1: Add imports**

Add after existing imports:

```typescript
import { SettingsPanel } from '../../components/settings';
import { ClaudeConfigService } from '../../../adapters/claude-config';
```

**Step 2: Add config service and settings state**

Add after PTY manager creation:

```typescript
// Claude config service
const claudeConfigService = useMemo(() => new ClaudeConfigService(plugin), [plugin]);
const [settingsDirty, setSettingsDirty] = useState(false);

// Cleanup config service on unmount
useEffect(() => {
  return () => {
    claudeConfigService.dispose();
  };
}, [claudeConfigService]);
```

**Step 3: Update TabBar props**

```typescript
<TabBar
  activeTab={activeTab}
  onTabChange={setActiveTab}
  terminalStatus={ptyManager.status}
  settingsDirty={settingsDirty}
/>
```

**Step 4: Replace settings placeholder**

Replace the settings placeholder div with:

```typescript
{activeTab === 'settings' && (
  <SettingsPanel
    plugin={plugin}
    configService={claudeConfigService}
    onDirtyChange={setSettingsDirty}
  />
)}
```

**Step 5: Build and verify**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/presentation/views/chat/ChatView.tsx
git commit -m "feat: integrate SettingsPanel into ChatView"
```

---

## Phase 6: Bundle Python Helper & Final Integration

### Task 6.1: Update esbuild Config

**Files:**
- Modify: `esbuild.config.mjs`

**Step 1: Add file copy for Python helper**

Add at the end of the build config, before the final build call:

```javascript
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Copy pty-helper.py to dist
const srcHelper = 'src/infrastructure/pty/pty-helper.py';
const destHelper = 'pty-helper.py';

if (existsSync(srcHelper)) {
  copyFileSync(srcHelper, destHelper);
  console.log('Copied pty-helper.py');
}
```

**Step 2: Build and verify**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npm run build && ls -la pty-helper.py`
Expected: Build succeeds and pty-helper.py exists in root

**Step 3: Update .gitignore if needed**

Ensure `pty-helper.py` at root is NOT ignored (it needs to be distributed).

**Step 4: Commit**

```bash
git add esbuild.config.mjs pty-helper.py
git commit -m "build: bundle pty-helper.py with plugin"
```

---

### Task 6.2: Add xterm.js CSS Import

**Files:**
- Modify: `styles.css`

**Step 1: Import xterm.js styles**

Add at the top of styles.css:

```css
/* xterm.js styles are imported in TerminalPanel.tsx */
/* Additional terminal overrides below */

.terminal-panel .xterm {
  padding: 4px;
}

.terminal-panel .xterm-viewport::-webkit-scrollbar {
  width: 8px;
}

.terminal-panel .xterm-viewport::-webkit-scrollbar-thumb {
  background: var(--background-modifier-border);
  border-radius: 4px;
}
```

**Step 2: Commit**

```bash
git add styles.css
git commit -m "style: add xterm.js style overrides"
```

---

### Task 6.3: Final Build and Test

**Step 1: Full build**

Run: `cd /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client && npm run build`
Expected: Build succeeds with no errors

**Step 2: Verify bundle contents**

Run: `ls -la /Users/caio.niehues/Developer/Obsidian/second-brain/.obsidian/plugins/agent-client/`
Expected: main.js, manifest.json, styles.css, pty-helper.py all present

**Step 3: Manual testing checklist**

1. [ ] Reload Obsidian
2. [ ] Open agent client panel
3. [ ] Verify Tab bar shows Chat, Terminal, Settings
4. [ ] Switch to Terminal tab
5. [ ] If Python available, Claude should start
6. [ ] Type a message in terminal, verify response
7. [ ] Switch to Settings tab
8. [ ] Change model selection
9. [ ] Click Save Changes
10. [ ] Verify settings saved to ~/.claude/settings.json

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Terminal Mode and Native Settings implementation

- Add Terminal tab with xterm.js and Python PTY helper
- Add Settings tab with Claude config management
- GPU-accelerated terminal rendering
- Direct read/write of ~/.claude/ config files
- Keyboard shortcuts for tab switching (Mod+1/2/3)"
```

---

## Summary

**Total Tasks:** 18 tasks across 6 phases

**New Files Created:**
- `src/infrastructure/pty/pty-protocol.ts`
- `src/infrastructure/pty/python-detector.ts`
- `src/infrastructure/pty/pty-helper.py`
- `src/infrastructure/pty/pty-manager.ts`
- `src/infrastructure/pty/index.ts`
- `src/presentation/hooks/useTerminal.ts`
- `src/presentation/components/terminal/TerminalPanel.tsx`
- `src/presentation/components/terminal/terminal.css`
- `src/presentation/components/terminal/index.ts`
- `src/presentation/components/shared/TabBar.tsx`
- `src/presentation/components/shared/tab-bar.css`
- `src/adapters/claude-config/claude-config.types.ts`
- `src/adapters/claude-config/claude-config.service.ts`
- `src/adapters/claude-config/index.ts`
- `src/presentation/components/settings/SettingsPanel.tsx`
- `src/presentation/components/settings/settings-panel.css`
- `src/presentation/components/settings/index.ts`

**Files Modified:**
- `package.json` (new dependencies)
- `src/presentation/views/chat/ChatView.tsx`
- `src/infrastructure/obsidian-plugin/plugin.ts`
- `esbuild.config.mjs`
- `styles.css`

**Dependencies Added:**
- @xterm/xterm ^5.5.0
- @xterm/addon-webgl ^0.18.0
- @xterm/addon-fit ^0.10.0
- @xterm/addon-web-links ^0.11.0
