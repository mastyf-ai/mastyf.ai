'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTACKS, type AttackEntry } from './data';

type Rendered = { pre: string };

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

// Highlight the trigger span inside the payload once the verdict is revealed.
function renderPayload(payload: string, trigger: string, revealed: boolean): Rendered {
  const i = payload.indexOf(trigger);
  if (!revealed || i < 0) return { pre: escapeHtml(payload) };
  return {
    pre:
      escapeHtml(payload.slice(0, i)) +
      '<mark>' +
      escapeHtml(payload.slice(i, i + trigger.length)) +
      '</mark>' +
      escapeHtml(payload.slice(i + trigger.length)),
  };
}

function AttackCard({ a, onOpen }: { a: AttackEntry; onOpen: (a: AttackEntry) => void }) {
  return (
    <button type="button" className="alab-card" onClick={() => onOpen(a)}>
      <span className="alab-card__top">
        <span className="alab-card__title">{a.title}</span>
        <span className={`alab-chip alab-chip--${a.section}`}>{a.section === 'novel' ? 'Novel' : 'Common'}</span>
      </span>
      <span className="alab-card__how">{a.how}</span>
      <span className="alab-card__meta">
        <span className="alab-dot">Blocked</span>
        {a.catch ? <span className="alab-catch">{a.catch} caught</span> : null}
        <span className="alab-lat">{a.latencyMs} ms</span>
      </span>
    </button>
  );
}

export function AttackLab() {
  const [active, setActive] = useState<AttackEntry | null>(null);
  const [stage, setStage] = useState(0); // 0 payload, 1 inspect, 2 verdict
  const [revealed, setRevealed] = useState(false);
  const [meter, setMeter] = useState(0);
  const timers = useRef<number[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const run = useCallback(
    (a: AttackEntry) => {
      clearTimers();
      const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const conf = Math.round(a.pUnsafe * 100);
      if (reduce) {
        setStage(2); setRevealed(true); setMeter(conf);
        return;
      }
      setStage(0); setRevealed(false); setMeter(0);
      timers.current.push(window.setTimeout(() => setStage(1), 700));
      timers.current.push(
        window.setTimeout(() => {
          setStage(2); setRevealed(true);
          window.requestAnimationFrame(() => setMeter(conf));
        }, 1950),
      );
    },
    [clearTimers],
  );

  const open = useCallback((a: AttackEntry) => { setActive(a); run(a); }, [run]);
  const close = useCallback(() => { clearTimers(); setActive(null); }, [clearTimers]);

  useEffect(() => {
    if (!active) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [active, close]);

  useEffect(() => clearTimers, [clearTimers]);

  const novel = ATTACKS.filter((a) => a.section === 'novel');
  const common = ATTACKS.filter((a) => a.section === 'common');
  const conf = active ? Math.round(active.pUnsafe * 100) : 0;
  const payload = active ? renderPayload(active.payload, active.trigger, revealed) : { pre: '' };

  return (
    <>
      <section className="alab-deck">
        <div className="alab-deckhead">
          <h2>Novel attacks</h2>
          <span className="alab-k">invented by our red team</span>
          <p>
            Structures the model was never trained on. Our red team builds new ways to smuggle an instruction past a
            guard, then measures whether Protocol X still catches them. These three it does.
          </p>
        </div>
        <div className="alab-grid">
          {novel.map((a) => <AttackCard key={a.id} a={a} onOpen={open} />)}
        </div>
      </section>

      <section className="alab-deck">
        <div className="alab-deckhead">
          <h2>Common attacks</h2>
          <span className="alab-k">the known playbook</span>
          <p>The attack classes every MCP agent faces. Each card replays a real block from Mastyf&apos;s vetted attack corpus.</p>
        </div>
        <div className="alab-grid">
          {common.map((a) => <AttackCard key={a.id} a={a} onOpen={open} />)}
        </div>
      </section>

      {active ? (
        <div className="alab-sim" role="dialog" aria-modal="true" aria-label={`${active.title} simulation`} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="alab-panel">
            <div className="alab-phead">
              <div className="alab-phead__text">
                <h3>{active.title}</h3>
                <p>{active.how}</p>
              </div>
              <button type="button" className="alab-x" ref={closeRef} onClick={close} aria-label="Close simulation">×</button>
            </div>
            <div className="alab-pbody">
              <div className="alab-stage" aria-hidden="true">
                <span className={`alab-step ${stage === 0 ? 'on' : stage > 0 ? 'done' : ''}`}>1 · Payload arrives</span>
                <span className={`alab-step ${stage === 1 ? 'on' : stage > 1 ? 'done' : ''}`}>2 · Protocol X inspects</span>
                <span className={`alab-step ${stage === 2 ? 'on' : ''}`}>3 · Verdict</span>
              </div>

              <div className={`alab-term ${stage === 1 ? 'scanning' : ''} ${revealed ? 'revealed' : ''}`}>
                <div className="alab-tbar">
                  <span className="alab-dir">{active.carrier === 'call' ? 'Agent → tool call' : 'Tool → result'}</span>
                  <span className="alab-tool">{active.tool}</span>
                </div>
                <span className="alab-scan" aria-hidden="true" />
                <pre dangerouslySetInnerHTML={{ __html: payload.pre }} />
              </div>

              <div className={`alab-verdict ${stage === 2 ? 'show' : ''}`} aria-live="polite">
                <span className="alab-badge">BLOCKED</span>
                <div className="alab-vdetail">
                  <div className="alab-vhead">Threat stopped — Protocol X flagged this as unsafe</div>
                  <div className="alab-meter"><i style={{ width: `${meter}%` }} /></div>
                  <div className="alab-nums">
                    <span className="alab-conf">confidence <b>{conf}%</b></span>
                    <span>decided in <b>{active.latencyMs} ms</b></span>
                  </div>
                </div>
              </div>

              <div className="alab-controls">
                <button type="button" className="alab-btn" onClick={() => run(active)}>▸ Replay</button>
                <button type="button" className="alab-btn alab-btn--ghost" onClick={close}>Close</button>
                <span className="alab-src">{active.source}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
