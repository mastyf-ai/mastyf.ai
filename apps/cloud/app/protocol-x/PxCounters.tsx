'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/app/attack-lab/GateSim';

/** A number that runs from `from` to `to` once it scrolls into view. */
function Count({ from, to, prefix = '', suffix = '' }: { from: number; to: number; prefix?: string; suffix?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1400);
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(Math.round(from + (to - from) * eased));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [from, to, reduced]);

  return (
    <span ref={ref}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}

export type Counter = { label: string; from: number; to: number; prefix?: string; suffix?: string; tail?: string };

export function PxCounters({ items }: { items: Counter[] }) {
  return (
    <dl className="pxc">
      {items.map((c) => (
        <div key={c.label}>
          <dt>{c.label}</dt>
          <dd>
            <Count from={c.from} to={c.to} prefix={c.prefix} suffix={c.suffix} />
            {c.tail ? <small>{c.tail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
