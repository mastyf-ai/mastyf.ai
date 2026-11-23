#!/usr/bin/env node
/**
 * Run benign MCP tool calls through Mastyf AI proxy (stdio) so history.db
 * records IDE-style traffic. Used by Cursor agent / CI personalization.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI = resolve(ROOT, 'dist/cli.js');
const POLICY = resolve(ROOT, 'default-policy.yaml');
const CONFIG = resolve(ROOT, 'mastyf-ai-configs/examples/filesystem.json');

const MCP_FS_ROOT =
  process.env.MCP_FS_ROOT || mkdtempSync(join(tmpdir(), 'mastyf-ai-agent-'));
mkdirSync(MCP_FS_ROOT, { recursive: true });
writeFileSync(
  join(MCP_FS_ROOT, 'notes.txt'),
  'Cursor agent traffic sample — recorded via Mastyf AI proxy.\n',
  'utf-8',
);
mkdirSync(join(MCP_FS_ROOT, 'docs'), { recursive: true });
writeFileSync(join(MCP_FS_ROOT, 'docs', 'readme.txt'), 'Benign docs.\n', 'utf-8');

function rpc(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: String(id), method, params }) + '\n';
}

async function waitForResponse(responses, id, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(String(id))) return responses.get(String(id));
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}

function pickTool(available, candidates) {
  for (const c of candidates) {
    if (available.includes(c)) return c;
  }
  return null;
}

async function main() {
  const fsRoot = process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : MCP_FS_ROOT;

  const configPath = resolve(ROOT, 'scripts/.agent-proxy-config.json');
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf-8'));
  cfg.mcpServers.filesystem.args[cfg.mcpServers.filesystem.args.length - 1] = fsRoot;
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));

  const env = {
    ...process.env,
    MASTYF_AI_DB_PATH: process.env.MASTYF_AI_DB_PATH || join(homedir(), '.mastyf-ai', 'history.db'),
    DASHBOARD_ENABLED: 'false',
    MASTYF_AI_WS_ENABLED: 'false',
    METRICS_ENABLED: process.env.METRICS_ENABLED ?? 'false',
    METRICS_PORT: process.env.METRICS_PORT ?? '9091',
    MASTYF_AI_ALLOW_MODE_OVERRIDE: 'true',
  };

  const responses = new Map();
  let stderr = '';

  const proc = spawn(
    'node',
    [CLI, 'proxy', '--config', configPath, '--policy', POLICY, '--blocking-mode', 'audit'],
    { stdio: ['pipe', 'pipe', 'pipe'], env, cwd: ROOT },
  );
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  createInterface({ input: proc.stdout }).on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(String(msg.id), msg);
    } catch {
      /* ignore */
    }
  });

  const ready = await new Promise((resolveReady, reject) => {
    const t = setInterval(() => {
      if (
        stderr.includes('stdio active for')
        || stderr.includes('Protection Active')
      ) {
        clearInterval(t);
        clearTimeout(hard);
        resolveReady();
      }
    }, 80);
    const hard = setTimeout(() => {
      clearInterval(t);
      reject(new Error(`Proxy did not start:\n${stderr.slice(-2000)}`));
    }, 25000);
  });
  await ready;

  proc.stdin.write(
    rpc('init', 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cursor-composer-agent', version: '1.0.0' },
    }),
  );
  const initResp = await waitForResponse(responses, 'init');
  if (initResp?.error) {
    throw new Error(`initialize failed: ${JSON.stringify(initResp.error)}`);
  }
  proc.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
  );

  responses.delete('tools');
  proc.stdin.write(rpc('tools', 'tools/list', {}));
  const listResp = await waitForResponse(responses, 'tools', 20000);
  const toolNames = (listResp?.result?.tools ?? []).map((t) => t.name);
  if (!toolNames.length) {
    proc.kill();
    throw new Error(`tools/list empty. stderr:\n${stderr.slice(-2000)}`);
  }

  const readTool = pickTool(toolNames, ['read_text_file', 'read_file']);
  const listTool = pickTool(toolNames, ['list_directory', 'list_directory_with_sizes']);
  const calls = [];
  if (listTool) {
    calls.push({ name: listTool, arguments: { path: '.' } });
    calls.push({ name: listTool, arguments: { path: 'docs' } });
  }
  if (readTool) {
    calls.push({ name: readTool, arguments: { path: 'notes.txt' } });
    calls.push({ name: readTool, arguments: { path: 'docs/readme.txt' } });
  }

  const results = [];
  let i = 1;
  for (const call of calls) {
    const id = `call-${i++}`;
    responses.delete(id);
    proc.stdin.write(rpc(id, 'tools/call', call));
    const resp = await waitForResponse(responses, id);
    results.push({
      tool: call.name,
      blocked: !!resp?.error,
      ok: !resp?.error && !!resp?.result,
      rule: resp?.error?.data?.rule ?? null,
    });
    await new Promise((r) => setTimeout(r, 200));
  }

  proc.kill();
  console.log(
    JSON.stringify(
      {
        ok: true,
        client: 'cursor-composer-agent',
        dbPath: env.MASTYF_AI_DB_PATH,
        fsRoot,
        tools: toolNames.length,
        calls: results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
