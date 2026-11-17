/**
 * `mastyf-check init-copilot [--dir <repo>] [--force]`: writes self-contained hooks for GitHub
 * Copilot's coding agent into a repository. Copilot reads hooks only from .github/hooks/*.json in
 * the repository and its sessions can't download anything, so the engine goes in the repo too.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const HOOK_DIR = '.github/hooks/mastyf';
const run = (kind: 'pre' | 'post') => `node ${HOOK_DIR}/mastyf-check.cjs copilot-hook ${kind}`;

export const HOOK_CONFIG = {
  version: 1,
  hooks: {
    preToolUse: [{ type: 'command', bash: run('pre'), timeoutSec: 30 }],
    postToolUse: [{ type: 'command', bash: run('post'), timeoutSec: 30 }],
  },
};

const README = `# Mastyf's free checks for GitHub Copilot's coding agent

Written by \`mastyf-check init-copilot\`. \`../mastyf.json\` tells Copilot to run
\`mastyf-check.cjs copilot-hook pre\` before each tool call and \`copilot-hook post\` after it.

- A call the free checks block is denied; Copilot is told "Blocked by Mastyf (...)".
- A result they block (for example a page with hidden instructions) is replaced before Copilot
  reads it; a secret in a result is hidden.
- If the checks can't run, the call is denied and the result withheld.
- Everything runs inside the Copilot session. Nothing is sent to Mastyf.

To update, run \`npx @mastyf_ai/check init-copilot --force\` again and commit the result.
The engine (\`mastyf-check.cjs\`) is AGPL-3.0; see LICENSE. Paid protection: https://www.mastyf.ai
`;

export class InitError extends Error {}

/** True for anything at `p`, including a dangling link (existsSync says false for those). */
function lstatExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** A file next to the bundle, or one folder up (npm package: dist/ + package root). */
function beside(bundle: string, name: string): string | null {
  for (const dir of [dirname(bundle), dirname(dirname(bundle))]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

export function initCopilot(opts: { dir: string; bundle: string; force?: boolean }): string[] {
  if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) throw new InitError(`${opts.dir} is not a folder`);
  if (!existsSync(opts.bundle)) throw new InitError(`the engine bundle wasn't found at ${opts.bundle}`);
  const licence = beside(opts.bundle, 'LICENSE');
  if (!licence) throw new InitError("the engine's LICENSE wasn't found next to it");
  const policy = beside(opts.bundle, 'check-default-policy.yaml');

  const files: [string, Buffer][] = [
    ['.github/hooks/mastyf.json', Buffer.from(`${JSON.stringify(HOOK_CONFIG, null, 2)}\n`)],
    [`${HOOK_DIR}/mastyf-check.cjs`, readFileSync(opts.bundle)],
    [`${HOOK_DIR}/LICENSE`, readFileSync(licence)],
    [`${HOOK_DIR}/README.md`, Buffer.from(README)],
  ];
  if (policy) files.push([`${HOOK_DIR}/check-default-policy.yaml`, readFileSync(policy)]);

  // Check everything first, so nothing is half-written. A cloned repository can hold links: every
  // step of every path we write must be a real folder or file inside the repository.
  const root = realpathSync(opts.dir);
  const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (const [rel] of files) {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const step = parts.slice(0, i).join('/');
      const full = join(opts.dir, step);
      if (!existsSync(full) && !lstatExists(full)) break;
      if (lstatSync(full).isSymbolicLink() || !same(realpathSync(full), join(root, ...parts.slice(0, i)))) {
        throw new InitError(`${step} is a link; refusing to write through it`);
      }
    }
  }
  if (!opts.force) {
    for (const [rel, content] of files) {
      const full = join(opts.dir, rel);
      if (existsSync(full) && !readFileSync(full).equals(content)) {
        throw new InitError(`${rel} already exists and is different; run again with --force to replace it`);
      }
    }
  }
  for (const [rel, content] of files) {
    const full = join(opts.dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return files.map(([rel]) => rel);
}

export function initCopilotMessage(dir: string, written: string[]): string {
  const where = relative(process.cwd(), dir) || '.';
  return [
    `Wrote Mastyf's Copilot hooks into ${where}:`,
    ...written.map((f) => `  ${f}`),
    '',
    'Commit .github/hooks/mastyf.json and .github/hooks/mastyf/ to your default branch.',
    "From then on, Copilot's coding agent checks every tool call and result with Mastyf's free checks.",
    `(${basename(written[1] ?? '')} is the free engine, AGPL-3.0; nothing is sent to Mastyf.)`,
  ].join('\n');
}
