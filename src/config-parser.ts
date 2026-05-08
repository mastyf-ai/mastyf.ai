import fs from 'fs';
import path from 'path';
import os from 'os';
import { McpServerConfig } from './types.js';

/**
 * Parses MCP configuration files from various clients:
 * - Cline (cline_mcp_settings.json)
 * - Claude Desktop (claude_desktop_config.json)
 * - Cursor (mcp.json)
 * - Generic JSON with "mcpServers" or "servers" keys
 */
export class ConfigParser {
  /**
   * Find all known MCP config files on the system.
   */
  static findConfigPaths(): string[] {
    const home = os.homedir();
    const candidates = [
      // Cline — VS Code
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      // Cline — VS Code Insiders
      path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      // Claude Desktop
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      // Cursor
      path.join(home, '.cursor', 'mcp.json'),
      // Windsurf
      path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    ];

    return candidates.filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
  }

  /**
   * Parse a single MCP config file into an array of server configs.
   */
  static parse(filePath: string): McpServerConfig[] {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Normalize different schemas
    let servers: Record<string, unknown>;
    if (raw.mcpServers && typeof raw.mcpServers === 'object') {
      servers = raw.mcpServers as Record<string, unknown>;
    } else if (raw.servers && typeof raw.servers === 'object') {
      servers = raw.servers as Record<string, unknown>;
    } else {
      // Assume the file itself is a flat map of server name → config
      servers = raw as Record<string, unknown>;
    }

    return Object.entries(servers).map(([name, config]) => {
      const cfg = config as Record<string, unknown>;
      return {
        name,
        command: typeof cfg.command === 'string' ? cfg.command : undefined,
        args: Array.isArray(cfg.args) ? cfg.args as string[] : undefined,
        env: cfg.env && typeof cfg.env === 'object' ? cfg.env as Record<string, string> : undefined,
        url: typeof cfg.url === 'string' ? cfg.url : undefined,
        transport: (cfg.transport === 'sse' ? 'sse' : 'stdio') as 'stdio' | 'sse',
        packageName: typeof cfg.packageName === 'string' ? cfg.packageName : undefined,
        version: typeof cfg.version === 'string' ? cfg.version : undefined,
      };
    });
  }

  /**
   * Parse all discoverable configs and flatten into a single list.
   */
  static parseAll(): McpServerConfig[] {
    const paths = ConfigParser.findConfigPaths();
    if (paths.length === 0) return [];
    const allServers: McpServerConfig[] = [];
    for (const p of paths) {
      try {
        allServers.push(...ConfigParser.parse(p));
      } catch {
        // Skip unparseable files
      }
    }
    return allServers;
  }
}