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
