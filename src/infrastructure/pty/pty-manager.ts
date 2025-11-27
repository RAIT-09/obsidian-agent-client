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
