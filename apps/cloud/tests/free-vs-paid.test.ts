import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FREE_FEATURES, PAID_FEATURES } from '@/lib/tier-features';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const names = (list: { name: string }[]) => list.map((f) => f.name);

describe('free versus paid', () => {
  it('free runs on your own infrastructure: libraries, check service, policy engine', () => {
    const free = names(FREE_FEATURES).join(' | ');
    for (const n of ['Python library', 'JavaScript library', 'Check service', 'GitHub Copilot hooks', 'Policy engine', 'GitHub Action']) {
      expect(free).toContain(n);
    }
  });

  it('paid is the Shield app with every hosted and advanced layer, DIFC included', () => {
    const paid = names(PAID_FEATURES).join(' | ');
    for (const n of ['Shield desktop app', 'Protocol X', 'DIFC taint tracking', 'Argument-intent auditor', 'Causal gate', 'dashboard']) {
      expect(paid).toContain(n);
    }
  });

  it('nothing is listed on both sides', () => {
    const free = new Set(names(FREE_FEATURES));
    for (const n of names(PAID_FEATURES)) expect(free.has(n)).toBe(false);
  });

  it('things not shipped yet are marked as coming, not as available', () => {
    const byName = Object.fromEntries(FREE_FEATURES.map((f) => [f.name, f]));
    expect(byName['JavaScript library'].status).toBe('coming');
    expect(byName['GitHub Action'].status).toBe('coming');
    expect(byName['Python library'].status).toBe('available');
  });

  it('every row says what it does in plain words', () => {
    for (const f of [...FREE_FEATURES, ...PAID_FEATURES]) expect(f.what.length).toBeGreaterThan(15);
  });

  it('the pricing page shows the comparison under the plans', () => {
    const page = read('app/pricing/page.tsx');
    expect(page.indexOf('<FreeVsPaid')).toBeGreaterThan(page.indexOf('<PricingSection'));
  });

  it('getting started describes pip for free and the Shield app for paid, Windows only', () => {
    const page = read('app/docs/getting-started/page.tsx');
    expect(page).toContain('pip install mastyf-ai');
    expect(page).toContain('FREE_FEATURES');
    expect(page).toContain('PAID_FEATURES');
    expect(page).not.toMatch(/macOS|\.dmg|AppImage|\.deb|Linux/);
  });
});
