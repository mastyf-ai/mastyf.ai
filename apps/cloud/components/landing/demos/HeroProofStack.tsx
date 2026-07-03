'use client';

import { useEffect, useState } from 'react';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';

const LIVE_EVENTS = [
  { status: 'blocked', tool: 'filesystem/read', detail: 'Path traversal · /etc/passwd' },
  { status: 'allowed', tool: 'github/create_pr', detail: 'Policy pass · feat/auth-fix' },
  { status: 'blocked', tool: 'shell/exec', detail: 'Shell injection · curl | bash' },
  { status: 'flagged', tool: 'postgres/query', detail: 'Semantic audit · bulk SELECT' },
];

export function HeroProofStack() {
  const [eventIdx, setEventIdx] = useState(0);
  const [score, setScore] = useState(87);

  useEffect(() => {
    const t = setInterval(() => {
      setEventIdx((i) => (i + 1) % LIVE_EVENTS.length);
      setScore((s) => (s === 87 ? 92 : s === 92 ? 74 : 87));
    }, 2800);
    return () => clearInterval(t);
  }, []);

  const event = LIVE_EVENTS[eventIdx];

  return (
    <div className="lp-hero-proof">
      <div className="lp-hero-proof-score card-elevated">
        <div className="lp-hero-score-ring" aria-hidden>
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e8e4dc" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="#c5a059"
              strokeWidth="8"
              strokeDasharray="327"
              strokeDashoffset={327 - (score / 100) * 327}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              className="lp-hero-score-arc"
            />
          </svg>
          <div className="lp-hero-score-num">
            <span key={score}>{score}</span>
            <small>/100</small>
          </div>
        </div>
        <div className="lp-hero-score-meta">
          <span className="lp-score-grade">@playwright/mcp</span>
          <span className="muted">Trust score · live lookup</span>
        </div>
      </div>

      <div className="lp-hero-proof-feed card-elevated">
        <div className="lp-hero-feed-header">
          <span className="demo-live-dot" />
          Runtime enforcement
        </div>
        <div key={eventIdx} className={`lp-hero-feed-event lp-hero-feed-${event.status} motion-tab-enter`}>
          <span className={`demo-event-badge demo-event-badge-${event.status === 'flagged' ? 'warn' : event.status}`}>
            {event.status.toUpperCase()}
          </span>
          <div>
            <strong>{event.tool}</strong>
            <p className="muted">{event.detail}</p>
          </div>
        </div>
        <div className="lp-hero-feed-mini">
          {LIVE_EVENTS.filter((_, i) => i !== eventIdx).slice(0, 2).map((e) => (
            <span key={e.tool} className={`lp-hero-feed-pill lp-hero-feed-pill-${e.status}`}>
              {e.tool}
            </span>
          ))}
        </div>
      </div>

      <div className="lp-hero-proof-lookup card-elevated" id="scores">
        <p className="lp-demo-label">Try it now — no account required</p>
        <BadgeLookupWidget variant="hero" />
      </div>
    </div>
  );
}
