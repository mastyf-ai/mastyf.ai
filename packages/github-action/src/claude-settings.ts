/**
 * Claude Code settings with Mastyf's hooks, for anthropics/claude-code-action's `settings` input.
 * The hooks send every tool call (PreToolUse) and result (PostToolUse) to this job's checks.
 *
 * claude-code-action merges these into ~/.claude/settings.json (the lowest settings layer), and
 * Claude Code watches settings files during the run. So the settings also refuse every
 * configuration change (ConfigChange → exit 2), the hook denies writes to Claude Code's settings
 * and to itself, and the post step checks the hooks were still in place at the end.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface WriteOptions {
  dir: string;
  hookPath: string;
  url: string;
  token: string;
  /** The node that runs the hook (default: this process's own, by absolute path). */
  nodePath?: string;
  /** The user's own Claude Code settings file, to add our hooks to. */
  base?: string;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, unknown[]> };

const CONFIG_CHANGE = { matcher: '*', hooks: [{ type: 'command', command: 'exit 2', timeout: 10, onFailure: 'block' }] };

/** The user's base settings, or an error naming the file. */
export function readBase(path: string | undefined): Settings {
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`claude-settings-base ${basename(path)} isn't valid JSON (${(err as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`claude-settings-base ${basename(path)} must be a JSON object`);
  const s = parsed as Settings;
  for (const key of ['disableAllHooks', 'allowManagedHooksOnly']) {
    if (s[key]) throw new Error(`claude-settings-base ${basename(path)} sets ${key}, which would switch Mastyf's hooks off; remove it`);
  }
  for (const [event, list] of Object.entries(s.hooks ?? {})) {
    if (!Array.isArray(list)) throw new Error(`claude-settings-base ${basename(path)}: hooks.${event} must be a list`);
  }
  return s;
}

export function buildSettings(base: Settings, hookCommand: string): Settings {
  // Fail closed: onFailure "block" (Claude Code v2.1.295+); the hook also exits 2 on any error.
  const ours = { matcher: '*', hooks: [{ type: 'command', command: hookCommand, timeout: 30, onFailure: 'block' }] };
  const hooks: Record<string, unknown[]> = { ...(base.hooks ?? {}) };
  for (const event of ['PreToolUse', 'PostToolUse']) hooks[event] = [...(hooks[event] ?? []), ours];
  // No settings change takes effect during the run (except managed policy settings).
  hooks['ConfigChange'] = [...(hooks['ConfigChange'] ?? []), CONFIG_CHANGE];
  return { ...base, disableAllHooks: false, allowManagedHooksOnly: false, hooks };
}

/** The repository's own Claude Code settings files that would switch hooks off, if any. */
export function hooksSwitchedOffIn(workspace: string): string | null {
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    try {
      const s = JSON.parse(readFileSync(join(workspace, rel), 'utf8')) as Settings;
      if (s && (s['disableAllHooks'] || s['allowManagedHooksOnly'])) return rel;
    } catch {
      /* missing or not JSON: Claude Code ignores it too */
    }
  }
  return null;
}

function hasCommand(list: unknown, command: string): boolean {
  return Array.isArray(list) && list.some((e) => Array.isArray((e as { hooks?: unknown[] })?.hooks) && (e as { hooks: { command?: string }[] }).hooks.some((h) => h?.command === command));
}

/**
 * Why Claude Code's checks can't be trusted to have been on for the whole run, or null.
 * ~/.claude/settings.json is where claude-code-action put our hooks; if it's missing, Claude Code
 * wasn't run in this job and there is nothing to check.
 */
export function claudeHooksProblem(home: string, workspace: string, command: string): string | null {
  const off = hooksSwitchedOffIn(workspace);
  if (off) return `${off} switches hooks off`;
  const file = join(home, '.claude', 'settings.json');
  let s: Settings;
  try {
    s = JSON.parse(readFileSync(file, 'utf8')) as Settings;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : '~/.claude/settings.json is unreadable';
  }
  if (s['disableAllHooks'] || s['allowManagedHooksOnly']) return '~/.claude/settings.json switches hooks off';
  if (!hasCommand(s.hooks?.['PreToolUse'], command) || !hasCommand(s.hooks?.['PostToolUse'], command)) {
    return "Mastyf's hooks are missing from ~/.claude/settings.json";
  }
  return null;
}

/** Takes our hooks back out of ~/.claude/settings.json (self-hosted runners keep it for later jobs). */
export function removeOurHooks(home: string, command: string): void {
  const file = join(home, '.claude', 'settings.json');
  let s: Settings;
  try {
    s = JSON.parse(readFileSync(file, 'utf8')) as Settings;
  } catch {
    return;
  }
  if (!s.hooks || typeof s.hooks !== 'object') return;
  const ours = (e: unknown) =>
    JSON.stringify(e) === JSON.stringify(CONFIG_CHANGE) || (Array.isArray((e as { hooks?: unknown[] })?.hooks) && (e as { hooks: { command?: string }[] }).hooks.some((h) => h?.command === command));
  const hooks: Record<string, unknown[]> = {};
  for (const [event, list] of Object.entries(s.hooks)) {
    const kept = Array.isArray(list) ? list.filter((e) => !ours(e)) : list;
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept as unknown[];
  }
  writeFileSync(file, `${JSON.stringify({ ...s, hooks }, null, 2)}\n`, 'utf8');
}

/** The exact hook command (the post step looks for it, and removes it, by this string). */
export function hookCommand(opts: Pick<WriteOptions, 'hookPath' | 'url' | 'token' | 'nodePath'>): string {
  const node = opts.nodePath ?? process.execPath;
  for (const p of [node, opts.hookPath]) {
    if (/[$`"]/.test(p)) throw new Error(`the path ${p} can't be used safely in a hook command (it contains $, \` or ")`);
  }
  return `"${node}" "${opts.hookPath}" "${opts.url}" "${opts.token}"`;
}

/**
 * The address and token go in the hook command itself, not in a file the agent could later
 * rewrite. (The token is no secret from the job: every step has it in MASTYF_CHECK_TOKEN.)
 */
export function writeClaudeSettings(opts: WriteOptions): { settings: string; command: string } {
  const base = readBase(opts.base);
  const command = hookCommand(opts);
  const settings = join(opts.dir, 'mastyf-claude-settings.json');
  writeFileSync(settings, `${JSON.stringify(buildSettings(base, command), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(settings, 0o600);
  return { settings, command };
}
