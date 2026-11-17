/**
 * Claude Code settings with Mastyf's hooks, for anthropics/claude-code-action's `settings` input.
 * The hooks send every tool call (PreToolUse) and result (PostToolUse) to this job's checks.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface WriteOptions {
  dir: string;
  hookPath: string;
  url: string;
  token: string;
  /** The user's own Claude Code settings file, to add our hooks to. */
  base?: string;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, unknown[]> };

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
  return parsed as Settings;
}

export function buildSettings(base: Settings, hookCommand: string): Settings {
  // Fail closed: onFailure "block" (Claude Code v2.1.295+); the hook also exits 2 on any error.
  const ours = { matcher: '*', hooks: [{ type: 'command', command: hookCommand, timeout: 30, onFailure: 'block' }] };
  const hooks: Record<string, unknown[]> = { ...(base.hooks ?? {}) };
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const theirs = Array.isArray(hooks[event]) ? hooks[event]! : [];
    hooks[event] = [...theirs, ours];
  }
  return { ...base, hooks };
}

export function writeClaudeSettings(opts: WriteOptions): { settings: string; config: string } {
  const base = readBase(opts.base);
  const config = join(opts.dir, 'mastyf-claude-hook.json');
  writeFileSync(config, JSON.stringify({ url: opts.url, token: opts.token }), { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(config, 0o600);
  const settings = join(opts.dir, 'mastyf-claude-settings.json');
  const command = `node "${opts.hookPath}" "${config}"`;
  writeFileSync(settings, `${JSON.stringify(buildSettings(base, command), null, 2)}\n`, 'utf8');
  return { settings, config };
}
