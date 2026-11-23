/**
 * Read-only inventory of the AI agents on this machine and the MCP servers each one runs.
 *
 * The same client list the Shield desktop app protects (apps/mastyf-shield-desktop/
 * agent-auto-discovery.cjs) plus the paths McpConfigFinder already knew and Claude Code's
 * ~/.claude.json. Nothing is written. Only names leave this module: never a server's command
 * arguments or environment, which routinely hold tokens.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface InventoryServer {
  name: string;
  transport: 'stdio' | 'http';
  /** Already routed through a Mastyf proxy, so its calls are checked today. */
  protected: boolean;
}

export interface InventoryAgent {
  id: string;
  name: string;
  configPath: string;
  servers: InventoryServer[];
}

export interface AgentInventory {
  scannedAt: string;
  agents: InventoryAgent[];
  totals: { agents: number; servers: number; protectedServers: number };
}

type ClientDef = { id: string; name: string; paths: string[] };

function clientDefs(): ClientDef[] {
  const home = os.homedir();
  const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      paths: [path.join(home, '.claude.json')],
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      paths: [
        path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
        path.join(appData, 'Claude', 'claude_desktop_config.json'),
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      paths: [
        path.join(home, '.cursor', 'mcp.json'),
        path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json'),
        path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json'),
        path.join(appData, 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json'),
      ],
    },
    {
      id: 'vscode',
      name: 'VS Code',
      paths: [
        path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
        path.join(home, '.config', 'Code', 'User', 'mcp.json'),
        path.join(appData, 'Code', 'User', 'mcp.json'),
      ],
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      paths: [
        path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        path.join(home, '.config', 'windsurf', 'mcp_config.json'),
        path.join(home, '.windsurf', 'mcp.json'),
      ],
    },
    {
      id: 'cline',
      name: 'Cline',
      paths: [
        path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
        path.join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
        path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
        path.join(home, '.config', 'cline', 'mcp_config.json'),
      ],
    },
  ];
}

/** Same rule the Shield app uses to tell whether a server already runs behind Mastyf. */
export function isServerProtected(server: Record<string, unknown>): boolean {
  const marker = server['_mastyf'] as { managed?: boolean } | undefined;
  if (marker?.managed === true) return true;
  const cmd = String(server['command'] ?? '').trim().toLowerCase();
  const args = Array.isArray(server['args']) ? (server['args'] as unknown[]).map((a) => String(a).trim().toLowerCase()) : [];
  if ((cmd === 'mastyf' || cmd === 'mastyf-ai') && args[0] === 'proxy') return true;
  if (cmd.includes('mastyf-ai-proxy') || cmd.includes('mastyf_ai_proxy')) return true;
  if (args.some((a) => a.includes('mastyf')) && args.includes('proxy')) return true;
  if (args.includes('proxy') && (args.includes('--policy') || args.includes('-p'))) return true;
  return false;
}

function serversFrom(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const block = (obj['mcpServers'] ?? obj['servers']) as unknown;
  return block && typeof block === 'object' ? (block as Record<string, Record<string, unknown>>) : {};
}

function readServers(configPath: string): InventoryServer[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
  const out: InventoryServer[] = [];
  for (const [name, cfg] of Object.entries(serversFrom(parsed))) {
    if (!cfg || typeof cfg !== 'object') continue;
    const isHttp = typeof cfg['url'] === 'string' || cfg['type'] === 'http' || cfg['type'] === 'sse';
    out.push({ name, transport: isHttp ? 'http' : 'stdio', protected: isServerProtected(cfg) });
  }
  return out;
}

export function scanAgentInventory(): AgentInventory {
  const agents: InventoryAgent[] = [];
  for (const def of clientDefs()) {
    const configPath = def.paths.find((p) => fs.existsSync(p));
    if (!configPath) continue;
    const servers = readServers(configPath);
    if (servers === null) continue;
    agents.push({ id: def.id, name: def.name, configPath, servers });
  }
  const servers = agents.reduce((n, a) => n + a.servers.length, 0);
  const protectedServers = agents.reduce((n, a) => n + a.servers.filter((s) => s.protected).length, 0);
  return {
    scannedAt: new Date().toISOString(),
    agents,
    totals: { agents: agents.length, servers, protectedServers },
  };
}
