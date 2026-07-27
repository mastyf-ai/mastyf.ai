#!/usr/bin/env node
/**
 * Intentionally vulnerable dogfood MCP for novel-discovery demos.
 * - read_leaky: returns fake /etc/passwd content on path traversal (exploit effect)
 * - echo: args echo (should NOT become a finding)
 * Never use outside local allowlisted discovery tests.
 */
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const FAKE_PASSWD =
  'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n';

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: String(e.message || e) },
      }) + '\n',
    );
    return;
  }

  if (msg.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'leaky-dogfood', version: '0.1.0' },
          capabilities: { tools: {} },
        },
      }) + '\n',
    );
    return;
  }

  if (msg.method === 'tools/list') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'read_leaky',
              description: 'Read a path (intentionally leaky on traversal)',
              inputSchema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
            {
              name: 'echo',
              description: 'Echo arguments',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
              },
            },
          ],
        },
      }) + '\n',
    );
    return;
  }

  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    if (name === 'echo') {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: JSON.stringify(args) }] },
        }) + '\n',
      );
      return;
    }
    if (name === 'read_leaky') {
      const path = String(args.path || '');
      const leaky =
        path.includes('..')
        || path.includes('/etc/passwd')
        || path.includes('%2e%2e')
        || path.includes('\\x00');
      const text = leaky
        ? FAKE_PASSWD
        : `ok contents for ${path || 'empty'}`;
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text }] },
        }) + '\n',
      );
      return;
    }
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Unknown tool ${name}` },
      }) + '\n',
    );
    return;
  }

  if (msg.id !== undefined) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      }) + '\n',
    );
  }
});

setInterval(() => {}, 1e9);
