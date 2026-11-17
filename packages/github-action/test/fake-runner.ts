/** A pretend GitHub runner: the env files a real one gives a step, in a temp folder. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE = resolve(here, '..', '..', 'check', 'dist', 'mastyf-check.cjs');

export interface FakeRunner {
  root: string;
  env: Record<string, string>;
  lines: string[];
  print: (line: string) => void;
  /** NAME<<delim / value / delim entries written to one of the files. */
  read(file: 'GITHUB_ENV' | 'GITHUB_OUTPUT' | 'GITHUB_STATE'): Record<string, string>;
  summary(): string;
  /** Every byte the Action wrote: files and printed lines. */
  everything(): string;
  /** The env a later step (or the post step) would get. */
  laterStep(): Record<string, string>;
  postStep(): Record<string, string>;
}

export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i]!);
    if (!m) continue;
    const value: string[] = [];
    for (i++; i < lines.length && lines[i] !== m[2]; i++) value.push(lines[i]!);
    out[m[1]!] = value.join('\n');
  }
  return out;
}

export function fakeRunner(inputs: Record<string, string> = {}): FakeRunner {
  const root = mkdtempSync(join(tmpdir(), 'mastyf action runner '));
  const workspace = join(root, 'workspace');
  const temp = join(root, 'runner temp');
  mkdirSync(workspace);
  mkdirSync(temp);
  const files = { GITHUB_ENV: join(root, 'env'), GITHUB_OUTPUT: join(root, 'output'), GITHUB_STATE: join(root, 'state'), GITHUB_STEP_SUMMARY: join(root, 'summary.md') };
  for (const f of Object.values(files)) writeFileSync(f, '');
  const env: Record<string, string> = {
    ...files,
    GITHUB_WORKSPACE: workspace,
    RUNNER_TEMP: temp,
    MASTYF_ACTION_ENGINE: ENGINE,
    PATH: process.env['PATH'] ?? '',
    SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
    ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v])),
  };
  const lines: string[] = [];
  const read = (file: 'GITHUB_ENV' | 'GITHUB_OUTPUT' | 'GITHUB_STATE') => parseKeyValues(readFileSync(files[file], 'utf8'));
  return {
    root,
    env,
    lines,
    print: (line) => lines.push(line),
    read,
    summary: () => readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8'),
    everything: () => [...Object.values(files).map((f) => readFileSync(f, 'utf8')), ...lines].join('\n'),
    laterStep: () => ({ ...env, ...read('GITHUB_ENV') }),
    postStep: () => ({
      ...env,
      ...read('GITHUB_ENV'),
      ...Object.fromEntries(Object.entries(read('GITHUB_STATE')).map(([k, v]) => [`STATE_${k}`, v])),
    }),
  };
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return cond();
}

export async function checkCall(url: string, token: string, tool: string, args: unknown): Promise<any> {
  const r = await fetch(`${url}/v1/check/call`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ tool, arguments: args }) });
  return r.json();
}

export async function checkResult(url: string, token: string, tool: string, result: unknown): Promise<any> {
  const r = await fetch(`${url}/v1/check/result`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ tool, result }) });
  return r.json();
}
