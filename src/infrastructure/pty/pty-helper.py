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
