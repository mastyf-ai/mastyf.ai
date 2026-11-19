import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every page and component a visitor can reach that states performance.
const LIVE = [
  'components/landing/HeroSection.tsx',
  'components/landing/HomeSections.tsx',
  'components/landing/stats.ts',
  'components/landing/AcademicPaperHero.tsx',
  'components/docs/Benchmarks.tsx',
  'components/docs/CostCalculator.tsx',
  'components/docs/DecisionConsole.tsx',
  'components/docs/Integrations.tsx',
  'components/docs/PlatformComponents.tsx',
  'app/docs/performance/page.tsx',
];
const read = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');

describe('what the site claims', () => {
  it.each(LIVE)('%s does not claim 4.8 µs decisions (a decision measures about 1.5 ms)', (file) => {
    expect(read(file)).not.toMatch(/4\.8\s*(µs|μs|us)/i);
  });

  it.each(LIVE)('%s makes no untraceable throughput or "tamper-proof" claims', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/330[,.]?000|>330k|330k/);
    expect(text).not.toMatch(/kernel bytecode|hardware-grade|tamper-proof/i);
  });

  it('labels benchmark results as the paper’s, not as independent or verified', () => {
    const bench = read('components/docs/Benchmarks.tsx');
    expect(bench).not.toMatch(/Independent benchmark|Verified performance/);
    expect(bench).not.toMatch(/zero bypass|no false positives/i);
  });

  it('gives InjecAgent one figure everywhere (the paper’s 98.43%)', () => {
    for (const file of LIVE) expect(read(file)).not.toMatch(/InjecAgent[^\n]{0,120}\b100\b|value: 100,/);
  });

  it('scopes the paper’s false-alarm result to the set it was measured on', () => {
    expect(read('components/landing/AcademicPaperHero.tsx')).not.toMatch(/zero false alarms<\/strong> on benign workloads/);
  });

  it('marks paper results as the paper’s on the home page', () => {
    const home = read('components/landing/HomeSections.tsx');
    expect(home).toMatch(/AgentDojo[^']*paper/i);
  });

  it.each(LIVE)('%s does not say Shield keeps everything on the device (Protocol X and activity go to Mastyf)', (file) => {
    expect(read(file)).not.toMatch(/100% on-device/i);
  });
});
