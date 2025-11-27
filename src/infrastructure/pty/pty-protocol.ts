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
