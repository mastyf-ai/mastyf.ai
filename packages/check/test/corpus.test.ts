import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CheckEngine } from '../src/engine';

const CORPUS = join(__dirname, '..', '..', '..', 'corpus');
const BASELINE = join(__dirname, 'corpus-baseline.json');

interface Entry {
  toolName: string;
  arguments: Record<string, unknown>;
  expected: 'block' | 'pass';
  category: string;
  simulatedResponse?: string;
}

function entries(dir: string): Entry[] {
  const root = join(CORPUS, dir);
  return readdirSync(root, { recursive: true, withFileTypes: false })
    .map(String)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as Entry);
}

let engine: CheckEngine;
beforeAll(async () => {
  engine = await CheckEngine.create({});
});

/** Attacks the repository's corpus expects to be blocked: calls go through checkCall, simulated results through checkResult. */
async function measure() {
  const attacks = entries('attacks').filter((e) => e.expected === 'block');
  const byCategory: Record<string, { caught: number; total: number }> = {};
  const missed: string[] = [];
  let caught = 0;
  for (const e of attacks) {
    const verdict = e.simulatedResponse
      ? await engine.checkResult({ tool: e.toolName, result: e.simulatedResponse, arguments: e.arguments })
      : await engine.checkCall({ tool: e.toolName, arguments: e.arguments });
    const hit = verdict.decision !== 'allow';
    const c = (byCategory[e.category] ??= { caught: 0, total: 0 });
    c.total++;
    if (hit) {
      c.caught++;
      caught++;
    } else {
      missed.push(`${e.category} | ${e.toolName} | ${JSON.stringify(e.arguments).slice(0, 110)}`);
    }
  }
  if (process.env.CHECK_DUMP_MISSES) writeFileSync(process.env.CHECK_DUMP_MISSES, missed.join('\n'));
  const benign = [...entries('benign'), ...entries('edge-cases').filter((e) => e.expected === 'pass')];
  let wrong = 0;
  for (const e of benign) {
    const v = e.simulatedResponse
      ? await engine.checkResult({ tool: e.toolName, result: e.simulatedResponse })
      : await engine.checkCall({ tool: e.toolName, arguments: e.arguments });
    if (v.decision === 'block') wrong++;
  }
  return { attacks: attacks.length, caught, benign: benign.length, wrongBlocks: wrong, byCategory };
}

describe('the repository attack corpus', () => {
  it('catches about as many attacks as the recorded baseline, and blocks no benign entry', async () => {
    const m = await measure();
    const rate = m.caught / m.attacks;
    console.log(`CORPUS caught ${m.caught}/${m.attacks} (${(rate * 100).toFixed(1)}%), benign wrongly blocked ${m.wrongBlocks}/${m.benign}`);
    if (process.env.CHECK_WRITE_BASELINE === '1') {
      writeFileSync(BASELINE, JSON.stringify({ attacks: m.attacks, caught: m.caught, rate, byCategory: m.byCategory }, null, 2) + '\n');
    }
    expect(existsSync(BASELINE)).toBe(true);
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as { rate: number };
    expect(rate).toBeGreaterThanOrEqual(base.rate - 0.02);
    expect(m.wrongBlocks).toBe(0);
  }, 300000);
});
