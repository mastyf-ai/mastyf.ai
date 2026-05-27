#!/usr/bin/env node
const DATA_PLANE_URL = process.env.DATA_PLANE_URL || 'http://localhost:9091';
const REQUESTS = Number.parseInt(process.env.SOAK_REQUESTS || '500', 10);
const CONCURRENCY = Number.parseInt(process.env.SOAK_CONCURRENCY || '25', 10);
const PATHNAME = process.env.SOAK_PATH || '/';

function payload(i) {
  return {
    jsonrpc: '2.0',
    id: `soak-${i}`,
    method: 'tools/call',
    params: {
      name: i % 15 === 0 ? 'delete_database' : 'read_file',
      arguments: { path: `/tmp/${i}.txt` },
    },
  };
}

async function send(i) {
  const start = performance.now();
  const res = await fetch(`${DATA_PLANE_URL.replace(/\/$/, '')}${PATHNAME}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(i)),
  });
  const elapsedMs = performance.now() - start;
  return { ok: res.ok, status: res.status, elapsedMs };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function run() {
  const healthUrl = `${DATA_PLANE_URL.replace(/\/$/, '')}/healthz`;
  const health = await fetch(healthUrl);
  if (!health.ok) {
    throw new Error(`Data plane healthcheck failed: ${healthUrl} returned ${health.status}`);
  }

  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (next < REQUESTS) {
      const id = next++;
      results.push(await send(id));
    }
  });
  const startedAt = Date.now();
  await Promise.all(workers);
  const totalMs = Date.now() - startedAt;
  const latencies = results.map((r) => r.elapsedMs);
  const non2xx = results.filter((r) => !r.ok).length;
  const summary = {
    requests: REQUESTS,
    concurrency: CONCURRENCY,
    totalMs,
    throughputRps: Number(((REQUESTS / Math.max(totalMs, 1)) * 1000).toFixed(2)),
    p50Ms: Number(percentile(latencies, 50).toFixed(2)),
    p95Ms: Number(percentile(latencies, 95).toFixed(2)),
    p99Ms: Number(percentile(latencies, 99).toFixed(2)),
    non2xx,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (results.length !== REQUESTS) process.exit(1);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
