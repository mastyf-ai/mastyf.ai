'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { DynamicBackground } from '@/components/landing/DynamicBackground';
import '../landing.css';

export default function AssessmentPage() {
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({
    toolInterface: '',
    permissions: [] as string[],
    untrustedSources: [] as string[],
    currentGuardrail: '',
    adversarialTesting: '',
  });

  const [submitted, setSubmitted] = useState(false);

  const togglePermission = (perm: string) => {
    setAnswers((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const toggleSource = (src: string) => {
    setAnswers((prev) => ({
      ...prev,
      untrustedSources: prev.untrustedSources.includes(src)
        ? prev.untrustedSources.filter((s) => s !== src)
        : [...prev.untrustedSources, src],
    }));
  };

  const calculateRisk = () => {
    let score = 0;
    if (answers.permissions.includes('shell') || answers.permissions.includes('finance')) score += 3;
    if (answers.permissions.includes('db_write') || answers.permissions.includes('file_write')) score += 2;
    if (answers.untrustedSources.length >= 2) score += 2;
    if (answers.currentGuardrail === 'prompts' || answers.currentGuardrail === 'none') score += 3;
    if (answers.adversarialTesting === 'none') score += 2;

    if (score >= 7) return { level: 'CRITICAL EXPOSURE', color: 'text-red-400', badge: 'bg-red-950/60 border-red-500/50' };
    if (score >= 4) return { level: 'HIGH EXPOSURE', color: 'text-amber-400', badge: 'bg-amber-950/60 border-amber-500/50' };
    return { level: 'MODERATE EXPOSURE', color: 'text-yellow-300', badge: 'bg-yellow-950/60 border-yellow-500/50' };
  };

  const risk = calculateRisk();

  return (
    <div className="landing">
      <DynamicBackground />
      <SiteNav session={false} />
      <main className="pt-24 pb-16">
        <div className="lp-section">
          <div className="lp-section-header">
            <span className="lp-pill lp-pill-gold">Interactive Security Diagnostic</span>
            <h1>AI Agent Exposure &amp; Vulnerability Assessment</h1>
            <p>
              Answer 5 quick questions to evaluate your agent&rsquo;s execution blast radius and identify missing security perimeters.
            </p>
          </div>

          {!submitted ? (
            <div className="card max-w-2xl mx-auto p-8 my-8">
              {step === 1 && (
                <div>
                  <span className="text-xs font-bold text-amber-400 block mb-2">QUESTION 1 OF 5</span>
                  <h3 className="text-xl font-bold text-white mb-4">
                    How does your agent interact with external tools?
                  </h3>
                  <div className="flex flex-col gap-3">
                    {[
                      { id: 'mcp', label: 'Model Context Protocol (MCP) Servers' },
                      { id: 'functions', label: 'Direct Function Calling (OpenAI / Anthropic API)' },
                      { id: 'custom_rest', label: 'Custom HTTP / REST API Integrations' },
                      { id: 'cli_shell', label: 'Direct Shell / Terminal Subprocesses' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAnswers((prev) => ({ ...prev, toolInterface: opt.id }));
                          setStep(2);
                        }}
                        className={`text-left p-4 rounded-lg border text-sm font-medium transition-all ${
                          answers.toolInterface === opt.id
                            ? 'bg-amber-400/15 border-amber-400 text-white'
                            : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <span className="text-xs font-bold text-amber-400 block mb-2">QUESTION 2 OF 5</span>
                  <h3 className="text-xl font-bold text-white mb-4">
                    What privileged capabilities can your agent execute? (Select all that apply)
                  </h3>
                  <div className="flex flex-col gap-3 mb-6">
                    {[
                      { id: 'file_read', label: 'Local File System Reads' },
                      { id: 'file_write', label: 'Local File System Writes / Deletions' },
                      { id: 'db_write', label: 'Database Modifications / SQL Queries' },
                      { id: 'shell', label: 'Terminal / Shell Command Execution' },
                      { id: 'finance', label: 'Financial Transactions / API Payments' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => togglePermission(opt.id)}
                        className={`text-left p-4 rounded-lg border text-sm font-medium transition-all ${
                          answers.permissions.includes(opt.id)
                            ? 'bg-amber-400/15 border-amber-400 text-white'
                            : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {answers.permissions.includes(opt.id) ? '✓ ' : '○ '}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={answers.permissions.length === 0}
                    className="btn btn-primary btn-pill w-full"
                  >
                    Next Question →
                  </button>
                </div>
              )}

              {step === 3 && (
                <div>
                  <span className="text-xs font-bold text-amber-400 block mb-2">QUESTION 3 OF 5</span>
                  <h3 className="text-xl font-bold text-white mb-4">
                    Where does untrusted data enter the agent&rsquo;s context window?
                  </h3>
                  <div className="flex flex-col gap-3 mb-6">
                    {[
                      { id: 'web', label: 'Web Scraping / Search Engine Results' },
                      { id: 'email', label: 'Customer Emails / Chat Messages' },
                      { id: 'docs', label: 'Uploaded User Documents (PDFs, Markdown)' },
                      { id: 'apis', label: 'External 3rd-Party APIs / Webhooks' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleSource(opt.id)}
                        className={`text-left p-4 rounded-lg border text-sm font-medium transition-all ${
                          answers.untrustedSources.includes(opt.id)
                            ? 'bg-amber-400/15 border-amber-400 text-white'
                            : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {answers.untrustedSources.includes(opt.id) ? '✓ ' : '○ '}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(4)}
                    disabled={answers.untrustedSources.length === 0}
                    className="btn btn-primary btn-pill w-full"
                  >
                    Next Question →
                  </button>
                </div>
              )}

              {step === 4 && (
                <div>
                  <span className="text-xs font-bold text-amber-400 block mb-2">QUESTION 4 OF 5</span>
                  <h3 className="text-xl font-bold text-white mb-4">
                    How do you currently prevent unauthorized tool actions?
                  </h3>
                  <div className="flex flex-col gap-3">
                    {[
                      { id: 'prompts', label: 'Prompt System Instructions ("Do not run dangerous tools")' },
                      { id: 'guardrails', label: 'In-Band Conversational LLM Guardrails (Llama Guard, NeMo)' },
                      { id: 'manual', label: 'Manual Human-in-the-Loop Confirmation for Every Call' },
                      { id: 'none', label: 'No Formal Enforcement (Ambient Authority)' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAnswers((prev) => ({ ...prev, currentGuardrail: opt.id }));
                          setStep(5);
                        }}
                        className={`text-left p-4 rounded-lg border text-sm font-medium transition-all ${
                          answers.currentGuardrail === opt.id
                            ? 'bg-amber-400/15 border-amber-400 text-white'
                            : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div>
                  <span className="text-xs font-bold text-amber-400 block mb-2">QUESTION 5 OF 5</span>
                  <h3 className="text-xl font-bold text-white mb-4">
                    Do you run automated adversarial red-teaming in CI/CD?
                  </h3>
                  <div className="flex flex-col gap-3 mb-6">
                    {[
                      { id: 'automated', label: 'Yes — Automated injection test suites on every build' },
                      { id: 'manual', label: 'Occasionally — Periodic manual penetration testing' },
                      { id: 'none', label: 'No — We have no automated adversarial testing' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAnswers((prev) => ({ ...prev, adversarialTesting: opt.id }));
                          setSubmitted(true);
                        }}
                        className="text-left p-4 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 text-sm font-medium hover:border-amber-400 transition-all"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card max-w-2xl mx-auto p-8 my-8 text-center animate-fade-in">
              <div className={`inline-block px-4 py-1.5 rounded-full border text-xs font-extrabold tracking-widest uppercase mb-4 ${risk.badge} ${risk.color}`}>
                {risk.level}
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">Your Agent Risk Profile</h2>
              <p className="text-sm muted mb-6">
                Your agent operates with ambient authority over privileged resources without an independent execution-boundary reference monitor.
              </p>

              <div className="text-left bg-slate-950/70 p-6 rounded-xl border border-slate-800 mb-6 flex flex-col gap-3 text-xs">
                <div className="text-slate-300">
                  <strong className="text-red-400">Critical Finding:</strong> In-band prompt instructions provide zero structural protection against Confused Deputy attacks when untrusted third-party inputs are ingested.
                </div>
                <div className="text-slate-300">
                  <strong className="text-amber-400">Missing Invariant:</strong> Complete Mediation (Axiom A1) is unverified — model output directly triggers backend tool dispatch without out-of-band authorization.
                </div>
                <div className="text-slate-300">
                  <strong className="text-emerald-400">Recommended Architecture:</strong> Deploy Mastyf Gateway in Audit Mode to observe tool calls, then enforce CBAC &amp; DIFC invariants before production dispatch.
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/pilot" className="btn btn-primary btn-pill">
                  Request 30-Day Guided Pilot →
                </Link>
                <Link href="/developers" className="btn btn-secondary btn-pill">
                  Install Open-Source Gateway
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
