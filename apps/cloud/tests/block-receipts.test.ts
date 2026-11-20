import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson, verifyChain, verifyReceipt, type BlockReceipt } from '@/lib/receipts/verify';
import { DEMO_RECEIPTS } from '@/lib/receipts/demo';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const load = (file: string) => JSON.parse(read(`public/receipts/demo/${file}`)) as BlockReceipt;

describe('block receipt verification (same format as Shield)', () => {
  it('canonical JSON sorts keys at every level and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: null }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":null,"z":1}]},"b":1}',
    );
  });

  it('every demo receipt published on the site verifies', async () => {
    for (const d of DEMO_RECEIPTS) {
      expect(await verifyReceipt(load(d.json)), d.json).toEqual({ ok: true });
    }
  });

  it('changing any field breaks the signature', async () => {
    const r = load(DEMO_RECEIPTS[0].json);
    for (const change of [
      { reason: 'Allowed after all.' },
      { arguments_preview: '{"file_path":"README.md"}' },
      { decision: 'allow' },
      { issued_at: '2026-11-21T00:00:00.000Z' },
    ]) {
      const result = await verifyReceipt({ ...r, ...change } as BlockReceipt);
      expect(result.ok).toBe(false);
    }
  });

  it('a receipt signed by a different key than expected is refused', async () => {
    const r = load(DEMO_RECEIPTS[0].json);
    const other = { ...r, signature: { ...r.signature, public_key: Buffer.alloc(32, 7).toString('base64') } };
    expect((await verifyReceipt(other)).ok).toBe(false);
  });

  it('the three demo receipts form an unbroken chain; dropping the middle one breaks it', async () => {
    const chain = DEMO_RECEIPTS.map((d) => load(d.json));
    expect(await verifyChain(chain)).toEqual({ ok: true });
    expect((await verifyChain([chain[0], chain[2]])).ok).toBe(false);
  });
});

describe('receipts on the home page', () => {
  it('sits on the home page after How it works', () => {
    const page = read('app/page.tsx');
    expect(page.indexOf('<SignedReceipts')).toBeGreaterThan(page.indexOf('<HowItWorks'));
  });

  it('labels them as audit evidence, never as compliance or a certificate', () => {
    const src = read('components/landing/SignedReceipts.tsx');
    expect(src).toContain('You can use it as evidence in your own SOC 2 or ISO 27001 audit.');
    expect(src).not.toMatch(/SOC compliant|SOC-compliant|certified|certificate/i);
  });

  it('every demo has its JSON and PDF published', () => {
    for (const d of DEMO_RECEIPTS) {
      expect(read(`public/receipts/demo/${d.json}`)).toContain('mastyf.block-receipt');
      expect(readFileSync(join(root, 'public/receipts/demo', d.pdf)).subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});
