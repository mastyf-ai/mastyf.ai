/**
 * Minimal stdio MCP upstream for the fuzz CI job.
 *
 * The dashboard's MCP bridge relays to a stdio proxy (src/utils/mcp-http-relay.ts
 * calls proxyManager.getProxies(), which returns stdio proxies only — see
 * src/proxy/proxy-manager.ts:148-153), so the upstream must speak stdio over
 * stdin/stdout rather than HTTP.
 *
 * The fuzzer needs a real upstream so that payloads Mastyf correctly allows
 * through reach an actual server and come back as genuine success responses.
 * Without it every request would fail at the transport layer and the fuzzer
 * could not distinguish "Mastyf allowed this" from "Mastyf broke".
 *
 * This is a test fixture, not a product surface: it exposes no tools that touch
 * the filesystem or the network.
 */
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const PROTOCOL_VERSION = '2024-11-05';

/**
 * Side-channel record of every tools/call that actually reached this upstream.
 *
 * A response body cannot serve as the bypass oracle for an id-less request: a
 * notification is executed upstream and then correctly produces NO response, so
 * a guard that is completely bypassed is indistinguishable from a guard that
 * worked. The fuzzer therefore reads this log to decide whether a payload was
 * executed, independent of how the gateway chose to frame (or drop) the reply.
 */
const EXEC_LOG = process.env['FUZZ_EXEC_LOG'] || '/fuzz-artifacts/executed.log';

function recordExecution(tool) {
  try {
    appendFileSync(EXEC_LOG, `executed:${tool}\n`);
  } catch {
    // Never let canary bookkeeping break the fixture.
  }
}

const TOOLS = [
  {
    name: 'read_file',
    description: 'Fixture tool. Returns a fixed string; never touches the disk.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'list_directory',
    description: 'Fixture tool. Returns a fixed listing; never touches the disk.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
];

function toolResult(id, text) {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], isError: false },
  };
}

function handle(message) {
  const { id, method, params } = message ?? {};

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fuzz-upstream', version: '1.0.0' },
        },
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call':
      recordExecution(params?.name ?? 'unknown');
      return toolResult(id, `fixture-ok:${params?.name ?? 'unknown'}`);
    case 'resources/read':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            { uri: params?.uri ?? 'fixture://x', mimeType: 'text/plain', text: 'FIXTURE_SECRET_CANARY_9f3a2b' },
          ],
        },
      };
    case 'prompts/get':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          description: 'fixture',
          messages: [
            { role: 'user', content: { type: 'text', text: 'FIXTURE_SECRET_CANARY_9f3a2b' } },
          ],
        },
      };
    default:
      if (id === undefined || id === null) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

function write(message) {
  if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Per JSON-RPC 2.0 a message without an id is a notification and must never
 * get a response. Honouring that keeps the fixture honest: it ensures the
 * fuzzer's "executed upstream" signal means a real policy bypass rather than a
 * misbehaving test server answering something it should have ignored.
 */
function respond(message) {
  if (!message) return;
  if (message.id === undefined || message.id === null) return;
  write(message);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', line => {
  const raw = line.trim();
  if (!raw) return;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  // Batch requests.
  if (Array.isArray(parsed)) {
    for (const m of parsed) respond(handle(m));
    return;
  }
  respond(handle(parsed));
});

rl.on('close', () => process.exit(0));
