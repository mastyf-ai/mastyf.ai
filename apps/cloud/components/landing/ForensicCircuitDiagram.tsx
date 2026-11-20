'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { HF_MODEL_URL } from '@/lib/product-links';
import { Shield, Cpu, Activity, Lock, ArrowRight, Zap, CheckCircle2, ChevronRight, ExternalLink } from 'lucide-react';

interface Gate {
  id: number;
  label: string;
  name: string;
  latency: string;
  catchRate: string;
  accentHex: string;
  description: string;
  example: string;
  status: 'PASS' | 'BLOCK';
}

const GATES: Gate[] = [
  {
    id: 1,
    label: 'GATE 1',
    name: 'Schema Sanity',
    latency: '0.6µs',
    catchRate: '100%',
    accentHex: '#22d3ee',
    description: 'Validates tool name and argument JSON structures against pre-compiled AST schemas. Drops malformed, oversized, or structurally invalid payloads in under 1 microsecond — no LLM required.',
    example: '{ "tool": "fs.read", "args": { "path": "../../etc/shadow" } } → Schema reject: path traversal pattern',
    status: 'BLOCK',
  },
  {
    id: 2,
    label: 'GATE 2',
    name: 'CBAC Invariants',
    latency: '<4.8µs',
    catchRate: '99.6%',
    accentHex: '#f59e0b',
    description: 'Evaluates 4 deterministic relational constraints: destination containment, scope boundedness, privilege monotonicity, and monetary clamping. No LLM calls — pure relational logic.',
    example: 'stripe.charge({ amount: 99999 }) → CBAC reject: monetary_clamp_exceeded (limit: $500)',
    status: 'BLOCK',
  },
  {
    id: 3,
    label: 'GATE 3',
    name: 'DIFC Taint Flow',
    latency: 'Realtime',
    catchRate: '100%',
    accentHex: '#ef4444',
    description: 'Taints data ingested from third-party documents, emails, or web pages. Strictly forbids tainted tokens from flowing into privileged sinks (exec, network, DB). Catches indirect injections invisible to Gates 1-2.',
    example: 'email.read() → tainted buffer → shell.exec() → DIFC reject: tainted→sink flow prohibited',
    status: 'BLOCK',
  },
  {
    id: 4,
    label: 'GATE 4',
    name: 'Mastyf Guard',
    latency: '1.5B INT4',
    catchRate: 'Revoke-only',
    accentHex: '#10b981',
    description: 'Subordinate neural checkpoint. Per Theorem 2 of the formal monograph: Guard can revoke or escalate permissions, but it can never synthesize new permissions or grant capability above the policy ceiling.',
    example: 'Ambiguous tool call → Guard 1.5B evaluates semantic intent → confidence < threshold → escalate to human',
    status: 'PASS',
  },
];

const PRODUCTS = [
  {
    tag: '1. APPLIANCE & SIDECAR',
    name: 'Mastyf Shield',
    tagColor: 'text-cyan-400',
    desc: 'Runs as a tamper-proof sidecar on your developer workstation. Zero-cloud, zero-latency, zero-byte wire isolation.',
    href: '/download',
    cta: 'Download Shield',
  },
  {
    tag: '2. RUNTIME REVERSE PROXY',
    name: 'Mastyf Gateway',
    tagColor: 'text-amber-400',
    desc: 'High-throughput fail-closed reverse proxy for MCP JSON-RPC, stdio, and HTTP. >330k req/s, sub-ms overhead.',
    href: '/developers',
    cta: 'Gateway Docs',
  },
  {
    tag: '3. ADVERSARIAL CI/CD',
    name: 'Mastyf Swarm',
    tagColor: 'text-purple-400',
    desc: "Stress-tests your agent's execution boundary with 4,216 multi-turn InjecAgent jailbreak vectors before deployment.",
    href: '/docs/how-it-works#components',
    cta: 'Run in CI',
  },
  {
    tag: '4. MCP SUPPLY CHAIN',
    name: 'Mastyf Trust',
    tagColor: 'text-emerald-400',
    desc: 'Static AST scanner and behavioral registry for MCP servers. Certified badges, CVE severity index, permission fingerprinting.',
    href: '/trust',
    cta: 'Lookup Trust Score',
  },
  {
    tag: '5. ENTERPRISE FLEET',
    name: 'Control Plane',
    tagColor: 'text-blue-400',
    desc: 'Centralized fleet governance: Ed25519 signed audit trails, YAML policy distribution, SIEM forwarding, SSO. SOC2/ISO27001-ready.',
    href: '/pricing',
    cta: 'Deploy Control Plane',
  },
];

export function ForensicCircuitDiagram() {
  const [activeGate, setActiveGate] = useState<number>(1);
  const gate = GATES[activeGate - 1];

  return (
    <section className="relative py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" id="platform-ecosystem">
      {/* Section Header */}
      <div className="max-w-3xl mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-semibold uppercase tracking-wider mb-4">
          The 4-Gate Execution Perimeter
        </div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-5 leading-tight">
          Hardware-grade security <br />
          <span className="bg-gradient-to-r from-cyan-300 via-amber-300 to-emerald-300 bg-clip-text text-transparent">
            without the execution overhead.
          </span>
        </h2>
        <p className="text-base sm:text-lg text-slate-300 leading-relaxed">
          Inspired by formal capability-mediated perimeters and fail-closed reference monitors.
          Pre-dispatch deterministic evaluation guarantees that prohibited calls are severed before entering the network.
        </p>
      </div>

      {/* 4-Gate Interactive Pipeline */}
      <div className="rounded-3xl bg-[#080d1a]/90 backdrop-blur-2xl border border-white/[0.1] p-6 sm:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.7)] mb-16">
        {/* Gate Selection Tabs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {GATES.map((g) => {
            const isActive = activeGate === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGate(g.id)}
                className={`relative flex flex-col p-4 rounded-2xl border text-left transition-all ${
                  isActive
                    ? 'bg-white/[0.08] border-amber-400/40 shadow-[0_0_20px_rgba(245,158,11,0.15)] ring-1 ring-amber-400/30'
                    : 'bg-black/30 border-white/[0.06] hover:bg-white/[0.04] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
                    {g.label}
                  </span>
                  <span className="text-[10px] font-mono text-cyan-300 font-semibold bg-cyan-400/10 px-1.5 py-0.5 rounded">
                    {g.latency}
                  </span>
                </div>
                <span className="text-sm font-bold text-white mb-1">{g.name}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {g.status === 'BLOCK' ? 'Fail-Closed Intercept' : 'Neural Checkpoint'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Gate Detail Card */}
        <div className="rounded-2xl bg-black/50 border border-white/[0.08] p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/[0.08] mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                  {gate.label}
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-white">{gate.name}</h3>
              </div>
              <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
                {gate.description}
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0 font-mono text-xs">
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-center min-w-[100px]">
                <div className="text-amber-400 font-bold text-base">{gate.latency}</div>
                <div className="text-slate-400 text-[10px]">Overhead</div>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-center min-w-[100px]">
                <div className="text-emerald-400 font-bold text-base">{gate.catchRate}</div>
                <div className="text-slate-400 text-[10px]">Efficacy</div>
              </div>
            </div>
          </div>

          {/* Example Code Trace */}
          <div className="font-mono text-xs bg-[#04060d] p-4 rounded-xl border border-white/[0.06] text-slate-300">
            <span className="text-slate-500"># Live Evaluation Trace:</span>
            <div className="text-cyan-300 mt-1 select-all">{gate.example}</div>
          </div>
        </div>
      </div>

      {/* 5 Ecosystem Product Pillars */}
      <div>
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h3 className="text-2xl font-bold text-white mb-2">5-Layer Defense Ecosystem</h3>
          <p className="text-sm text-slate-400">
            Deploy individually or as a unified platform across your AI agent stack.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {PRODUCTS.map((prod) => (
            <div
              key={prod.name}
              className="flex flex-col justify-between p-5 rounded-2xl bg-[#080d1a]/80 hover:bg-[#0c1326]/90 border border-white/[0.08] hover:border-amber-400/30 transition-all duration-300"
            >
              <div>
                <span className={`text-[10px] font-mono font-bold tracking-wider uppercase block mb-2 ${prod.tagColor}`}>
                  {prod.tag}
                </span>
                <h4 className="text-base font-bold text-white mb-2">{prod.name}</h4>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  {prod.desc}
                </p>
              </div>

              <Link
                href={prod.href}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 pt-3 border-t border-white/[0.06] transition-colors"
              >
                <span>{prod.cta}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
