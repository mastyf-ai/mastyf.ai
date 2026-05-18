#!/usr/bin/env node
/** MCP stdio server that never responds to tools/call (for proxy timeout tests). */
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'hung-server', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      }) + '\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [{ name: 'hang', description: 'Never responds', inputSchema: { type: 'object' } }],
        },
      }) + '\n');
    } else if (msg.method === 'tools/call') {
      // Intentionally hang — no response
    } else if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found: ' + msg.method },
      }) + '\n');
    }
  } catch {
    // ignore malformed input
  }
});

setTimeout(function () {}, 99999);
