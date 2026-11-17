/**
 * Which settings files hold each agent's MCP servers, and what Shield would make of them. The paths
 * and the "first existing file" rule follow Shield 0.5.2's agent-auto-discovery.cjs (Windows paths;
 * Shield is Windows-only). Paths are built with path.win32 so the logic tests the same on any OS.
 */
import { win32 as path } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { extractServers, routingState, type RoutingState } from './routing';

export type EditorId = 'vscode' | 'vscode-insiders' | 'cursor' | 'windsurf';
export type CompanionId = 'claude-code' | 'cline';
export type AgentId = EditorId | CompanionId;

export interface Env {
  APPDATA?: string;
  LOCALAPPDATA?: string;
  USERPROFILE?: string;
}

export interface ServerEntry {
  name: string;
  file: string;
  agent: AgentId;
  /** `unreadable-by-shield`: the file has comments or other non-JSON, so Shield 0.5.2 can't route it. */
  state: RoutingState | 'unreadable-by-shield';
}

export function editorFromAppName(appName: string): EditorId | null {
  switch (appName.trim()) {
    case 'Visual Studio Code':
      return 'vscode';
    case 'Visual Studio Code - Insiders':
      return 'vscode-insiders';
    case 'Cursor':
      return 'cursor';
    case 'Windsurf':
      return 'windsurf';
    default:
      return null;
  }
}

const roaming = (env: Env) => env.APPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Roaming');
const home = (env: Env) => env.USERPROFILE || '';

/** The settings files Shield routes for this agent, user file first, then each open folder's file. */
export function settingsFilesFor(
  agent: AgentId,
  env: Env,
  workspaceFolders: string[],
  exists: (p: string) => boolean,
): string[] {
  const perFolder = (...rel: string[]) => workspaceFolders.map((f) => path.join(f, ...rel));
  switch (agent) {
    case 'vscode':
      return [path.join(roaming(env), 'Code', 'User', 'mcp.json'), ...perFolder('.vscode', 'mcp.json')];
    case 'vscode-insiders':
      return [];
    case 'cursor': {
      const candidates = [
        path.join(home(env), '.cursor', 'mcp.json'),
        path.join(roaming(env), 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'mcp.json'),
      ];
      const active = candidates.find(exists) ?? candidates[0];
      return [active, ...perFolder('.cursor', 'mcp.json')];
    }
    case 'windsurf':
      return [path.join(home(env), '.codeium', 'windsurf', 'mcp_config.json')];
    case 'claude-code':
      return [path.join(home(env), '.claude.json'), ...perFolder('.mcp.json')];
    case 'cline':
      return [
        path.join(roaming(env), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      ];
  }
}

const folderKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Only a plain local drive path (`C:\...`). A settings file in a cloned repository can name any
 * path, and reading a network share (`\\host\share`, `//host`) or device path (`\\?\`, `\\.\`)
 * makes Windows send the user's login hash to that host.
 */
export function isLocalDrivePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) && !p.includes('..');
}

type Parsed = { raw: unknown; shieldCanRead: boolean };

/** Shield parses with JSON.parse (an empty file is `{}`); comments only get past jsonc-parser. */
function parseSettings(text: string): Parsed | null {
  if (!text.trim()) return { raw: {}, shieldCanRead: true };
  try {
    return { raw: JSON.parse(text), shieldCanRead: true };
  } catch {
    const errors: ParseError[] = [];
    const raw = parseJsonc(text, errors, { allowTrailingComma: true });
    return errors.length === 0 ? { raw, shieldCanRead: false } : null;
  }
}

export class SettingsReader {
  /** The last good parse of each file, used while a file is being saved or is locked. */
  private readonly lastGood = new Map<string, Parsed>();

  constructor(
    private readonly readFile: (p: string) => string,
    private readonly statMtimeMs: (p: string) => number | null,
  ) {}

  /** For paths named inside settings files (`--config`): local drive paths only. */
  private readonly readLocalOnly = (p: string): string => {
    if (!isLocalDrivePath(p)) throw new Error('not a local drive path');
    return this.readFile(p);
  };

  read(agent: AgentId, files: string[], workspaceFolders: string[]): { servers: ServerEntry[]; newestMtimeMs: number } {
    const servers: ServerEntry[] = [];
    let newestMtimeMs = 0;
    const openFolders = new Set(workspaceFolders.map(folderKey));

    for (const file of files) {
      const mtime = this.statMtimeMs(file);
      if (mtime === null) {
        this.lastGood.delete(file); // no such file: nothing to protect there
        continue;
      }
      newestMtimeMs = Math.max(newestMtimeMs, mtime);

      let parsed: Parsed | null = null;
      try {
        parsed = parseSettings(this.readFile(file));
      } catch {
        parsed = null;
      }
      if (parsed) this.lastGood.set(file, parsed);
      else parsed = this.lastGood.get(file) ?? null;
      if (!parsed) continue;

      const sets: Record<string, unknown>[] = [extractServers(parsed.raw)];
      if (agent === 'claude-code') sets.push(...claudeProjectServers(parsed.raw, openFolders));

      for (const set of sets) {
        for (const [name, server] of Object.entries(set)) {
          servers.push({
            name,
            file,
            agent,
            state: parsed.shieldCanRead ? routingState(server, name, this.readLocalOnly) : 'unreadable-by-shield',
          });
        }
      }
    }
    return { servers, newestMtimeMs };
  }
}

/** Claude Code keeps per-project servers in .claude.json under `projects["C:/path"]`. */
function claudeProjectServers(raw: unknown, openFolders: Set<string>): Record<string, unknown>[] {
  const projects = (raw as { projects?: unknown })?.projects;
  if (!projects || typeof projects !== 'object') return [];
  return Object.entries(projects as Record<string, unknown>)
    .filter(([folder]) => openFolders.has(folderKey(folder)))
    .map(([, project]) => extractServers(project));
}
