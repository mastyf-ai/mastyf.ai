'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)'; // the Shield app's easing

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Plays the page-enter motion when `id` changes, without remounting the page underneath. */
export function PageTransition({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !el.animate) return;
    const a = el.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, easing: EASE_OUT },
    );
    return () => a.cancel();
  }, [id]);
  return <div ref={ref} className={className}>{children}</div>;
}

/** A number that rolls from its previous value to the new one. */
export function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === value || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString()}{suffix}</>;
}

/** Cross-fades the whole page while `change` runs (theme switch), where the browser supports it. */
export function withCrossfade(change: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) doc.startViewTransition(change);
  else change();
}
