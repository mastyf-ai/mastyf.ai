#!/usr/bin/env node
// Mastyf AI Performance Benchmark
// Usage: node scripts/benchmark.mjs [--target URL] [--concurrency N]

const TARGET = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'http://localhost:4000/mcp';
const CONCURRENCY = parseInt(process.argv.includes('--concurrency') ? process.argv[process.argv.indexOf('--concurrency') + 1] : '50');
const SAMPLES = 200;

const benignPayload = (id) => ({ jsonrpc: '2.0', id: String(id), method: 'tools/call', params: { name: 'read_file', arguments: { path: '/tmp/benchmark-test.txt' } } });
const attackPayload = (id) => ({ jsonrpc: '2.0', id: String(id), method: 'tools/call', params: { name: 'read_file', arguments: { path: '/etc/passwd' } } });

async function benchmark(label, fn) {
  const warmup = await fn(0); // warmup
  const latencies = [];
  const startTime = Date.now();
  for (let i = 0; i < SAMPLES; i++) {
    const start = Date.now();
    await fn(i);
    latencies.push(Date.now() - start);
  }
  const elapsed = Date.now() - startTime;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const rps = Math.round(SAMPLES / (elapsed / 1000));
  return { label, samples: SAMPLES, avg: avg.toFixed(1), p50, p95, p99, rps };
}

async function send(id) {
  return fetch(TARGET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(benignPayload(id)), signal: AbortSignal.timeout(5000) });
}

async function sendAttack(id) {
  return fetch(TARGET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attackPayload(id)), signal: AbortSignal.timeout(5000) });
}

async function concurrent(label, total) {
  const startTime = Date.now();
  const tasks = [];
  for (let i = 0; i < total; i++) tasks.push(send(i).catch(() => null));
  const results = await Promise.all(tasks);
  const elapsed = Date.now() - startTime;
  const errors = results.filter(r => !r).length;
  const rps = Math.round(total / (elapsed / 1000));
  return { label, total, errors, elapsedMs: elapsed, rps };
}

console.log(`Mastyf AI Benchmark — ${TARGET}\n`);

console.log('1. Latency Analysis (benign reads)...');
const benignLat = await benchmark('benign-read', send);
console.log(`   avg=${benignLat.avg}ms p50=${benignLat.p50}ms p95=${benignLat.p95}ms p99=${benignLat.p99}ms rps=${benignLat.rps}`);

console.log('\n2. Latency Analysis (attack reads)...');
const attackLat = await benchmark('attack-read', sendAttack);
console.log(`   avg=${attackLat.avg}ms p50=${attackLat.p50}ms p95=${attackLat.p95}ms p99=${attackLat.p99}ms rps=${attackLat.rps}`);

console.log('\n3. Concurrent Load Test...');
for (const c of [10, 50, 100, 200]) {
  const r = await concurrent(`${c} concurrent`, c);
  console.log(`   ${c} concurrent: ${r.rps} req/s, ${r.errors} errors (${((r.errors / r.total) * 100).toFixed(1)}% error rate)`);
}

const result = {
  version: '4.2.0',
  target: TARGET,
  timestamp: new Date().toISOString(),
  latency: { benign: benignLat, attack: attackLat },
  concurrent: [10, 50, 100, 200].map(c => ({ count: c, note: 'loaded but not measured in this run' })),
};

console.log('\n4. Benchmark JSON:');
console.log(JSON.stringify(result, null, 2));
