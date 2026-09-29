#!/usr/bin/env node
'use strict';

const FuzzPayloads = [
  { id: 'fuzz-001', cat: 'rpc-notification', desc: 'Guard evasion via omitted id (notification)', body: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}}}', block: true },
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
// A bare boolean flag (e.g. --fail-on-bypass) must not swallow the following
// --flag as its value, otherwise the option silently evaluates to false and
// the run reports PASSED while printing bypasses.
const getArg = (f) => {
  const i = argv.indexOf(f);
  if (i < 0) return null;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return 'true';
  return next;
};

const target = getArg('--target') || 'http://127.0.0.1:4000/mcp';
const minBlockRate = parseInt(getArg('--min-block-rate') || '80', 10);
// Must exceed the relay's own 15s correlation wait: a request that is
// suppressed upstream (e.g. a blocked notification) only resolves to
// -32003 once that wait elapses. A shorter client timeout would abort and
// misreport a correctly-blocked payload as an error.
const timeoutMs = parseInt(getArg('--timeout') || '30', 10) * 1000;
const failOnBypass = (getArg('--fail-on-bypass') || 'true') === 'true';
const reportPath = getArg('--report');

async function send(payload, id) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: payload, signal: ctrl.signal });
    clearTimeout(t);
    const dur = Date.now() - start;
    const body = await res.text().catch(() => '');

    // Definitive execution oracle. The fixture upstream only echoes
    // "fixture-ok:<tool>" when a tools/call actually reached it, so seeing
    // this token proves the guard was evaded regardless of how the gateway
    // framed the HTTP status. This is what catches an id-stripping bypass,
    // where the request is forwarded and the response is simply never
    // correlated back to the caller.
    const executedUpstream = body.includes('fixture-ok:');

    // A JSON-RPC error object means the gateway rejected the request at the
    // protocol layer. Blocked notifications are answered with no body at all,
    // so a rejection is frequently signalled only by the error code.
    let rpcErrorCode = null;
    let batchUnsupported = false;
    let payloadHasId = false;
    try {
      const sent = JSON.parse(payload);
      payloadHasId = !Array.isArray(sent) && sent && sent.id !== undefined && sent.id !== null;
    } catch { /* payload is intentionally malformed in some cases */ }
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        // The HTTP-to-stdio bridge does not implement JSON-RPC batch arrays.
        batchUnsupported = true;
      } else if (parsed && parsed.error && typeof parsed.error.code === 'number') {
        rpcErrorCode = parsed.error.code;
      }
    } catch { /* non-JSON body: fall through to the text heuristics */ }

    const RPC_REJECTION_CODES = new Set([
      -32700, // parse error
      -32600, // invalid request
      -32601, // method not found
      -32602, // invalid params
      -32603, // internal error
      -32001, // policy / lifecycle block
      -32002, // response poisoning block
    ]);
    const rejectedByRpc = rpcErrorCode !== null && RPC_REJECTION_CODES.has(rpcErrorCode);

    // -32003 "No response from proxy" is only a policy verdict when the request
    // was a notification: a blocked notification is correctly never answered,
    // so the bridge's correlation wait times out. For an identified request the
    // same code means the proxy never correlated a reply at all, which says
    // nothing about policy and must not be scored as a block.
    const suppressedNotification = rpcErrorCode === -32003 && !payloadHasId;
    const uncorrelatedResponse = rpcErrorCode === -32003 && payloadHasId;

    const blocked =
      res.status === 401 ||
      res.status === 403 ||
      body.includes('Blocked') ||
      body.includes('blocked') ||
      body.includes('denied') ||
      rejectedByRpc ||
      suppressedNotification;
    // A 401 means the auth layer rejected us, not that Mastyf judged the
    // payload. Counting it as "blocked" would make every payload pass without
    // ever reaching policy, so surface it separately and let the caller fail.
    const authBlocked = res.status === 401;
    return {
      id,
      blocked: blocked && !executedUpstream,
      executedUpstream,
      batchUnsupported,
      rpcErrorCode,
      suppressedNotification,
      uncorrelatedResponse,
      authBlocked,
      status: res.status,
      dur,
      body: body.slice(0, 200),
    };
  } catch (e) {
    return { id, blocked: false, authBlocked: false, status: 0, dur: Date.now() - start, body: e.message, err: true };
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
    else if (r.executedUpstream) console.log(`EXECUTED UPSTREAM (${r.status}) *** CRITICAL BYPASS`);
    else if (r.blocked) console.log(`BLOCKED (${r.status}${r.rpcErrorCode !== null ? ` ${r.rpcErrorCode}` : ''})`);
    else console.log(`PASSED (${r.status})${f.block ? ' *** BYPASS' : ''}`);
  }

  const blocked = results.filter(r => r.blocked).length;
  const passed = results.filter(r => !r.blocked && !r.err).length;
  const errs = results.filter(r => r.err).length;
  const authBlocked = results.filter(r => r.authBlocked).length;
  const batchUnsupported = results.filter(r => r.batchUnsupported).length;
  const total = results.length;
  const rate = ((blocked / (total - errs)) * 100).toFixed(1);
  // A transport error (timeout/abort) is inconclusive, not a bypass: the
  // request may well have been suppressed upstream. Only an actual response
  // that was not rejected counts as a guard evasion.
  const bypasses = results.filter(r => !r.blocked && !r.err && r.expBlock);
  // A tool call that reached the upstream is a guard evasion no matter how
  // the response was framed, so it is tracked independently of the block rate.
  const executed = results.filter(r => r.executedUpstream);
  const uncorrelated = results.filter(r => r.uncorrelatedResponse);

  console.log(`\nResults: ${blocked} blocked, ${passed} passed, ${errs} errors, ${rate}% block rate\n`);
  if (batchUnsupported) {
    console.log(`NOTE: ${batchUnsupported} payload(s) used a JSON-RPC batch array.`);
    console.log('The HTTP-to-stdio bridge does not implement batching (returns -32003);');
    console.log('this is a known functional gap, not a policy decision.');
  }
  if (uncorrelated.length) {
    console.log(`WARNING: ${uncorrelated.length} identified request(s) got -32003 "No response from proxy".`);
    console.log('The guard fired (see the audit log) but its error frame never reached');
    console.log('the client over the dashboard bridge, which timed out instead. That is a');
    console.log('pre-existing response-delivery bug, so these are not scored as policy blocks.');
    uncorrelated.forEach(u => console.log(`  [${u.id}] ${u.desc}`));
  }
  if (authBlocked) {
    console.log(`WARNING: ${authBlocked} request(s) rejected with 401 by the auth layer.`);
    console.log('The target requires authentication; these were not policy decisions.');
  }
  if (bypasses.length) {
    console.log('CRITICAL BYPASSES:');
    bypasses.forEach(b => console.log(`  [${b.id}] ${b.desc} — ${b.cat}`));
  }

  if (reportPath) {
    const { writeFileSync } = await import('node:fs');
    const report = {
      target, total, blocked, passed, errors: errs, auth_blocked: authBlocked,
      batch_unsupported: batchUnsupported,
      executed_upstream: executed.map(e => e.id),
      block_rate: parseFloat(rate), min_block_rate: minBlockRate,
      bypasses: bypasses.map(b => ({ id: b.id, desc: b.desc, cat: b.cat, status: b.status })),
      results,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report written to ${reportPath}`);
  }

  // Guard against a silently vacuous run: if every verdict came from the auth
  // layer, the fuzzer proved nothing about policy.
  if (total > 0 && authBlocked === total) {
    console.log('FAIL: every request was rejected by auth (401), so no policy was exercised');
    process.exit(1);
  }
  if (executed.length) {
    console.log('FAIL: a guarded tool call reached the upstream (guard evasion)');
    process.exit(1);
  }
  if (errs) {
    console.log(`FAIL: ${errs} payload(s) did not produce a response; the run is inconclusive`);
    process.exit(1);
  }
  // A run where the guard never returned a verdict to the client has not
  // actually proven the block path works, so it cannot satisfy the gate.
  if (failOnBypass && uncorrelated.length) {
    console.log('FAIL: policy blocks were not delivered to the client (response-delivery bug)');
    process.exit(1);
  }
  if (failOnBypass && bypasses.length) { console.log('FAIL'); process.exit(1); }
  if (parseFloat(rate) < minBlockRate) { console.log('FAIL: block rate below minimum'); process.exit(1); }
  console.log('PASSED');
}

main().catch(e => { console.error(e.message); process.exit(1); });
