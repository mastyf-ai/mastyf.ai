'use client';

import { useEffect, useState } from 'react';

interface InterceptEvent {
  id: number;
  time: string;
  verdict: 'BLOCKED' | 'ALLOWED';
  tool: string;
  gate: string;
  latency: string;
  client: string;
}

const SEED_EVENTS: Omit<InterceptEvent, 'id'>[] = [
  { time: '', verdict: 'BLOCKED', tool: 'filesystem.read_file', gate: 'CBAC Perimeter', latency: '1.8µs', client: 'Claude Desktop' },
  { time: '', verdict: 'ALLOWED', tool: 'weather.lookup', gate: 'Policy Clear', latency: '1.9µs', client: 'Cursor AI' },
  { time: '', verdict: 'BLOCKED', tool: 'network.http_post', gate: 'DIFC Taint', latency: '2.4µs', client: 'Windsurf' },
  { time: '', verdict: 'ALLOWED', tool: 'git.diff', gate: 'Policy Clear', latency: '2.1µs', client: 'LangChain' },
];

let idCounter = SEED_EVENTS.length;

function getTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function getRandomEvent(): InterceptEvent {
  const base = SEED_EVENTS[Math.floor(Math.random() * SEED_EVENTS.length)];
  return { ...base, id: ++idCounter, time: getTime() };
}

export function MacOSAppShowcase() {
  const [events, setEvents] = useState<InterceptEvent[]>(() =>
    SEED_EVENTS.map((e, i) => ({ ...e, id: i, time: getTime() }))
  );
  const [mode, setMode] = useState<'strict' | 'balanced' | 'audit'>('strict');
  const [blockCount, setBlockCount] = useState(1247);

  // Add new event every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      const newEvent = getRandomEvent();
      if (newEvent.verdict === 'BLOCKED') setBlockCount((c) => c + 1);
      setEvents((prev) => [newEvent, ...prev.slice(0, 7)]);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="lp-section lp-macos-section" id="shield-demo" aria-label="Mastyf Shield Desktop App Demo">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Desktop Appliance</span>
        <h2>Mastyf Shield — Running on Your Machine</h2>
        <p>
          A lightweight, tamper-proof sidecar that intercepts every MCP tool call in sub-microsecond time.
          No cloud. No latency tax. Full local execution.
        </p>
      </div>

      <div className="lp-macos-scene">
        {/* macOS-style window */}
        <div className="lp-macos-window">
          {/* Title bar */}
          <div className="lp-macos-titlebar">
            <div className="lp-macos-traffic-lights">
              <span className="lp-traffic-close" />
              <span className="lp-traffic-minimize" />
              <span className="lp-traffic-maximize" />
            </div>
            <span className="lp-macos-title">Mastyf Shield — Active</span>
            <div className="lp-macos-status">
              <span className="lp-status-beacon" />
              <span className="lp-status-text">Port 4000</span>
            </div>
          </div>

          {/* Menu bar */}
          <div className="lp-macos-menubar">
            <span className="lp-menu-brand">Mastyf Shield</span>
            {['File', 'Policy', 'View', 'Help'].map((item) => (
              <span key={item} className="lp-menu-item">{item}</span>
            ))}
            <div className="lp-menu-spacer" />
            <span className="lp-menu-clients">
              Claude · Cursor · Windsurf
            </span>
          </div>

          {/* Content area */}
          <div className="lp-macos-body">
            {/* Left sidebar */}
            <div className="lp-macos-sidebar">
              <div className="lp-sidebar-section">
                <span className="lp-sidebar-label">POLICY MODE</span>
                {(['strict', 'balanced', 'audit'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`lp-sidebar-mode-btn ${mode === m ? 'active' : ''}`}
                    onClick={() => setMode(m)}
                  >
                    <span className={`lp-mode-dot lp-mode-dot-${m}`} />
                    <span className="lp-mode-label">{m === 'strict' ? 'Zero-Trust' : m === 'balanced' ? 'Balanced' : 'Audit Only'}</span>
                  </button>
                ))}
              </div>

              <div className="lp-sidebar-section">
                <span className="lp-sidebar-label">TODAY</span>
                <div className="lp-sidebar-stat">
                  <span className="lp-stat-num lp-stat-blocked">{blockCount.toLocaleString()}</span>
                  <span className="lp-stat-lbl">Threats blocked</span>
                </div>
                <div className="lp-sidebar-stat">
                  <span className="lp-stat-num lp-stat-allowed">8,291</span>
                  <span className="lp-stat-lbl">Calls allowed</span>
                </div>
              </div>

              <div className="lp-sidebar-section">
                <span className="lp-sidebar-label">LATENCY</span>
                <div className="lp-sidebar-stat">
                  <span className="lp-stat-num lp-stat-latency">1.9µs</span>
                  <span className="lp-stat-lbl">Avg fast-path</span>
                </div>
              </div>
            </div>

            {/* Main log */}
            <div className="lp-macos-log">
              <div className="lp-log-header">
                <span className="lp-log-title">LIVE INTERCEPT LOG</span>
                <span className="lp-log-avg">avg {events[0]?.latency ?? '1.9µs'}</span>
              </div>
              <div className="lp-log-list">
                {events.slice(0, 7).map((event) => (
                  <div
                    key={event.id}
                    className={`lp-log-row ${event.verdict === 'BLOCKED' ? 'lp-log-blocked' : 'lp-log-allowed'}`}
                  >
                    <span className="lp-log-verdict">
                      {event.verdict === 'BLOCKED' ? '⛔' : '✓'}
                    </span>
                    <span className="lp-log-time">{event.time}</span>
                    <span className="lp-log-tool">{event.tool}</span>
                    <span className="lp-log-gate">{event.gate}</span>
                    <span className="lp-log-lat">{event.latency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Glow behind window */}
        <div className="lp-macos-glow" aria-hidden="true" />
      </div>
    </section>
  );
}
