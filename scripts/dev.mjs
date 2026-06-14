#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const config = process.argv[2] || 'mastyf-ai-configs/testbed-memory.json';
const policy = process.argv[3] || 'default-policy.yaml';

const proc = spawn('npx', [
  'tsx', 'src/cli.ts', 'proxy',
  '--config', config,
  '--policy', policy,
  '--blocking-mode', 'block',
], {
  cwd: ROOT,
  stdio: ['inherit', 'inherit', 'pipe'],
  env: { ...process.env },
});

let opened = false;
proc.stderr!.on('data', (d) => {
  process.stderr.write(d);
  if (!opened && d.toString().includes('proxy running')) {
    opened = true;
    try { execSync('xdg-open http://localhost:4000', { stdio: 'ignore' }); } catch {}
  }
});

const cleanup = () => { proc.kill(); process.exit(0); };
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
proc.on('exit', (code) => process.exit(code ?? 0));
