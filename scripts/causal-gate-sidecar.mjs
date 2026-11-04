#!/usr/bin/env node
// Runs the causal gate's engine over JSON lines on stdin/stdout, so a benchmark written in another
// language tests the code the proxy runs, not a copy of it.
//   {"op":"result","session":"s","server":"x","tool":"get_email","result":"..."}
//   {"op":"trust","session":"s","text":"..."}
//   {"op":"call","session":"s","tool":"send_money","args":{...}}  -> {"action","rule","message"}
// Usage: node scripts/causal-gate-sidecar.mjs [path to engine.js]   (default: built dist/)
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const enginePath = process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : new URL('../dist/ai/causal-gate/engine.js', import.meta.url).href;
const { CausalEngine } = await import(enginePath);
const engine = new CausalEngine();

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let reply = { ok: true };
  try {
    const msg = JSON.parse(line);
    const key = { sessionId: msg.session, connectionId: 'sidecar' };
    if (msg.op === 'result') engine.observe(key, msg.server ?? 'bench', msg.tool, msg.result);
    else if (msg.op === 'trust') engine.trust(key, msg.text);
    else if (msg.op === 'call') {
      const d = engine.check(key, msg.tool, msg.args ?? {});
      reply = { action: d.action, rule: d.rule, message: d.message };
    } else reply = { error: `unknown op ${msg.op}` };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err) };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}
