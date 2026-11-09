/** One-step setup: route every agent's MCP servers through the proxy, and undo it cleanly. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildWrappedMcpServerEntry } from '../utils/windows-paths.js';
import { extractServers, runWrap, setServers } from '../wrap/client-wrap.js';
import { findAgents } from './agents.js';

type ServerMap = Record<string, Record<string, unknown>>;

interface ConnectedAgent {
  id: string;
  configPath: string;
  originals: ServerMap;
  /** The first backup and the file's hash right after wrapping: if unchanged, restore is exact. */
  backupPath?: string;
  wrappedSha?: string;
}

export interface ConnectState {
  instanceId: string;
  connectedAt: string;
  key?: string;
  agents: ConnectedAgent[];
}

export interface ConnectResult {
  connected: { id: string; wrapped: string[] }[];
  failed: { id: string; reason: string }[];
  /** URL-based servers: the stdio proxy can't front these yet, so they stay direct. */
  notProtected: { id: string; server: string }[];
}

const mastyfDir = (home: string) => path.join(home, '.mastyf-ai');
const statePath = (home: string) => path.join(mastyfDir(home), 'connect.json');
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function readConnectState(home: string): ConnectState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath(home), 'utf8')) as ConnectState;
  } catch {
    return null;
  }
}

function writeState(home: string, state: ConnectState): void {
  fs.mkdirSync(mastyfDir(home), { recursive: true });
  fs.writeFileSync(statePath(home), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function connect(opts: { home: string; projectRoot: string; nodeCommand: string; key?: string }): ConnectResult {
  const state: ConnectState = readConnectState(opts.home) ?? {
    instanceId: randomUUID(),
    connectedAt: new Date().toISOString(),
    agents: [],
  };
  if (opts.key) state.key = opts.key;
  const result: ConnectResult = { connected: [], failed: [], notProtected: [] };

  for (const { agent, configPath } of findAgents(opts.home)) {
    try {
      // Strict JSON on purpose: rewriting a file with comments would destroy them.
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      if (!raw.mcpServers && !raw.servers) continue;
      const before = structuredClone(extractServers(raw));
      for (const [server, cfg] of Object.entries(before)) {
        if (cfg.url && !cfg.command) result.notProtected.push({ id: agent.id, server });
      }
      const wrap = runWrap({
        client: 'auto',
        configPath,
        projectRoot: opts.projectRoot,
        workspaceRoot: mastyfDir(opts.home),
        policyPath: path.join(opts.projectRoot, 'default-policy.yaml'),
        apply: true,
        nodeCommand: opts.nodeCommand,
      });
      if (wrap.wrapped.length === 0) continue;

      let entry = state.agents.find((a) => a.configPath === configPath);
      if (!entry) {
        entry = { id: agent.id, configPath, originals: {}, backupPath: wrap.backupPath, wrappedSha: sha(configPath) };
        state.agents.push(entry);
      } else {
        entry.wrappedSha = undefined; // wrapped again later, so the first backup is no longer the whole story
      }
      for (const name of wrap.wrapped) entry.originals[name] = before[name]!;
      result.connected.push({ id: agent.id, wrapped: wrap.wrapped });
    } catch (err) {
      result.failed.push({ id: agent.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  writeState(opts.home, state);
  return result;
}

function isOurEntry(entry: Record<string, unknown> | undefined): boolean {
  const args = entry?.args;
  return Array.isArray(args) && args.includes('proxy') && args.includes('--config');
}

export function disconnect(opts: { home: string }): { restored: string[]; left: string[] } {
  const state = readConnectState(opts.home);
  const out = { restored: [] as string[], left: [] as string[] };
  if (!state) return out;

  for (const agent of state.agents) {
    const names = Object.keys(agent.originals);
    try {
      if (agent.backupPath && agent.wrappedSha && sha(agent.configPath) === agent.wrappedSha) {
        fs.copyFileSync(agent.backupPath, agent.configPath);
        out.restored.push(...names);
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(agent.configPath, 'utf8')) as Record<string, unknown>;
      const servers = extractServers(raw) as ServerMap;
      for (const name of names) {
        if (isOurEntry(servers[name])) {
          servers[name] = agent.originals[name]!;
          out.restored.push(name);
        } else {
          out.left.push(name); // the user changed or removed it since; theirs to keep
        }
      }
      setServers(raw, servers);
      fs.writeFileSync(agent.configPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    } catch {
      out.left.push(...names);
    }
  }

  fs.rmSync(statePath(opts.home), { force: true });
  return out;
}

/** The JSON to paste into an agent `connect` doesn't recognise. */
export function printableConfig(opts: {
  projectRoot: string;
  nodeCommand: string;
  home: string;
  server: string;
  upstream: { command: string; args?: string[] } | { url: string };
}): string {
  const configsDir = path.join(mastyfDir(opts.home), 'mastyf-ai-configs');
  fs.mkdirSync(configsDir, { recursive: true });
  const file = path.join(configsDir, `${opts.server.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { [opts.server]: opts.upstream } }, null, 2) + '\n', 'utf8');
  const entry = buildWrappedMcpServerEntry(
    opts.projectRoot,
    file,
    path.join(opts.projectRoot, 'default-policy.yaml'),
    undefined,
    opts.nodeCommand,
  );
  return JSON.stringify({ mcpServers: { [opts.server]: entry } }, null, 2);
}

/** Tell the site this machine is connected. Best effort: setup never fails because of it. */
export async function announce(opts: {
  key: string;
  instanceId: string;
  version: string;
  baseUrl: string;
  hostname?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl.replace(/\/$/, '')}/api/v1/instances/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: opts.instanceId, version: opts.version, hostname: opts.hostname }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
