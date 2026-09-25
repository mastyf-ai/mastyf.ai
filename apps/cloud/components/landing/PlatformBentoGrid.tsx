'use client';

import Link from 'next/link';
import { useState, useRef, useCallback } from 'react';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import { HF_MODEL_URL } from '@/lib/product-links';

function useBentoSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);
  return { ref, onMouseMove };
}

export function PlatformBentoGrid() {
  const [activeGate, setActiveGate] = useState<number>(1);
  const card1 = useBentoSpotlight();
  const card2 = useBentoSpotlight();
  const card3 = useBentoSpotlight();
  const card4 = useBentoSpotlight();
  const card5 = useBentoSpotlight();

  return (
    <section className="lp-section lp-bento-section" id="platform-ecosystem">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Unified Defense Ecosystem</span>
        <h2>The 5 Pillars of Mastyf Agent Security</h2>
        <p>
          Inspired by hardware reference monitors and fail-closed security perimeters.
          From developer desktop sidecars to enterprise cloud fleet governance.
        </p>
      </div>

      <div className="lp-bento-grid">
        {/* Card 1: Mastyf Shield (Span 2) */}
        <div ref={card1.ref} onMouseMove={card1.onMouseMove} className="lp-bento-card lp-bento-span-2 lp-bento-shield">
          <div className="lp-border-beam" />
          <div className="lp-bento-content">
            <div className="lp-bento-tag-row">
              <span className="lp-pill text-xs font-mono text-cyan-400 border-cyan-500/30 bg-cyan-950/40">
                1. APPLIANCE &amp; SIDECAR
              </span>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                Zero-Byte Wire Isolation
              </span>
            </div>

            <h3 className="text-xl font-bold text-white mt-3 mb-2">
              Mastyf Shield: Hardware-Grade Reference Monitor
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed max-w-xl mb-4">
              Runs as a lightweight, tamper-proof sidecar alongside your agent processes. Evaluates every
              tool invocation across 4 deterministic gates in &lt;4.8µs. If any check fails, the transport wire
              is severed before a single byte reaches the backend.
            </p>

            {/* Interactive mini-HUD */}
            <div className="lp-bento-mini-hud">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setActiveGate(1)}
                  className={`lp-hud-gate-chip ${activeGate === 1 ? 'active' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 font-mono">GATE 1</span>
                  <span className="text-xs font-bold text-white">Schema Sanity</span>
                  <span className="text-[10px] text-cyan-400 font-mono">0.6 µs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGate(2)}
                  className={`lp-hud-gate-chip ${activeGate === 2 ? 'active' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 font-mono">GATE 2</span>
                  <span className="text-xs font-bold text-white">CBAC Invariants</span>
                  <span className="text-[10px] text-emerald-400 font-mono">&lt;4.8 µs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGate(3)}
                  className={`lp-hud-gate-chip ${activeGate === 3 ? 'active' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 font-mono">GATE 3</span>
                  <span className="text-xs font-bold text-white">DIFC Taint Flow</span>
                  <span className="text-[10px] text-amber-400 font-mono">Realtime</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveGate(4)}
                  className={`lp-hud-gate-chip ${activeGate === 4 ? 'active' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 font-mono">GATE 4</span>
                  <span className="text-xs font-bold text-white">Mastyf Guard</span>
                  <span className="text-[10px] text-slate-300 font-mono">1.5B (CPU)</span>
                </button>
              </div>

              <div className="lp-bento-gate-detail">
                {activeGate === 1 && (
                  <p className="text-xs text-slate-300 font-mono m-0">
                    <strong>Gate 1 (Schema &amp; Parse Clamping):</strong> Validates tool name and argument JSON structures against pre-compiled AST schemas. Drops malformed or oversized payloads in under 1 microsecond.
                  </p>
                )}
                {activeGate === 2 && (
                  <p className="text-xs text-slate-300 font-mono m-0">
                    <strong>Gate 2 (Deterministic CBAC Invariants):</strong> Evaluates 4 relational argument constraints: destination containment, scope boundedness, privilege monotonicity, and monetary clamping.
                  </p>
                )}
                {activeGate === 3 && (
                  <p className="text-xs text-slate-300 font-mono m-0">
                    <strong>Gate 3 (Dynamic Information Flow Control):</strong> Taints data ingested from third-party documents, emails, or web pages; strictly forbids tainted tokens from flowing into privileged sinks.
                  </p>
                )}
                {activeGate === 4 && (
                  <p className="text-xs text-slate-300 font-mono m-0">
                    <strong>Gate 4 (Subordinate Learned Authority):</strong> Evaluates Mastyf Guard 1.5B INT4 neural checkpoint. Per Theorem 2, it can revoke or escalate, but can never synthesize or grant permission.
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <Link href="/download" className="btn btn-primary btn-sm btn-pill font-bold shadow-md shadow-amber-500/20">
                Download Mastyf Shield (Mac, Windows, Linux) →
              </Link>
              <a
                href={HF_MODEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm btn-pill"
              >
                Gated 1.5B Weights ↗
              </a>
            </div>
          </div>
        </div>

        {/* Card 2: Mastyf Gateway (Span 1) */}
        <div ref={card2.ref} onMouseMove={card2.onMouseMove} className="lp-bento-card lp-bento-gateway">
          <div className="lp-bento-content">
            <div className="lp-bento-tag-row">
              <span className="lp-pill text-xs font-mono text-amber-400 border-amber-500/30 bg-amber-950/40">
                2. RUNTIME REVERSE PROXY
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mt-3 mb-2">
              Mastyf Gateway
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              High-throughput fail-closed reverse proxy for MCP JSON-RPC, stdio, and HTTP tool calls.
              Processes &gt;330,000 requests/sec with sub-millisecond overhead.
            </p>

            <div className="lp-bento-badge-list">
              <span className="lp-mini-tag">MCP stdio &amp; HTTP</span>
              <span className="lp-mini-tag">Relational Invariants</span>
              <span className="lp-mini-tag">&gt;330k req/s Fast-Path</span>
              <span className="lp-mini-tag">Audit or Enforce Mode</span>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5">
              <Link href="/developers" className="text-xs text-amber-400 font-semibold hover:underline">
                Explore Gateway Docs →
              </Link>
            </div>
          </div>
        </div>

        {/* Card 3: Mastyf Swarm (Span 1) */}
        <div ref={card3.ref} onMouseMove={card3.onMouseMove} className="lp-bento-card lp-bento-swarm">
          <div className="lp-bento-content">
            <div className="lp-bento-tag-row">
              <span className="lp-pill text-xs font-mono text-purple-400 border-purple-500/30 bg-purple-950/40">
                3. ADVERSARIAL CI / CD
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mt-3 mb-2">
              Mastyf Swarm
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              Automated adversarial runner that stress-tests your agent’s execution boundary before deployment
              using thousands of multi-turn jailbreak and indirect injection vectors.
            </p>

            <div className="lp-bento-badge-list">
              <span className="lp-mini-tag">4,216 InjecAgent Tests</span>
              <span className="lp-mini-tag">Adaptive White-Box Red Team</span>
              <span className="lp-mini-tag">GitHub Actions CI Runner</span>
              <span className="lp-mini-tag">Automated Regression Gates</span>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5">
              <Link href="/platform#swarm" className="text-xs text-purple-400 font-semibold hover:underline">
                Run Swarm in CI →
              </Link>
            </div>
          </div>
        </div>

        {/* Card 4: Mastyf Trust (Span 1) */}
        <div ref={card4.ref} onMouseMove={card4.onMouseMove} className="lp-bento-card lp-bento-trust">
          <div className="lp-bento-content">
            <div className="lp-bento-tag-row">
              <span className="lp-pill text-xs font-mono text-emerald-400 border-emerald-500/30 bg-emerald-950/40">
                4. MCP SUPPLY CHAIN
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mt-3 mb-2">
              Mastyf Trust
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              Static vulnerability scanner and behavioral registry for Model Context Protocol (MCP) servers.
              Detects excessive permissions, environment leaks, and known CVEs.
            </p>

            <div className="lp-bento-badge-list">
              <span className="lp-mini-tag">Static AST Analysis</span>
              <span className="lp-mini-tag">Permission Fingerprinting</span>
              <span className="lp-mini-tag">Certified MCP Badges</span>
              <span className="lp-mini-tag">CVE Severity Index</span>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5">
              <Link href="/trust" className="text-xs text-emerald-400 font-semibold hover:underline">
                Lookup MCP Server Trust →
              </Link>
            </div>
          </div>
        </div>

        {/* Card 5: Mastyf Control Plane (Span 2) */}
        <div ref={card5.ref} onMouseMove={card5.onMouseMove} className="lp-bento-card lp-bento-span-2 lp-bento-control-plane">
          <div className="lp-bento-content">
            <div className="lp-bento-tag-row">
              <span className="lp-pill text-xs font-mono text-blue-400 border-blue-500/30 bg-blue-950/40">
                5. ENTERPRISE FLEET GOVERNANCE
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-900/60 border border-slate-700/50 px-2 py-0.5 rounded-full">
                SOC2 · ISO 27001 Ready
              </span>
            </div>
            <h3 className="text-xl font-bold text-white mt-3 mb-2">
              Mastyf Control Plane: Enterprise Fleet Security &amp; Audit
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed max-w-xl mb-4">
              Centralized dashboard and policy distribution network for enterprise agent deployments.
              Distribute signed YAML policies across thousands of agent runners, verify Ed25519 tamper-proof
              audit trails, and stream events to your SIEM.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                <span className="text-[10px] text-slate-400 font-mono block">CRYPTOGRAPHIC AUDIT</span>
                <span className="text-xs font-bold text-white block mt-1">Ed25519 Signed Receipts</span>
                <span className="text-[10px] text-cyan-400 font-mono block mt-1 truncate">rcpt_msh_89f02c91a0...</span>
              </div>
              <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                <span className="text-[10px] text-slate-400 font-mono block">ENTERPRISE TELEMETRY</span>
                <span className="text-xs font-bold text-white block mt-1">Real-time SIEM Forwarding</span>
                <span className="text-[10px] text-slate-400 font-mono block mt-1">Datadog, Splunk, S3</span>
              </div>
              <div className="p-3 bg-black/40 rounded-lg border border-white/5">
                <span className="text-[10px] text-slate-400 font-mono block">IDENTITY &amp; RBAC</span>
                <span className="text-xs font-bold text-white block mt-1">SSO &amp; Team Workspaces</span>
                <span className="text-[10px] text-emerald-400 font-mono block mt-1">Google &amp; GitHub OAuth</span>
              </div>
            </div>

            <div className="flex gap-3">
              <Link href="/pricing" className="btn btn-primary btn-sm btn-pill font-bold">
                Deploy Control Plane →
              </Link>
              <Link href="/solutions" className="btn btn-secondary btn-sm btn-pill">
                Enterprise Overview
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
