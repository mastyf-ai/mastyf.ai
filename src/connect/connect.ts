/** One-step setup: route every agent's MCP servers through the proxy, and undo it cleanly. */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildWrappedMcpServerEntry } from '../utils/windows-paths.js';
import { extractServers, managedConfigFileName, runWrap, sanitizeFileName, setServers } from '../wrap/client-wrap.js';
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
  /** Servers left direct: URL-based ones the stdio proxy can't front yet, and ones that only look wrapped. */
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
  fs.mkdirSync(mastyfDir(home), { recursive: true, mode: 0o700 });
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
    let entry: ConnectedAgent | undefined;
    let pending: string[] = [];
    try {
      // Strict JSON on purpose: rewriting a file with comments would destroy them.
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      for (const project of Object.values((raw.projects ?? {}) as Record<string, { mcpServers?: object }>)) {
        for (const server of Object.keys(project?.mcpServers ?? {})) result.notProtected.push({ id: agent.id, server });
      }
      if (!raw.mcpServers && !raw.servers) continue;
      const before = structuredClone(extractServers(raw)) as ServerMap;

      entry = state.agents.find((a) => a.configPath === configPath);
      const isNew = !entry;
      if (!entry) {
        entry = { id: agent.id, configPath, originals: {} };
        state.agents.push(entry);
      }
      // On disk before the agent's file changes, so a crash part-way can still be undone.
      pending = Object.keys(before).filter((name) => !isOurEntry(before[name]) && !entry!.originals[name]);
      for (const name of pending) entry.originals[name] = before[name]!;
      writeState(opts.home, state);

      const wrap = runWrap({
        client: 'auto',
        configPath,
        projectRoot: opts.projectRoot,
        workspaceRoot: mastyfDir(opts.home),
        policyPath: path.join(opts.projectRoot, 'default-policy.yaml'),
        apply: true,
        nodeCommand: opts.nodeCommand,
        fileKey: agent.id,
      });

      for (const name of pending) if (!wrap.wrapped.includes(name)) delete entry.originals[name];
      for (const name of Object.keys(before)) {
        if (!wrap.wrapped.includes(name) && !isOurEntry(before[name]) && name !== 'mastyf-ai') {
          result.notProtected.push({ id: agent.id, server: name });
        }
      }
      if (wrap.wrapped.length > 0) {
        if (isNew) {
          entry.backupPath = wrap.backupPath;
          entry.wrappedSha = sha(configPath);
        } else {
          entry.wrappedSha = undefined; // wrapped again later, so the first backup is no longer the whole story
        }
        result.connected.push({ id: agent.id, wrapped: wrap.wrapped });
      }
      if (Object.keys(entry.originals).length === 0) state.agents = state.agents.filter((a) => a !== entry);
      writeState(opts.home, state);
    } catch (err) {
      if (entry) {
        for (const name of pending) delete entry.originals[name];
        if (Object.keys(entry.originals).length === 0) state.agents = state.agents.filter((a) => a !== entry);
      }
      result.failed.push({ id: agent.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  writeState(opts.home, state);
  return result;
}

function isOurEntry(entry: Record<string, unknown> | undefined): boolean {
  const args = entry?.args;
  return Array.isArray(args) && args.includes('proxy') && args.includes('--config') && args.includes('--policy');
}

function removeGenerated(home: string, agentId: string, names: string[]): void {
  for (const name of names) {
    fs.rmSync(path.join(mastyfDir(home), 'mastyf-ai-configs', managedConfigFileName(agentId, name)), { force: true });
  }
}

export function disconnect(opts: { home: string }): { restored: string[]; left: string[]; failed: string[] } {
  const state = readConnectState(opts.home);
  const out = { restored: [] as string[], left: [] as string[], failed: [] as string[] };
  if (!state) return out;
  const unfinished: ConnectedAgent[] = [];

  for (const agent of state.agents) {
    const names = Object.keys(agent.originals);
    try {
      if (agent.backupPath && agent.wrappedSha && fs.existsSync(agent.backupPath) && sha(agent.configPath) === agent.wrappedSha) {
        fs.copyFileSync(agent.backupPath, agent.configPath);
        out.restored.push(...names);
        removeGenerated(opts.home, agent.id, names);
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(agent.configPath, 'utf8')) as Record<string, unknown>;
      const servers = extractServers(raw) as ServerMap;
      const restored: string[] = [];
      const left: string[] = [];
      for (const name of names) {
        if (isOurEntry(servers[name])) {
          servers[name] = agent.originals[name]!;
          restored.push(name);
        } else {
          left.push(name); // the user changed or removed it since; theirs to keep
        }
      }
      setServers(raw, servers);
      fs.writeFileSync(agent.configPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
      out.restored.push(...restored);
      out.left.push(...left);
      removeGenerated(opts.home, agent.id, restored);
    } catch {
      out.failed.push(...names);
      unfinished.push(agent); // keep the undo record so it can be retried
    }
  }

  if (unfinished.length > 0) writeState(opts.home, { ...state, agents: unfinished });
  else fs.rmSync(statePath(opts.home), { force: true });
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
  // The stdio proxy can't front a URL yet: give the working direct entry instead of one that hangs.
  if ('url' in opts.upstream) return JSON.stringify({ mcpServers: { [opts.server]: { url: opts.upstream.url } } }, null, 2);
  const configsDir = path.join(mastyfDir(opts.home), 'mastyf-ai-configs');
  fs.mkdirSync(configsDir, { recursive: true, mode: 0o700 });
  const file = path.join(configsDir, `${sanitizeFileName(opts.server)}.json`);
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { [opts.server]: opts.upstream } }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
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
