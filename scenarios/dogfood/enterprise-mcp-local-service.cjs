#!/usr/bin/env node
const readline = require('readline');

const role = process.env.SERVICE_ROLE || 'generic';
const TOOLS = [
  'search', 'search_repositories', 'get_file_contents', 'read_file', 'read_text_file',
  'list_directory', 'list_files', 'write_to_file', 'query', 'list_tables',
  'puppeteer_navigate', 'puppeteer_screenshot', 'execute_command', 'bash', 'execute', 'echo',
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e) } }) + '\n');
    return;
  }
  const id = msg.id;
  try {
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'dogfood-' + role, version: '1.0.0' }, capabilities: { tools: {} } } }) + '\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: TOOLS.map((name) => ({ name, description: role + ':' + name })) } }) + '\n');
    } else if (msg.method === 'tools/call') {
      const args = (msg.params && msg.params.arguments) || {};
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ role, tool: msg.params && msg.params.name, args }) }] } }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + msg.method } }) + '\n');
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32603, message: String(e) } }) + '\n');
  }
});
setTimeout(() => {}, 999999);
