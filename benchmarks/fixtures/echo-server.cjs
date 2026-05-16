#!/usr/bin/env node
// Minimal MCP stdio server for benchmarking.
// Responds to initialize, tools/list, and tools/call.
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'bench-echo', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      }) + '\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: {
          tools: [
            { name: 'echo', description: 'Echo the input back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
            { name: 'search', description: 'Search for a term', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
          ],
        },
      }) + '\n');
    } else if (msg.method === 'tools/call') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: { content: [{ type: 'text', text: JSON.stringify((msg.params && msg.params.arguments) || {}) }] },
      }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        error: { code: -32601, message: 'Method not found: ' + msg.method },
      }) + '\n');
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: (typeof msg !== 'undefined' && msg && msg.id) || 'unknown',
      error: { code: -32700, message: 'Parse error: ' + e.message },
    }) + '\n');
  }
});

// Keep alive
setTimeout(function () {}, 99999);