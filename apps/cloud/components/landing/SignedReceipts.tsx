'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, RotateCcw, ShieldAlert, Pencil } from 'lucide-react';
import { DEMO_RECEIPT_DIR, DEMO_RECEIPTS } from '@/lib/receipts/demo';
import { verifyReceipt, type BlockReceipt, type Verdict } from '@/lib/receipts/verify';
import '@/app/design/receipts.css';

/**
 * Signed block receipts: a demo receipt the visitor can check in their own browser, then tamper with
 * and watch the check fail. The receipts were made by Shield's receipt code with a throwaway key.
 */

const LAYER_NAMES: Record<BlockReceipt['layer'], string> = {
  policy: 'Policy rules',
  'protocol-x': 'Protocol X',
  difc: 'DIFC taint tracking',
  aia: 'Argument-intent auditor',
  'causal-gate': 'Causal gate',
};

const TAMPERED_REASON = 'Allowed: nothing wrong here.';

const short = (hex: string | null, n = 12) => (hex ? `${hex.slice(0, n)}…` : 'first receipt');

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function SignedReceipts() {
  const [pick, setPick] = useState(DEMO_RECEIPTS[0].id);
  const [receipts, setReceipts] = useState<Record<string, BlockReceipt>>({});
  const [tampered, setTampered] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const demo = DEMO_RECEIPTS.find((d) => d.id === pick) ?? DEMO_RECEIPTS[0];
  const original = receipts[demo.id];
  const shown: BlockReceipt | undefined = original && tampered ? { ...original, reason: TAMPERED_REASON } : original;

  useEffect(() => {
    let live = true;
    Promise.all(
      DEMO_RECEIPTS.map(async (d) => {
        const res = await fetch(`${DEMO_RECEIPT_DIR}/${d.json}`);
        return [d.id, (await res.json()) as BlockReceipt] as const;
      }),
    )
      .then((pairs) => live && setReceipts(Object.fromEntries(pairs)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    let live = true;
    setVerdict(null);
    verifyReceipt(shown).then((v) => live && setVerdict(v));
    return () => {
      live = false;
    };
  }, [shown?.receipt_id, tampered]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => {
    setPick(id);
    setTampered(false);
  };

  return (
    <section className="section receipts" id="receipts" aria-labelledby="receipts-title">
      <div className="receipts__copy">
        <h2 id="receipts-title">A signed receipt for every block</h2>
        <p>
          Tamper-evident record of this block. You can use it as evidence in your own SOC 2 or ISO 27001 audit.
        </p>
        <div className="receipts__tabs" role="group" aria-label="Demo receipts">
          {DEMO_RECEIPTS.map((d) => (
            <button key={d.id} type="button" className="tab" aria-pressed={pick === d.id} onClick={() => choose(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="receipts__actions">
          <button type="button" className="btn btn-sm" onClick={() => setTampered((t) => !t)} disabled={!original}>
            {tampered ? (
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {tampered ? 'Put it back' : 'Tamper with it'}
          </button>
        </div>
      </div>

      <article className={`receipt${tampered ? ' receipt--tampered' : ''}`} aria-live="polite">
        {shown ? (
          <>
            <header className="receipt__head">
              <span className="receipt__kind">Block receipt</span>
              <span className="receipt__time">{when(shown.issued_at)}</span>
            </header>
            <dl className="receipt__rows">
              <div>
                <dt>Agent</dt>
                <dd>{shown.agent}</dd>
              </div>
              <div>
                <dt>Tool</dt>
                <dd>{shown.tool}</dd>
              </div>
              <div>
                <dt>Arguments</dt>
                <dd className="receipt__mono">{shown.arguments_preview}</dd>
              </div>
              <div>
                <dt>Stopped by</dt>
                <dd>
                  {LAYER_NAMES[shown.layer]}
                  {shown.rule ? <span className="receipt__rule"> · {shown.rule}</span> : null}
                </dd>
              </div>
              <div className={tampered ? 'receipt__changed' : undefined}>
                <dt>Reason</dt>
                <dd>{shown.reason}</dd>
              </div>
              <div>
                <dt>Follows</dt>
                <dd className="receipt__mono">{short(shown.prev_receipt_sha256)}</dd>
              </div>
              <div>
                <dt>Signed by key</dt>
                <dd className="receipt__mono">{shown.signature.key_id}</dd>
              </div>
              <div>
                <dt>Signature</dt>
                <dd className="receipt__mono">{short(shown.signature.value, 28)}</dd>
              </div>
            </dl>
            <footer className="receipt__foot">
              {verdict === null ? (
                <span className="receipt__check">Checking the signature in your browser…</span>
              ) : verdict.ok ? (
                <span key={`ok-${pick}`} className="receipt__stamp receipt__stamp--ok">
                  <BadgeCheck size={18} strokeWidth={1.75} aria-hidden="true" />
                  Signature valid, checked in your browser
                </span>
              ) : (
                <span key={`bad-${pick}`} className="receipt__stamp receipt__stamp--bad">
                  <ShieldAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                  Signature broken: the receipt was changed
                </span>
              )}
            </footer>
          </>
        ) : (
          <p className="receipt__check">Loading receipt…</p>
        )}
      </article>
    </section>
  );
}
