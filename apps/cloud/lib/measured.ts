/**
 * Numbers the site states as measured on the product, in one place. Each says how it was measured, so
 * a page can't quietly present a benchmark or a best case as everyday performance.
 *
 * Rule check: packages/check/test/latency.test.ts (the free rules engine, one call at a time, laptop
 * CPU, 2026-11-19): median 1.44 ms, 95th percentile 5.03 ms.
 * Protocol X: median decision time from the Attack Lab's recorded runs.
 */
export const MEASURED = {
  ruleCheck: { median: '~1.5 ms', p95: '~5 ms', how: 'the rules engine, one call at a time, laptop CPU' },
  protocolX: { median: '~1 s', how: "Protocol X's recorded runs, laptop CPU" },
} as const;

/** Results reported in the paper (Das, 2026): its own setup, not a measurement of every install. */
export const PAPER_RESULTS = {
  agentdojo: '99.52%',
  injecagent: '98.43%',
} as const;
