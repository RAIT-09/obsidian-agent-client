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
        if (filename && Object.values(CONFIG_FILES).includes(filename as typeof CONFIG_FILES[keyof typeof CONFIG_FILES])) {
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
