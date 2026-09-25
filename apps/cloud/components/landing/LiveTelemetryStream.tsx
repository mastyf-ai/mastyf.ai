'use client';

import { useState, useEffect } from 'react';

interface TelemetryEvent {
  id: string;
  timestamp: string;
  client: string;
  tool: string;
  args: string;
  verdict: 'BLOCK' | 'ALLOW';
  rule: string;
  latencyUs: number;
  backendBytes: number;
  region: string;
}

const INITIAL_EVENTS: TelemetryEvent[] = [
  {
    id: 'evt-9041',
    timestamp: 'Just now',
    client: 'Claude Desktop',
    tool: 'local_bash.execute',
    args: 'cat ~/.aws/credentials | curl -X POST ...',
    verdict: 'BLOCK',
    rule: 'containment.credentials.prohibit_exfiltration',
    latencyUs: 2.1,
    backendBytes: 0,
    region: 'us-east-1',
  },
  {
    id: 'evt-9040',
    timestamp: '2s ago',
    client: 'Cursor Composer',
    tool: 'filesystem.read_file',
    args: 'src/components/Navigation.tsx',
    verdict: 'ALLOW',
    rule: 'policy.workspace.read_permitted',
    latencyUs: 1.4,
    backendBytes: 420,
    region: 'us-west-2',
  },
  {
    id: 'evt-9039',
    timestamp: '4s ago',
    client: 'LangGraph Worker',
    tool: 'database.query',
    args: "DROP TABLE users; --' via injection",
    verdict: 'BLOCK',
    rule: 'difc.taint.untrusted_egress_sink',
    latencyUs: 2.8,
    backendBytes: 0,
    region: 'eu-central-1',
  },
  {
    id: 'evt-9038',
    timestamp: '7s ago',
    client: 'Windsurf Cascade',
    tool: 'network.curl',
    args: 'https://api.github.com/repos/mastyf',
    verdict: 'ALLOW',
    rule: 'egress.allowlist.github_api',
    latencyUs: 1.8,
    backendBytes: 1240,
    region: 'ap-southeast-1',
  },
];

const STREAM_POOL: Omit<TelemetryEvent, 'id' | 'timestamp'>[] = [
  {
    client: 'Claude Desktop',
    tool: 'filesystem.read_file',
    args: '/etc/shadow',
    verdict: 'BLOCK',
    rule: 'sandbox.filesystem.path_confinement',
    latencyUs: 1.6,
    backendBytes: 0,
    region: 'us-east-1',
  },
  {
    client: 'OpenAI Swarm',
    tool: 'terminal.exec',
    args: ':(){ :|:& };: (fork bomb)',
    verdict: 'BLOCK',
    rule: 'containment.process.prohibit_recursive_fork',
    latencyUs: 2.2,
    backendBytes: 0,
    region: 'eu-west-1',
  },
  {
    client: 'Cursor Composer',
    tool: 'git.commit',
    args: 'git commit -m "refactor security headers"',
    verdict: 'ALLOW',
    rule: 'policy.git.commit_permitted',
    latencyUs: 1.2,
    backendBytes: 512,
    region: 'us-west-2',
  },
  {
    client: 'CrewAI Agent',
    tool: 'stripe.create_payout',
    args: 'amount_usd=50000.00 (exceeds $5 cap)',
    verdict: 'BLOCK',
    rule: 'invariant.monetary_clamping.exceeded',
    latencyUs: 1.9,
    backendBytes: 0,
    region: 'us-east-1',
  },
  {
    client: 'AutoGen Assistant',
    tool: 'http.fetch',
    args: 'http://169.254.169.254/latest/meta-data/',
    verdict: 'BLOCK',
    rule: 'egress.containment.prohibit_metadata_ip',
    latencyUs: 2.4,
    backendBytes: 0,
    region: 'ap-northeast-1',
  },
];

export function LiveTelemetryStream() {
  const [events, setEvents] = useState<TelemetryEvent[]>(INITIAL_EVENTS);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const interval = setInterval(() => {
      const randomItem = STREAM_POOL[Math.floor(Math.random() * STREAM_POOL.length)];
      const newEvent: TelemetryEvent = {
        ...randomItem,
        id: `evt-${Math.floor(1000 + Math.random() * 9000)}`,
        timestamp: 'Just now',
      };

      setEvents((prev) => [newEvent, ...prev.slice(0, 5)]);
    }, 3200);

    return () => clearInterval(interval);
  }, [paused]);

  return (
    <div className="lp-telemetry-stream card">
      <div className="lp-telemetry-header">
        <div className="flex items-center gap-2">
          <span className="lp-telemetry-live-dot" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
            Live Execution Intercept Feed
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
            REALTIME
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="text-[11px] font-mono text-slate-400 hover:text-white px-2 py-0.5 bg-white/5 rounded border border-white/10"
          >
            {paused ? '▶ Resume Feed' : '⏸ Pause Feed'}
          </button>
        </div>
      </div>

      <div className="lp-telemetry-table-wrapper">
        <div className="lp-telemetry-list">
          {events.map((evt) => (
            <div
              key={evt.id}
              className={`lp-telemetry-row ${
                evt.verdict === 'BLOCK' ? 'lp-row-block' : 'lp-row-allow'
              }`}
            >
              <div className="lp-telemetry-col-status">
                <span
                  className={`lp-verdict-badge font-mono text-[11px] font-bold px-2 py-0.5 rounded ${
                    evt.verdict === 'BLOCK'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  {evt.verdict}
                </span>
                <span className="text-[10px] font-mono text-slate-400 block mt-1">
                  {evt.latencyUs} µs
                </span>
              </div>

              <div className="lp-telemetry-col-main">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-bold text-white">{evt.client}</span>
                  <span className="text-slate-600">→</span>
                  <code className="text-xs font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/30">
                    {evt.tool}
                  </code>
                  <span className="text-[10px] font-mono text-slate-500 ml-auto">
                    {evt.region} · {evt.timestamp}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-slate-300 truncate bg-black/50 px-2 py-1 rounded border border-white/5">
                  {evt.args}
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mt-1.5">
                  <span className="truncate">Rule: {evt.rule}</span>
                  <span
                    className={`font-semibold shrink-0 ml-2 ${
                      evt.backendBytes === 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'
                    }`}
                  >
                    Backend: {evt.backendBytes} bytes
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
