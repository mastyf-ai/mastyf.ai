/**
 * Whether Shield counts an MCP server as routed through it. A line-for-line port of the functions of
 * the same names in Shield 0.5.2's agent-auto-discovery.cjs, so the editor and Shield's window always
 * agree. `readFile` stands in for the file system so the logic can be tested on its own.
 */

export type RoutingState = 'routed' | 'fixable' | 'url';

type Entry = {
  command?: unknown;
  args?: unknown;
  url?: unknown;
  serverUrl?: unknown;
  _mastyf?: { managed?: unknown; version?: unknown; original_command?: unknown } | null;
};

const asEntry = (server: unknown): Entry | null =>
  server && typeof server === 'object' ? (server as Entry) : null;

/** A settings file's servers: `mcpServers` (most agents) or `servers` (VS Code). */
export function extractServers(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    const r = raw as { mcpServers?: unknown; servers?: unknown };
    if (r.mcpServers && typeof r.mcpServers === 'object') return r.mcpServers as Record<string, unknown>;
    if (r.servers && typeof r.servers === 'object') return r.servers as Record<string, unknown>;
  }
  return {};
}

export function isServerProtected(server: unknown): boolean {
  const s = asEntry(server);
  if (!s) return false;

  // 1. Explicit Mastyf marker check
  if (s._mastyf && s._mastyf.managed === true) return true;

  // 2. Command check
  const cmd = String(s.command || '').trim().toLowerCase();
  const args = Array.isArray(s.args) ? s.args.map((a) => String(a).trim().toLowerCase()) : [];

  if (cmd === 'mastyf' && args[0] === 'proxy') return true;
  if (cmd.includes('mastyf-ai-proxy') || cmd.includes('mastyf_ai_proxy')) return true;
  if (args.includes('proxy') && (args.includes('--policy') || args.includes('-p'))) return true;

  return false;
}

/** Entries from before version 2 ran a command that does not exist, so Shield rebuilds them. */
export function isOutdatedEntry(server: unknown): boolean {
  const m = asEntry(server)?._mastyf;
  return m?.managed === true && (Number(m.version) || 1) < 2 && Boolean(m.original_command);
}

/** The server a free `mastyf connect` entry stands in front of, or null when it isn't one. */
export function upstreamFromFreeConnect(
  server: unknown,
  name: string,
  readFile: (p: string) => string,
): object | null {
  const s = asEntry(server);
  if (!s || s._mastyf || !Array.isArray(s.args) || !s.args.includes('proxy')) return null;
  const at = s.args.indexOf('--config');
  if (at === -1) return null;
  try {
    const upstream = JSON.parse(readFile(String(s.args[at + 1]))).mcpServers[name];
    return upstream && upstream.command ? upstream : null;
  } catch {
    return null;
  }
}

/** The URL of a server reached over the network (Windsurf calls it serverUrl), or null for a local one. */
export function remoteUrlOf(server: unknown): string | null {
  const s = asEntry(server);
  if (!s || s.command) return null;
  const url = typeof s.url === 'string' ? s.url : typeof s.serverUrl === 'string' ? s.serverUrl : '';
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export function routingState(server: unknown, name: string, readFile: (p: string) => string): RoutingState {
  if (remoteUrlOf(server)) return 'url';
  return isServerProtected(server) && !isOutdatedEntry(server) && !upstreamFromFreeConnect(server, name, readFile)
    ? 'routed'
    : 'fixable';
}
