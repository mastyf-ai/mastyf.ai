'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';
import { FAMILIES } from './arena-data';

/** Catch rate per disguise on the full red-team suite, as bars that grow into view. */

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
        const now = pct(f.caught.now);
        return (
          <article key={f.id} className="pxd__card">
            <h3>{f.label}</h3>
            <div className="pxd__bar">
              <span className="pxd__label">Caught</span>
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
