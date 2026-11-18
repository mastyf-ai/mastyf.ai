'use client';

import { lazy, Suspense, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import '@/app/attack-lab/attack-lab.css';
import './hero-tabs.css';

/** Loaded only when the tab is opened: the playground carries every recorded example. */
const Playground = lazy(() => import('@/app/attack-lab/Playground').then((m) => ({ default: m.Playground })));

type Tab = 'how' | 'px';

const TABS: { id: Tab; label: string }[] = [
  { id: 'how', label: 'How Mastyf works' },
  { id: 'px', label: 'Try Protocol X' },
];

/**
 * The hero's right-hand side. "How Mastyf works" leaves the boundary animation behind it in view;
 * "Try Protocol X" opens the Attack Lab's playground over it: pick an attacker's goal and a disguise,
 * send it, and see Protocol X's real recorded verdict. Nothing here calls the model.
 */
export function HeroTabs() {
  const [tab, setTab] = useState<Tab>('how');
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ how: null, px: null });

  // Arrow keys move between tabs, as a tablist should.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: Tab = tab === 'how' ? 'px' : 'how';
    setTab(next);
    refs.current[next]?.focus();
  };

  return (
    <div className={`hero-tabs${tab === 'px' ? ' hero-tabs--open' : ''}`}>
      <div className="hero-tabs__list" role="tablist" aria-label="See Mastyf at work" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`hero-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`hero-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`hero-tabs__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'px' && <span className="hero-tabs__paid">Shield</span>}
          </button>
        ))}
      </div>

      <div id="hero-panel-how" role="tabpanel" aria-labelledby="hero-tab-how" hidden={tab !== 'how'} className="hero-tabs__panel hero-tabs__panel--how">
        <p className="hero-tabs__hint">Every tool call converges on Mastyf and is checked against your policy before it runs.</p>
      </div>

      <div id="hero-panel-px" role="tabpanel" aria-labelledby="hero-tab-px" hidden={tab !== 'px'} className="hero-tabs__panel hero-tabs__panel--px">
        <div className="hero-px__head">
          <p className="hero-px__title">Protocol X: our own model, in Mastyf Shield</p>
          <p className="hero-px__lead">
            Pick what an attacker wants and how they disguise it, then send it. Every verdict, score and time is a
            recorded run of Protocol X on our red-team suite, attacks it never saw in training.
          </p>
        </div>
        {tab === 'px' && (
          <Suspense fallback={<p className="hero-tabs__loading">Loading Protocol X's recorded runs…</p>}>
            <Playground />
          </Suspense>
        )}
        <Link href="/attack-lab" className="link-icon hero-px__more">
          See every attack in the Attack Lab
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
