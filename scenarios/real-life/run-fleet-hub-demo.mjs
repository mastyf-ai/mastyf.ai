#!/usr/bin/env node
/**
 * Fleet Hub smoke demo: echo fixture + unified registry check.
 * Usage: node scenarios/real-life/run-fleet-hub-demo.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

function waitReady(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture timeout')), timeoutMs);
    const onData = (buf) => {
      const m = String(buf).match(/READY:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve(Number(m[1]));
      }
    };
    child.stdout?.on('data', onData);
    child.on('error', reject);
  });
}

async function main() {
  const demoDir = join(root, 'mastyf-ai-configs', 'examples');
  mkdirSync(demoDir, { recursive: true });

  const serversJson = join(homedir(), '.mastyf-ai', 'servers.json');
  mkdirSync(dirname(serversJson), { recursive: true });
  writeFileSync(
    serversJson,
    JSON.stringify([
      {
        name: 'remote-api',
        command: '',
        args: [],
        transport: 'sse',
        url: 'http://127.0.0.1:3001/mcp',
        disabled: false,
      },
    ], null, 2),
  );

  const echo = spawn('node', [join(root, 'tests/fixtures/mcp-http-echo-server.cjs'), '3001'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const upstreamPort = await waitReady(echo);

  const { discoverAllServers } = await import(join(root, 'dist/fleet/unified-server-registry.js'));
  const entries = discoverAllServers({ workspaceRoot: root, includeIde: false });
  console.log('Discovered servers:', entries.map((e) => e.name).join(', '));

  if (!entries.some((e) => e.name === 'remote-api')) {
    console.error('FAIL: remote-api not in unified registry');
    process.exit(1);
  }

  console.log(`Upstream echo ready on :${upstreamPort}`);
  console.log('OK: Fleet Hub registry sees remote-api');
  console.log('Next: run `mastyf-ai start` to spawn the full fleet.');

  echo.kill('SIGTERM');
  rmSync(serversJson, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
