#!/usr/bin/env node
// Minimal MCP stdio server that records every tools/call it actually executes.
//
// The test needs an oracle for "did this request reach the upstream?" that does
// not depend on how the proxy routes the reply. For a JSON-RPC notification
// (no `id`) the reply is legitimately dropped by the proxy, so asserting on
// stdout cannot distinguish "blocked" from "executed but unanswered". This
// server instead appends each executed call to the file named by
// MASTYF_TEST_EXEC_LOG, which is visible to the test either way.
const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const execLog = process.env.MASTYF_TEST_EXEC_LOG;

function record(entry) {
  if (!execLog) return;
  try {
    fs.appendFileSync(execLog, `${JSON.stringify(entry)}\n`);
  } catch {
    // Never let bookkeeping break the server.
  }
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e && e.message) } }) + '\n',
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
          serverInfo: { name: 'exec-recorder', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      }) + '\n',
    );
  } else if (msg.method === 'tools/list') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            { name: 'secret_tool', description: 'Denied by policy', inputSchema: { type: 'object', properties: { marker: { type: 'string' } } } },
          ],
        },
      }) + '\n',
    );
  } else if (msg.method === 'tools/call') {
    // Reaching this line means the request was dispatched upstream.
    record({ tool: msg.params && msg.params.name, id: msg.id === undefined ? null : msg.id });
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        ...(msg.id === undefined ? {} : { id: msg.id }),
        result: { content: [{ type: 'text', text: 'upstream-executed' }] },
      }) + '\n',
    );
  } else {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }) + '\n',
    );
  }
});

setTimeout(function () {}, 99999);
