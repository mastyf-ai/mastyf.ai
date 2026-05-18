#!/usr/bin/env npx tsx
/**
 * Fork worker: one isolated McpProxyServer + echo, N concurrent tools/call.
 * Writes JSON to BENCH_WORKER_RESULT_FILE (or stdout) for the parent aggregator.
 */
import { writeFileSync } from 'fs';
import { ProxyBenchSession, summarizeOutcomes } from './proxy-bench-common.js';

const CALL_COUNT = parseInt(process.env.BENCH_CALLS_PER_REPLICA ?? '100', 10);
const REPLICA_ID = parseInt(process.env.BENCH_REPLICA_ID ?? '0', 10);
const ID_OFFSET = REPLICA_ID * CALL_COUNT;

async function main(): Promise<void> {
  const session = new ProxyBenchSession({
    serverName: `multi-proxy-${REPLICA_ID}`,
    forwardStdout: false,
  });
  await session.start();
  const { outcomes, wallMs } = await session.runConcurrent(CALL_COUNT, ID_OFFSET);
  await session.stop();

  const summary = summarizeOutcomes(outcomes, CALL_COUNT, Number.MAX_SAFE_INTEGER);
  const payload = {
    replicaId: REPLICA_ID,
    callCount: CALL_COUNT,
    idOffset: ID_OFFSET,
    wallMs,
    latenciesMs: outcomes.map((o) => o.latencyMs),
    correctness: summary.correctness,
    latencyMs: summary.latencyMs,
  };
  const json = JSON.stringify(payload);
  const outFile = process.env.BENCH_WORKER_RESULT_FILE;
  if (outFile) {
    writeFileSync(outFile, json + '\n');
  } else {
    process.stdout.write(json + '\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
