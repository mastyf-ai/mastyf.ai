import { beforeAll, describe, expect, it } from 'vitest';
import { CheckEngine } from '../src/engine';

/** A cross-section of ordinary calls, timed as a client would see them (after the engine is loaded). */
const CALLS: Array<[string, Record<string, unknown>]> = [
  ['read_file', { path: './README.md' }],
  ['list_directory', { path: 'src' }],
  ['write_file', { path: 'notes/todo.md', content: '- ship the release\n- update the docs\n'.repeat(20) }],
  ['bash', { command: 'git status' }],
  ['bash', { command: 'npm run build && npm run lint' }],
  ['search', { query: 'how to configure typescript paths' }],
  ['fetch', { url: 'https://docs.python.org/3/library/json.html' }],
  ['query', { sql: 'SELECT id, name FROM customers WHERE id = 42' }],
  ['create_issue', { title: 'Search is slow', body: 'Steps to reproduce: index 10k files, run search. '.repeat(10) }],
  ['send_message', { channel: 'dev', text: 'Deploy finished, all checks green.' }],
];

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

let engine: CheckEngine;
beforeAll(async () => {
  engine = await CheckEngine.create({});
});

describe('speed', () => {
  it('95% of call checks finish within 25 ms', async () => {
    for (let i = 0; i < 20; i++) {
      const [tool, args] = CALLS[i % CALLS.length];
      await engine.checkCall({ tool, arguments: args, session: `warm-${i}` });
    }
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const [tool, args] = CALLS[i % CALLS.length];
      const start = performance.now();
      // A fresh session per run of ten calls, like separate agent runs.
      await engine.checkCall({ tool, arguments: args, session: `run-${Math.floor(i / CALLS.length)}` });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    console.log(`LATENCY p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms`);
    expect(p95).toBeLessThan(25);
  }, 120000);
});
