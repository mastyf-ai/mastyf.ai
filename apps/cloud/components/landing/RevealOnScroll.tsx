'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type MotionMode = 'section' | 'tab' | 'architecture' | 'cta' | 'flow';

type Props = {
  children: ReactNode;
  className?: string;
  delay?: number;
  mode?: MotionMode;
};

const MODE_CLASS: Record<MotionMode, string> = {
  section: 'reveal-section',
  tab: 'reveal-tab',
  architecture: 'reveal-arch',
  cta: 'reveal-cta',
  flow: 'reveal-flow',
};

export function RevealOnScroll({ children, className = '', delay = 0, mode = 'section' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style = delay > 0 ? { transitionDelay: `${delay}ms` } : undefined;

  return (
    <div
      ref={ref}
      className={`reveal ${MODE_CLASS[mode]}${visible ? ' reveal-visible' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}
