import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type UiMcpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse';
  url?: string;
  disabled?: boolean;
};

const CONFIG_DIR = join(homedir(), '.mastyf-ai');
const CONFIG_PATH = join(CONFIG_DIR, 'servers.json');

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function readConfig(): UiMcpServerConfig[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as UiMcpServerConfig[];
  } catch {
    return [];
  }
}

function writeConfig(servers: UiMcpServerConfig[]): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2));
}

export function listUiServers(): UiMcpServerConfig[] {
  return readConfig();
}

export function addUiServer(config: UiMcpServerConfig): { ok: boolean; error?: string } {
  if (!config.name) {
    return { ok: false, error: 'name is required' };
  }
  const transport = config.transport ?? 'stdio';
  if (transport === 'stdio' && !config.command) {
    return { ok: false, error: 'command is required for stdio transport' };
  }
  if (transport !== 'stdio' && !config.url) {
    return { ok: false, error: 'url is required for SSE/streamable HTTP transport' };
  }
  const servers = readConfig();
  if (servers.some((s) => s.name === config.name)) {
    return { ok: false, error: `Server "${config.name}" already exists` };
  }
  servers.push({
    name: config.name,
    command: config.command,
    args: config.args ?? [],
    env: config.env,
    transport: transport as 'stdio' | 'sse',
    url: config.url,
    disabled: config.disabled ?? false,
  });
  writeConfig(servers);
  return { ok: true };
}

export function removeUiServer(name: string): { ok: boolean; error?: string } {
  const servers = readConfig();
  const idx = servers.findIndex((s) => s.name === name);
  if (idx === -1) {
    return { ok: false, error: `Server "${name}" not found` };
  }
  servers.splice(idx, 1);
  writeConfig(servers);
  return { ok: true };
}

export function updateUiServer(name: string, config: Partial<UiMcpServerConfig>): { ok: boolean; error?: string } {
  const servers = readConfig();
  const existing = servers.find((s) => s.name === name);
  if (!existing) {
    return { ok: false, error: `Server "${name}" not found` };
  }
  Object.assign(existing, config);
  writeConfig(servers);
  return { ok: true };
}

/** Generate a full mcpServers-compatible JSON object from UI configs */
export function buildMcpServersConfig(): Record<string, unknown> {
  const ui = readConfig();
  const mcpServers: Record<string, unknown> = {};
  for (const s of ui) {
    if (s.disabled) continue;
    mcpServers[s.name] = {
      command: s.command,
      args: s.args,
      ...(s.env ? { env: s.env } : {}),
    };
  }
  return { mcpServers };
}
