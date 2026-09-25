'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  HF_MODEL_URL,
  PAPER_PDF_URL,
  PAPER_TITLE,
  ZENODO_DOI,
  ZENODO_URL,
} from '@/lib/product-links';

export function AcademicPaperHero({ standalone = false }: { standalone?: boolean }) {
  const [copiedBibtex, setCopiedBibtex] = useState(false);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [activeTab, setActiveTab] = useState<'abstract' | 'theorems' | 'latex-preview' | 'regimes' | 'bibtex'>('abstract');
  const [activeTheorem, setActiveTheorem] = useState<number>(2);

  const bibtex = `@article{das2026capability,
  title={Capability-Mediated Perimeters for Secure AI Agent Tool Execution: Compositional Authorization and Execution-Certainty Semantics Against Indirect Prompt Injection},
  author={Das, Rudraneel},
  journal={Zenodo Monograph},
  year={2026},
  doi={10.5281/zenodo.22501491},
  url={https://doi.org/10.5281/zenodo.22501491}
}`;

  const copyBibtex = () => {
    navigator.clipboard?.writeText(bibtex);
    setCopiedBibtex(true);
    setTimeout(() => setCopiedBibtex(false), 2000);
  };

  const copyLatex = (latexCode: string) => {
    navigator.clipboard?.writeText(latexCode);
    setCopiedLatex(true);
    setTimeout(() => setCopiedLatex(false), 2000);
  };

  return (
    <div className={`card lp-academic-showcase ${standalone ? 'lp-academic-standalone' : ''}`} id="academic-paper">
      {/* Top Banner */}
      <div className="lp-academic-top-bar">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="lp-pill lp-pill-gold text-xs">Peer-Reviewed Scientific Monograph</span>
          <span className="lp-doi-badge">
            <span className="text-slate-400">DOI:</span>{' '}
            <a
              href={`https://doi.org/${ZENODO_DOI}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              {ZENODO_DOI}
            </a>
          </span>
          <span className="lp-license-badge">CC-BY 4.0 Open Access</span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={PAPER_PDF_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm btn-pill font-bold"
          >
            Download Manuscript (PDF) ↗
          </a>
        </div>
      </div>

      {/* Main Title & Hero Header */}
      <div className="lp-academic-header">
        <span className="text-xs font-mono uppercase tracking-widest text-cyan-400 block mb-2">
          Formal Mathematical Foundation &amp; Execution-Certainty Proofs
        </span>
        <h2 className="lp-academic-main-title">
          Capability-Mediated Perimeters for Secure AI Agent Tool Execution
        </h2>
        <h3 className="lp-academic-subtitle">
          Compositional Authorization and Execution-Certainty Semantics Against Indirect Prompt Injection
        </h3>

        <div className="lp-academic-byline">
          <span className="text-white font-semibold">Rudraneel Das</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">Mastyf.ai, Kolkata, India</span>
          <span className="text-slate-500">·</span>
          <a
            href="https://orcid.org/0009-0009-6173-0262"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 font-mono text-xs hover:underline"
          >
            ORCID: 0009-0009-6173-0262 ↗
          </a>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="lp-academic-tabs">
        <button
          type="button"
          className={`lp-academic-tab-btn ${activeTab === 'abstract' ? 'active' : ''}`}
          onClick={() => setActiveTab('abstract')}
        >
          📄 Executive Abstract
        </button>
        <button
          type="button"
          className={`lp-academic-tab-btn ${activeTab === 'theorems' ? 'active' : ''}`}
          onClick={() => setActiveTab('theorems')}
        >
          📐 Invariants &amp; Theorems
        </button>
        <button
          type="button"
          className={`lp-academic-tab-btn ${activeTab === 'latex-preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('latex-preview')}
        >
          🧮 LaTeX Math &amp; Proofs
        </button>
        <button
          type="button"
          className={`lp-academic-tab-btn ${activeTab === 'regimes' ? 'active' : ''}`}
          onClick={() => setActiveTab('regimes')}
        >
          📊 6-Regime Empirical Results
        </button>
        <button
          type="button"
          className={`lp-academic-tab-btn ${activeTab === 'bibtex' ? 'active' : ''}`}
          onClick={() => setActiveTab('bibtex')}
        >
          📚 Cite / BibTeX
        </button>
      </div>

      {/* Tab 1: Abstract */}
      {activeTab === 'abstract' && (
        <div className="lp-academic-content">
          <div className="lp-abstract-quote">
            <p className="text-slate-300 text-sm leading-relaxed mb-4">
              Autonomous artificial intelligence agents executing over extensible tool interfaces (such as Anthropic’s Model Context Protocol) operate with ambient authority over connected tools. Because autoregressive Transformers ingest instructions and untrusted third-party data within a single homogeneous context window, adversarial observations can manipulate the model into executing unintended privileged actions — the classic <em>Confused Deputy</em> problem.
            </p>
            <p className="text-slate-300 text-sm leading-relaxed mb-4">
              We introduce an architectural perimeter that enforces <strong>complete mediation</strong>, least privilege, four relational argument invariants (destination containment, scope boundedness, privilege monotonicity, and monetary clamping), and execution-certainty semantics. We prove that external capability mediation isolates systems even when the model is completely compromised by indirect injection, formalizing the core invariant:
            </p>
            <div className="text-center my-4">
              <div className="lp-math-display">
                <span className="font-mono text-amber-300 text-base">
                  A<sub>final</sub> = A<sub>struct</sub> ∩ A<sub>semantic</sub> ⊆ A<sub>struct</sub>
                </span>
              </div>
              <span className="block text-[11px] text-slate-400 mt-1">
                Subordinate Learned Authority: Semantic classifiers can revoke or escalate, but can never synthesize or grant permission.
              </span>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed m-0">
              Evaluated across 6 distinct regimes totaling 6,662 instances (including UIUC InjecAgent, AgentDojo, and AI Safety Bench), the integrated perimeter achieves <strong>99.52% defense</strong> on interactive episodes, <strong>98.43% defense</strong> on InjecAgent at 267.7ms CPU latency, and <strong>zero false alarms</strong> on benign workloads.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 mt-6 items-center">
            <a
              href={PAPER_PDF_URL}
              className="btn btn-primary btn-sm btn-pill font-bold"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download Full Manuscript (PDF)
            </a>
            <a
              href={HF_MODEL_URL}
              className="btn btn-secondary btn-sm btn-pill"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hugging Face Model Weights (d59a6aa) ↗
            </a>
            <a
              href={ZENODO_URL}
              className="btn btn-ghost btn-sm btn-pill"
              target="_blank"
              rel="noopener noreferrer"
            >
              Zenodo Record ↗
            </a>
            <button type="button" onClick={copyBibtex} className="btn btn-ghost btn-sm btn-pill">
              {copiedBibtex ? '✓ BibTeX Copied' : 'Copy BibTeX'}
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Theorems */}
      {activeTab === 'theorems' && (
        <div className="lp-academic-content">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-5 bg-black/40 border border-white/5">
              <span className="lp-pill text-xs mb-1 inline-block text-cyan-400">Formal Guarantee</span>
              <h4 className="text-sm font-bold text-white mb-2">Proposition 1: Inductive Composability Invariant</h4>
              <p className="text-xs text-slate-300 font-mono leading-relaxed mb-3">
                Adversarial observations ingested within an autoregressive Transformer context cannot synthesize or escalate authority across arbitrary multi-step execution sequences under Complete Mediation (A1–A6). Any blocked action produces strictly 0 backend bytes.
              </p>
              <div className="lp-math-box">
                <code>∀t ∈ ℕ: Execute(a_t) ≠ ALLOW ⟹ |WireBytes(a_t)| = 0</code>
              </div>
            </div>

            <div className="card p-5 bg-black/40 border border-white/5">
              <span className="lp-pill text-xs mb-1 inline-block text-cyan-400">Relational Invariant</span>
              <h4 className="text-sm font-bold text-white mb-2">Theorem 1: Safety Invariant Preservation</h4>
              <p className="text-xs text-slate-300 font-mono leading-relaxed mb-3">
                If state S_t satisfies the relational argument invariants (destination containment, scope boundedness, privilege monotonicity, and monetary clamping), then state S_t+1 after authorized action execution satisfies the invariants.
              </p>
              <div className="lp-math-box">
                <code>S_t ⊨ ℐ ∧ a_t ∈ A_struct(S_t) ⟹ δ(S_t, a_t) ⊨ ℐ</code>
              </div>
            </div>

            <div className="card p-5 bg-black/40 border border-white/5">
              <span className="lp-pill text-xs mb-1 inline-block text-amber-400">Authority Subordination</span>
              <h4 className="text-sm font-bold text-white mb-2">Theorem 2: Subordinate Learned Semantics</h4>
              <p className="text-xs text-slate-300 font-mono leading-relaxed mb-3">
                A_final = A_struct ∩ A_semantic ⊆ A_struct. Learned neural classifiers (Mastyf Guard 1.5B) can only reduce or restrict authority, and can never grant or synthesize unapproved execution permissions.
              </p>
              <div className="lp-math-box">
                <code>∀a ∉ A_struct ⟹ a ∉ A_final (Zero Learned Privilege Escalation)</code>
              </div>
            </div>

            <div className="card p-5 bg-black/40 border border-white/5">
              <span className="lp-pill text-xs mb-1 inline-block text-amber-400">State Machine Synchronization</span>
              <h4 className="text-sm font-bold text-white mb-2">Theorem 3: Execution-Certainty Non-Advancement</h4>
              <p className="text-xs text-slate-300 font-mono leading-relaxed mb-3">
                For any dependent tool requiring verified prior execution of action a_i: if ExecutionCertainty(a_i) = UNKNOWN, dispatch of dependent action a_j is deterministically rejected.
              </p>
              <div className="lp-math-box">
                <code>Certainty(a_i) = UNKNOWN ⟹ Dispatch(a_j) = ⊥, ∀a_j ≻ a_i</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: LaTeX Math & Proofs Viewer */}
      {activeTab === 'latex-preview' && (
        <div className="lp-academic-content">
          <div className="lp-latex-viewer-header flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                className={`lp-term-tab-btn ${activeTheorem === 2 ? 'active' : ''}`}
                onClick={() => setActiveTheorem(2)}
              >
                Theorem 2 (Subordinate Authority)
              </button>
              <button
                type="button"
                className={`lp-term-tab-btn ${activeTheorem === 1 ? 'active' : ''}`}
                onClick={() => setActiveTheorem(1)}
              >
                Theorem 1 (Invariant Preservation)
              </button>
              <button
                type="button"
                className={`lp-term-tab-btn ${activeTheorem === 3 ? 'active' : ''}`}
                onClick={() => setActiveTheorem(3)}
              >
                Theorem 3 (Execution Certainty)
              </button>
              <button
                type="button"
                className={`lp-term-tab-btn ${activeTheorem === 0 ? 'active' : ''}`}
                onClick={() => setActiveTheorem(0)}
              >
                Proposition 1 (Zero-Byte Wire)
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const codes = [
                  `\\forall t \\in \\mathbb{N}, \\; \\text{Execute}(a_t) \\neq \\text{ALLOW} \\implies |\\text{WireBytes}(a_t)| = 0`,
                  `S_t \\models \\mathcal{I} \\land a_t \\in \\mathcal{A}_{\\text{struct}}(S_t) \\implies \\delta(S_t, a_t) \\models \\mathcal{I}`,
                  `\\mathcal{A}_{\\text{final}} = \\mathcal{A}_{\\text{struct}} \\cap \\mathcal{A}_{\\text{semantic}} \\subseteq \\mathcal{A}_{\\text{struct}}`,
                  `\\text{Certainty}(a_i) = \\text{UNKNOWN} \\implies \\text{Dispatch}(a_j) = \\bot \\quad \\forall a_j \\succ a_i`,
                ];
                copyLatex(codes[activeTheorem]);
              }}
              className="text-xs font-mono text-slate-400 hover:text-white px-2 py-1 bg-white/5 rounded border border-white/10"
            >
              {copiedLatex ? '✓ LaTeX Copied' : 'Copy LaTeX'}
            </button>
          </div>

          <div className="lp-latex-preview-box">
            {activeTheorem === 2 && (
              <div>
                <div className="text-xs font-mono uppercase text-amber-400 mb-2">Theorem 2: Subordinate Learned Authority</div>
                <div className="lp-latex-equation">
                  $$\mathcal&#123;A&#125;_\text&#123;final&#125; = \mathcal&#123;A&#125;_\text&#123;struct&#125; \cap \mathcal&#123;A&#125;_\text&#123;semantic&#125; \subseteq \mathcal&#123;A&#125;_\text&#123;struct&#125;$$
                </div>
                <div className="lp-latex-proof-sketch">
                  <h5 className="text-xs font-bold text-white mb-1">Proof Sketch:</h5>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Let $\mathcal&#123;A&#125;_\text&#123;struct&#125;$ be the set of tool actions permitted by the deterministic capability monitor (Gate 2).
                    Let $\mathcal&#123;A&#125;_\text&#123;semantic&#125;$ be the binary authorization set output by Mastyf Guard 1.5B (Gate 4).
                    By definition of set intersection, for any candidate tool dispatch $a$, if $a \notin \mathcal&#123;A&#125;_\text&#123;struct&#125;$, then $a \notin (\mathcal&#123;A&#125;_\text&#123;struct&#125; \cap \mathcal&#123;A&#125;_\text&#123;semantic&#125;)$.
                    Thus, even if an attacker completely hijacks the neural weights or output logits of the classifier such that $\mathcal&#123;A&#125;_\text&#123;semantic&#125; = \mathcal&#123;U&#125;$ (universal permit), the effective authority cannot exceed $\mathcal&#123;A&#125;_\text&#123;struct&#125;$. Q.E.D.
                  </p>
                </div>
              </div>
            )}

            {activeTheorem === 1 && (
              <div>
                <div className="text-xs font-mono uppercase text-cyan-400 mb-2">Theorem 1: Safety Invariant Preservation</div>
                <div className="lp-latex-equation">
                  $$S_t \models \mathcal&#123;I&#125; \land a_t \in \mathcal&#123;A&#125;_\text&#123;struct&#125;(S_t) \implies \delta(S_t, a_t) \models \mathcal&#123;I&#125;$$
                </div>
                <div className="lp-latex-proof-sketch">
                  <h5 className="text-xs font-bold text-white mb-1">Proof Sketch:</h5>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    The invariant system $\mathcal&#123;I&#125; = \mathcal&#123;I&#125;_\text&#123;contain&#125; \land \mathcal&#123;I&#125;_\text&#123;bound&#125; \land \mathcal&#123;I&#125;_\text&#123;mono&#125; \land \mathcal&#123;I&#125;_\text&#123;clamp&#125;$ is evaluated before dispatch. Destination Containment enforces path canonicalization within the sandbox. Scope Boundedness rejects undeclared verbs. Privilege Monotonicity guarantees $\mathcal&#123;A&#125;_\text&#123;eff&#125;(t+1) \subseteq \mathcal&#123;A&#125;_\text&#123;eff&#125;(t)$. Monetary Clamping enforces total budget $\sum c(a_i) \le B$. By mathematical induction over discrete execution steps $t \in \mathbb&#123;N&#125;$, the system cannot transition into any forbidden state. Q.E.D.
                  </p>
                </div>
              </div>
            )}

            {activeTheorem === 3 && (
              <div>
                <div className="text-xs font-mono uppercase text-amber-400 mb-2">Theorem 3: Execution-Certainty Non-Advancement</div>
                <div className="lp-latex-equation">
                  $$\text&#123;Certainty&#125;(a_i) = \text&#123;UNKNOWN&#125; \implies \text&#123;Dispatch&#125;(a_j) = \bot \quad \forall a_j \succ a_i$$
                </div>
                <div className="lp-latex-proof-sketch">
                  <h5 className="text-xs font-bold text-white mb-1">Proof Sketch:</h5>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Consider an action dependency graph $G = (V, E)$ where $(a_i, a_j) \in E$ denotes that action $a_j$ depends on the verified outcome of $a_i$. If the transport connection or process exits with status $\text&#123;UNKNOWN&#125;$ or ambiguous return tokens, the execution arbiter freezes state advancement and yields $\bot$. Ambient speculative execution is strictly prohibited. Q.E.D.
                  </p>
                </div>
              </div>
            )}

            {activeTheorem === 0 && (
              <div>
                <div className="text-xs font-mono uppercase text-cyan-400 mb-2">Proposition 1: Zero-Byte Physical Wire Isolation</div>
                <div className="lp-latex-equation">
                  $$\forall t \in \mathbb&#123;N&#125;, \; \text&#123;Execute&#125;(a_t) \neq \text&#123;ALLOW&#125; \implies |\text&#123;WireBytes&#125;(a_t)| = 0$$
                </div>
                <div className="lp-latex-proof-sketch">
                  <h5 className="text-xs font-bold text-white mb-1">Proof Sketch:</h5>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Under the fail-closed complete mediation contract, the socket to the backend tool provider is only established upon unanimous positive clearance from Gates 1–4. When an action evaluates to $\text&#123;BLOCK&#125;$ or $\text&#123;ESCALATE&#125;$, the gateway transmits an immediate synthetic error receipt to the client, never opening the outbound socket. Hence zero bytes transit the backend interface. Q.E.D.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Empirical Regimes */}
      {activeTab === 'regimes' && (
        <div className="lp-academic-content">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card p-5 bg-black/40 border border-emerald-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 5: Interactive Episodes</div>
              <div className="text-3xl font-extrabold text-emerald-400 my-1">99.52%</div>
              <div className="text-xs font-bold text-white mb-1">AgentDojo Benchmark (629 episodes)</div>
              <p className="text-[11px] text-slate-400 m-0">
                Full multi-turn interactive environments with exact clean utility parity (6/97).
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-emerald-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 3: Standard Academic</div>
              <div className="text-3xl font-extrabold text-emerald-400 my-1">98.43%</div>
              <div className="text-xs font-bold text-white mb-1">UIUC InjecAgent (4,216 cases)</div>
              <p className="text-[11px] text-slate-400 m-0">
                P50 decision latency of 267.7ms running INT4 AWQ on commodity CPU.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-emerald-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 4: Benign Safety</div>
              <div className="text-3xl font-extrabold text-emerald-400 my-1">0.00%</div>
              <div className="text-xs font-bold text-white mb-1">False Alarm Rate (1,000 cases)</div>
              <p className="text-[11px] text-slate-400 m-0">
                AI Safety Bench evaluation confirmed zero false positives on benign developer tool actions.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-cyan-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 1: Synthetic Holdouts</div>
              <div className="text-3xl font-extrabold text-cyan-400 my-1">100%</div>
              <div className="text-xs font-bold text-white mb-1">Factorized Diagnostics (145 cases)</div>
              <p className="text-[11px] text-slate-400 m-0">
                Comprehensive in-scope parameter poisoning contrastive boundary tests.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-cyan-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 2: Pre-Sealed Holdouts</div>
              <div className="text-3xl font-extrabold text-cyan-400 my-1">100%</div>
              <div className="text-xs font-bold text-white mb-1">Sealed Holdout Suite (75 cases)</div>
              <p className="text-[11px] text-slate-400 m-0">
                SHA-256 pre-committed test fixtures with zero data leakage into training soup.
              </p>
            </div>

            <div className="card p-5 bg-black/40 border border-amber-500/20">
              <div className="text-xs font-mono uppercase text-slate-400">Regime 6: White-Box Red Team</div>
              <div className="text-3xl font-extrabold text-amber-400 my-1">100%</div>
              <div className="text-xs font-bold text-white mb-1">Adaptive Optimization (500 trials)</div>
              <p className="text-[11px] text-slate-400 m-0">
                Gradient-free and prompt-mutation evasion attacks neutralized by CBAC structural barriers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: BibTeX */}
      {activeTab === 'bibtex' && (
        <div className="lp-academic-content">
          <div className="relative">
            <pre className="text-xs font-mono bg-black/80 p-4 rounded-lg border border-white/10 text-slate-300 overflow-x-auto">
              {bibtex}
            </pre>
            <button
              type="button"
              onClick={copyBibtex}
              className="absolute top-3 right-3 btn btn-secondary btn-sm text-xs py-1 px-3"
            >
              {copiedBibtex ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
