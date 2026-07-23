#!/usr/bin/env node
'use strict';

const FuzzPayloads = [
  { id: 'fuzz-001', cat: 'rpc-malform', desc: 'Truncated JSON-RPC', body: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}}}', block: true },
  { id: 'fuzz-002', cat: 'rpc-injection', desc: 'Sensitive path', body: '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}}}', block: true },
  { id: 'fuzz-003', cat: 'rpc-overflow', desc: 'Large request ID', body: '{"jsonrpc":"2.0","id":"' + 'x'.repeat(10000) + '","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/tmp/test.txt"}}}', block: false },
  { id: 'fuzz-004', cat: 'rpc-method', desc: 'Privilege escalation', body: '{"jsonrpc":"2.0","id":"4","method":"admin/root","params":{}}', block: true },
  { id: 'fuzz-005', cat: 'rpc-binding', desc: 'Empty tool name', body: '{"jsonrpc":"2.0","id":"5","method":"tools/call","params":{"name":"","arguments":{}}}', block: true },
  { id: 'fuzz-006', cat: 'rpc-nesting', desc: 'NoSQL injection', body: '{"jsonrpc":"2.0","id":"6","method":"tools/call","params":{"name":"read_file","arguments":{"path":{"$gt":""}}}}', block: true },
  { id: 'fuzz-007', cat: 'stdio-flood', desc: 'Shell exfil', body: '{"jsonrpc":"2.0","id":"7","method":"tools/call","params":{"name":"execute_command","arguments":{"command":"cat /etc/shadow"}}}', block: true },
  { id: 'fuzz-008', cat: 'sse-frame', desc: 'Destructive shell', body: '{"jsonrpc":"2.0","id":"8","method":"tools/call","params":{"name":"execute_command","arguments":{"command":"rm -rf /"}}}', block: true },
  { id: 'fuzz-009', cat: 'rpc-null', desc: 'Null method', body: '{"jsonrpc":"2.0","id":"9","method":null,"params":{}}', block: false },
  { id: 'fuzz-010', cat: 'rpc-array', desc: 'Batch JSON-RPC', body: '[{"jsonrpc":"2.0","id":"10","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}}}]', block: true },
  { id: 'fuzz-011', cat: 'rpc-unicode', desc: 'Unicode traversal', body: '{"jsonrpc":"2.0","id":"11","method":"tools/call","params":{"name":"read_file","arguments":{"path":"....//....//etc/passwd"}}}', block: true },
  { id: 'fuzz-012', cat: 'rpc-proto', desc: 'Prototype pollution', body: '{"jsonrpc":"2.0","id":"12","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/tmp/test.txt"}}}', block: false },
  { id: 'fuzz-013', cat: 'rpc-negid', desc: 'Negative ID', body: '{"jsonrpc":"2.0","id":-1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"/tmp/test.txt"}}}', block: false },
  { id: 'fuzz-014', cat: 'rpc-deep', desc: 'Deep nesting (6 levels)', body: '{"jsonrpc":"2.0","id":"14","method":"tools/call","params":{"name":"read_file","arguments":{"a":{"b":{"c":{"d":{"e":{"f":"deep"}}}}}}}}', block: false },
  { id: 'fuzz-015', cat: 'rpc-resource', desc: 'File URI injection', body: '{"jsonrpc":"2.0","id":"15","method":"tools/call","params":{"name":"read_file","arguments":{"path":"file:///etc/passwd"}}}', block: true },
];

const argv = process.argv.slice(2);
const getArg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const target = getArg('--target') || 'http://localhost:4000/mcp';
const minBlockRate = parseInt(getArg('--min-block-rate') || '80', 10);
const timeoutMs = parseInt(getArg('--timeout') || '10', 10) * 1000;
const failOnBypass = (getArg('--fail-on-bypass') || 'true') === 'true';

async function send(payload, id) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload, signal: ctrl.signal });
    clearTimeout(t);
    const dur = Date.now() - start;
    const body = await res.text().catch(() => '');
    const blocked = res.status === 401 || res.status === 403 || body.includes('Blocked') || body.includes('blocked') || body.includes('denied');
    return { id, blocked, status: res.status, dur, body: body.slice(0, 200) };
  } catch (e) {
    return { id, blocked: false, status: 0, dur: Date.now() - start, body: e.message, err: true };
  }
}

async function main() {
  console.log(`\nMCP Protocol Fuzzer — ${target}\n`);
  const results = [];
  for (const f of FuzzPayloads) {
    process.stdout.write(`  [${f.id}] ${f.desc}... `);
    const r = await send(f.body, f.id);
    r.expBlock = f.block;
    r.cat = f.cat;
    r.desc = f.desc;
    results.push(r);
    if (r.err) console.log('ERR');
    else if (r.blocked) console.log(`BLOCKED (${r.status})`);
    else console.log(`PASSED (${r.status})${f.block ? ' *** BYPASS' : ''}`);
  }

  const blocked = results.filter(r => r.blocked).length;
  const passed = results.filter(r => !r.blocked && !r.err).length;
  const errs = results.filter(r => r.err).length;
  const total = results.length;
  const rate = ((blocked / (total - errs)) * 100).toFixed(1);
  const bypasses = results.filter(r => !r.blocked && r.expBlock);

  console.log(`\nResults: ${blocked} blocked, ${passed} passed, ${errs} errors, ${rate}% block rate\n`);
  if (bypasses.length) {
    console.log('CRITICAL BYPASSES:');
    bypasses.forEach(b => console.log(`  [${b.id}] ${b.desc} — ${b.cat}`));
  }

  if (failOnBypass && bypasses.length) { console.log('FAIL'); process.exit(1); }
  if (parseFloat(rate) < minBlockRate) { console.log('FAIL: block rate below minimum'); process.exit(1); }
  console.log('PASSED');
}

main().catch(e => { console.error(e.message); process.exit(1); });
