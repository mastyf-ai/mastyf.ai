'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';
import { FAMILIES, RELEASE_LABEL } from './arena-data';

/** Catch rate per disguise on the full red-team suite, October model against November, as bars that grow into view. */

const pct = (c: [number, number] | null) => (c ? Math.round((c[0] / c[1]) * 1000) / 10 : null);

export function PxDisguises() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (reduced) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div className="pxd" ref={ref} data-seen={seen}>
      {FAMILIES.map((f) => {
        const now = pct(f.caught.now), before = pct(f.caught.before);
        return (
          <article key={f.id} className="pxd__card">
            <h3>{f.label}</h3>
            <div className="pxd__bar">
              <span className="pxd__label">{RELEASE_LABEL.before.replace(' release', '')}</span>
              <span className="pxd__track"><i className="pxd__fill pxd__fill--before" style={{ width: seen ? `${before ?? 0}%` : 0 }} /></span>
              <b>{f.caught.before ? `${f.caught.before[0]}/${f.caught.before[1]}` : '—'}</b>
            </div>
            <div className="pxd__bar">
              <span className="pxd__label">{RELEASE_LABEL.now.replace(' release', '')}</span>
              <span className="pxd__track"><i className="pxd__fill" style={{ width: seen ? `${now ?? 0}%` : 0 }} /></span>
              <b>{f.caught.now ? `${f.caught.now[0]}/${f.caught.now[1]}` : '—'}</b>
            </div>
            <p className="pxd__calm">
              Harmless twins blocked: {f.wronglyBlocked.now ? `${f.wronglyBlocked.now[0]}/${f.wronglyBlocked.now[1]}` : '—'}
            </p>
          </article>
        );
      })}
    </div>
  );
}
