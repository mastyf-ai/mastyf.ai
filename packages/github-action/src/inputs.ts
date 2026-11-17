/** The Action's inputs, read and checked. A bad value stops the step with a plain message. */
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { getInput } from './runner.js';

export interface Inputs {
  failOnBlock: boolean;
  mode: 'block' | 'observe';
  policy?: string;
  port: number;
  maxBodyMb: number;
  showReasons: boolean;
  onError: 'fail' | 'continue';
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

type Env = Record<string, string | undefined>;

function bool(env: Env, name: string, fallback: boolean): boolean {
  const v = getInput(name, env).toLowerCase();
  if (v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new InputError(`${name} must be true or false, not "${v}"`);
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const v = getInput(name, env) || fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new InputError(`${name} must be one of ${allowed.join(', ')}, not "${v}"`);
  return v as T;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = getInput(name, env);
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${name} must be a whole number from ${min} to ${max}, not "${raw}"`);
  return n;
}

function policyPath(env: Env, workspace: string): string | undefined {
  const raw = getInput('policy', env);
  if (!raw) return undefined;
  const full = resolve(workspace, raw);
  const inside = (p: string, root: string) => {
    const rel = relative(root, p);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!inside(full, resolve(workspace))) throw new InputError(`policy "${raw}" is outside the workspace`);
  if (!existsSync(full)) throw new InputError(`policy file not found: ${raw}`);
  // A link inside the workspace that points out of it is outside too.
  if (!inside(realpathSync(full), realpathSync(workspace))) throw new InputError(`policy "${raw}" is outside the workspace`);
  return full;
}

export function readInputs(env: Env, workspace: string): Inputs {
  return {
    failOnBlock: bool(env, 'fail-on-block', false),
    mode: oneOf(env, 'mode', ['block', 'observe'] as const, 'block'),
    policy: policyPath(env, workspace),
    port: int(env, 'port', 0, 0, 65535),
    maxBodyMb: int(env, 'max-body-mb', 32, 1, 64),
    showReasons: bool(env, 'show-reasons', false),
    onError: oneOf(env, 'on-error', ['fail', 'continue'] as const, 'fail'),
  };
}
