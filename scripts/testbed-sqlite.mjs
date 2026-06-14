#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const PROXY_URL = process.env['PROXY_URL'] || 'http://localhost:4000/mcp';

class HttpTransport {
  constructor(url) { this.url = url; }
  async start() {}
  async send(msg) {
    const resp = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    const data = await resp.json();
    if (this.onmessage) this.onmessage(data);
    return data;
  }
  async close() {}
}

const client = new Client({ name: 'mastyf-testbed-sqlite', version: '1.0' });

async function main() {
  console.log(`Connecting to proxy at ${PROXY_URL}...`);
  const transport = new HttpTransport(PROXY_URL);
  await client.connect(transport);
  console.log('Connected.\n');

  const tools = (await client.listTools()).tools;
  console.log(`Server has ${tools.length} tools:\n`);
  for (const t of tools) {
    console.log(`  ${t.name}`);
    console.log(`    required: ${t.inputSchema?.required?.join(', ') || 'none'}\n`);
  }

  const tests = [
    // ── Benign ──
    { label: 'Benign: list tables',        tool: 'list_tables', args: {} },
    { label: 'Benign: simple select',      tool: 'query',       args: { query: "SELECT 1 as test" } },
    { label: 'Benign: create table',       tool: 'query',       args: { query: "CREATE TABLE IF NOT EXISTS users (id INT, name TEXT)" } },
    { label: 'Benign: insert data',        tool: 'query',       args: { query: "INSERT INTO users VALUES (1, 'alice')" } },
    { label: 'Benign: read data',          tool: 'query',       args: { query: "SELECT * FROM users" } },

    // ── SQL Injection ──
    { label: 'Blocked: UNION select',      tool: 'query',       args: { query: "SELECT name FROM users UNION SELECT password FROM admin_users--" } },
    { label: 'Blocked: UNION select v2',   tool: 'query',       args: { query: "SELECT id, name FROM users UNION SELECT credit_card, ssn FROM payments" } },
    { label: 'Blocked: sleep benchmark',   tool: 'query',       args: { query: "SELECT BENCHMARK(10000000, MD5('test'))" } },
    { label: 'Blocked: load_file',         tool: 'query',       args: { query: "SELECT LOAD_FILE('/etc/passwd')" } },
    { label: 'Blocked: drop table',        tool: 'query',       args: { query: "DROP TABLE users" } },
    { label: 'Blocked: delete from',       tool: 'query',       args: { query: "DELETE FROM users WHERE 1=1" } },
    { label: 'Blocked: truncate',          tool: 'query',       args: { query: "TRUNCATE TABLE users" } },

    // ── NoSQL-style injection (Mongo $where etc) ──
    { label: 'Blocked: NoSQL $where',     tool: 'query',       args: { query: "SELECT * FROM users WHERE $where" } },
    { label: 'Blocked: NoSQL $ne',        tool: 'query',       args: { query: "SELECT * FROM users WHERE $ne" } },
    { label: 'Blocked: NoSQL $gt',        tool: 'query',       args: { query: "{ $gt: '' }" } },

    // ── Exfiltration via SQL ──
    { label: 'Blocked: exfil payments',    tool: 'query',       args: { query: "SELECT * FROM payments" } },
    { label: 'Blocked: exfil credentials', tool: 'query',       args: { query: "SELECT * FROM credentials" } },
    { label: 'Blocked: exfil secrets',     tool: 'query',       args: { query: "SELECT password FROM admin_users" } },
  ];

  console.log(`Running ${tests.length} tests...\n`);
  let passed = 0, blocked = 0, fp = 0, fn = 0;

  for (const t of tests) {
    const expectedBlock = t.label.startsWith('Blocked');
    try {
      const response = await client.callTool({ name: t.tool, arguments: t.args });
      const errMsg = response.isError && response.content?.[0]?.text || '';
      const wasBlocked = response.isError && (errMsg.includes('Blocked') || errMsg.includes('-32001'));

      if (expectedBlock && wasBlocked) {
        console.log(`  ✓ ${t.label}`); blocked++;
      } else if (!expectedBlock && !response.isError) {
        console.log(`  ✓ ${t.label}`); passed++;
      } else if (expectedBlock && !response.isError) {
        console.log(`  ✗ ${t.label}  *** FALSE NEGATIVE ***`); fn++;
      } else {
        console.log(`  ✗ ${t.label}  *** FALSE POSITIVE ***`); fp++;
      }
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('Blocked') || msg.includes('-32001')) {
        console.log(`  ✓ ${t.label}`); blocked++;
      } else {
        console.log(`  ? ${t.label}  error: ${msg.slice(0, 80)}`);
      }
    }
  }

  console.log(`\n─── Results: ${passed} allowed, ${blocked} blocked ───`);
  if (fp > 0) console.log(`  ⚠ ${fp} false positives`);
  if (fn > 0) console.log(`  ⚠ ${fn} false negatives`);
  console.log(`  Detection rate: ${Math.round(blocked / (blocked + fn) * 100)}%\n`);
  await client.close();
}

main();
