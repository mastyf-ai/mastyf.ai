'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Download } from 'lucide-react';
import {
  HF_MODEL_URL,
  PAPER_BIBTEX,
  PAPER_PDF_URL,
  PAPER_SUBTITLE,
  PAPER_TITLE,
  PAPER_VERSION,
  SSRN_ABSTRACT_ID,
  SSRN_PAPER_URL,
  ZENODO_DOI,
  ZENODO_URL,
} from '@/lib/product-links';

type PaperTab = 'abstract' | 'theorems' | 'latex-preview' | 'regimes' | 'bibtex';

const TABS: { id: PaperTab; label: string }[] = [
  { id: 'abstract', label: 'Executive abstract' },
  { id: 'theorems', label: 'Invariants and theorems' },
  { id: 'latex-preview', label: 'LaTeX math and proofs' },
  { id: 'regimes', label: '6-regime empirical results' },
  { id: 'bibtex', label: 'Cite / BibTeX' },
];

const THEOREM_SUMMARIES = [
  {
    kind: 'Formal guarantee',
    title: 'Proposition 1: Inductive Composability Invariant',
    body: 'Adversarial observations ingested within an autoregressive Transformer context cannot synthesize or escalate authority across arbitrary multi-step execution sequences under Complete Mediation (A1–A6). Any blocked action produces strictly 0 backend bytes.',
    formula: '∀t ∈ ℕ: Execute(a_t) ≠ ALLOW ⟹ |WireBytes(a_t)| = 0',
  },
  {
    kind: 'Relational invariant',
    title: 'Theorem 1: Safety Invariant Preservation',
    body: 'If state S_t satisfies the relational argument invariants (destination containment, scope boundedness, privilege monotonicity, and monetary clamping), then state S_t+1 after authorized action execution satisfies the invariants.',
    formula: 'S_t ⊨ ℐ ∧ a_t ∈ A_struct(S_t) ⟹ δ(S_t, a_t) ⊨ ℐ',
  },
  {
    kind: 'Authority subordination',
    title: 'Theorem 2: Subordinate Learned Semantics',
    body: 'A_final = A_struct ∩ A_semantic ⊆ A_struct. Learned neural classifiers (Mastyf Guard 1.5B) can only reduce or restrict authority, and can never grant or synthesize unapproved execution permissions.',
    formula: '∀a ∉ A_struct ⟹ a ∉ A_final (Zero Learned Privilege Escalation)',
  },
  {
    kind: 'State machine synchronization',
    title: 'Theorem 3: Execution-Certainty Non-Advancement',
    body: 'For any dependent tool requiring verified prior execution of action a_i: if ExecutionCertainty(a_i) = UNKNOWN, dispatch of dependent action a_j is deterministically rejected.',
    formula: 'Certainty(a_i) = UNKNOWN ⟹ Dispatch(a_j) = ⊥, ∀a_j ≻ a_i',
  },
] as const;

// Indexed by theorem number; Proposition 1 is index 0.
const LATEX_SOURCES = [
  String.raw`\forall t \in \mathbb{N}, \; \text{Execute}(a_t) \neq \text{ALLOW} \implies |\text{WireBytes}(a_t)| = 0`,
  String.raw`S_t \models \mathcal{I} \land a_t \in \mathcal{A}_{\text{struct}}(S_t) \implies \delta(S_t, a_t) \models \mathcal{I}`,
  String.raw`\mathcal{A}_{\text{final}} = \mathcal{A}_{\text{struct}} \cap \mathcal{A}_{\text{semantic}} \subseteq \mathcal{A}_{\text{struct}}`,
  String.raw`\text{Certainty}(a_i) = \text{UNKNOWN} \implies \text{Dispatch}(a_j) = \bot \quad \forall a_j \succ a_i`,
];

const PROOFS: Record<number, { tab: string; heading: string; equation: string; proof: string }> = {
  2: {
    tab: 'Theorem 2 (Subordinate Authority)',
    heading: 'Theorem 2: Subordinate Learned Authority',
    equation: String.raw`$$\mathcal{A}_\text{final} = \mathcal{A}_\text{struct} \cap \mathcal{A}_\text{semantic} \subseteq \mathcal{A}_\text{struct}$$`,
    proof: String.raw`Let $\mathcal{A}_\text{struct}$ be the set of tool actions permitted by the deterministic capability monitor (Gate 2). Let $\mathcal{A}_\text{semantic}$ be the binary authorization set output by Mastyf Guard 1.5B (Gate 4). By definition of set intersection, for any candidate tool dispatch $a$, if $a \notin \mathcal{A}_\text{struct}$, then $a \notin (\mathcal{A}_\text{struct} \cap \mathcal{A}_\text{semantic})$. Thus, even if an attacker completely hijacks the neural weights or output logits of the classifier such that $\mathcal{A}_\text{semantic} = \mathcal{U}$ (universal permit), the effective authority cannot exceed $\mathcal{A}_\text{struct}$. Q.E.D.`,
  },
  1: {
    tab: 'Theorem 1 (Invariant Preservation)',
    heading: 'Theorem 1: Safety Invariant Preservation',
    equation: String.raw`$$S_t \models \mathcal{I} \land a_t \in \mathcal{A}_\text{struct}(S_t) \implies \delta(S_t, a_t) \models \mathcal{I}$$`,
    proof: String.raw`The invariant system $\mathcal{I} = \mathcal{I}_\text{contain} \land \mathcal{I}_\text{bound} \land \mathcal{I}_\text{mono} \land \mathcal{I}_\text{clamp}$ is evaluated before dispatch. Destination Containment enforces path canonicalization within the sandbox. Scope Boundedness rejects undeclared verbs. Privilege Monotonicity guarantees $\mathcal{A}_\text{eff}(t+1) \subseteq \mathcal{A}_\text{eff}(t)$. Monetary Clamping enforces total budget $\sum c(a_i) \le B$. By mathematical induction over discrete execution steps $t \in \mathbb{N}$, the system cannot transition into any forbidden state. Q.E.D.`,
  },
  3: {
    tab: 'Theorem 3 (Execution Certainty)',
    heading: 'Theorem 3: Execution-Certainty Non-Advancement',
    equation: String.raw`$$\text{Certainty}(a_i) = \text{UNKNOWN} \implies \text{Dispatch}(a_j) = \bot \quad \forall a_j \succ a_i$$`,
    proof: String.raw`Consider an action dependency graph $G = (V, E)$ where $(a_i, a_j) \in E$ denotes that action $a_j$ depends on the verified outcome of $a_i$. If the transport connection or process exits with status $\text{UNKNOWN}$ or ambiguous return tokens, the execution arbiter freezes state advancement and yields $\bot$. Ambient speculative execution is strictly prohibited. Q.E.D.`,
  },
  0: {
    tab: 'Proposition 1 (Zero-Byte Wire)',
    heading: 'Proposition 1: Zero-Byte Physical Wire Isolation',
    equation: String.raw`$$\forall t \in \mathbb{N}, \; \text{Execute}(a_t) \neq \text{ALLOW} \implies |\text{WireBytes}(a_t)| = 0$$`,
    proof: String.raw`Under the fail-closed complete mediation contract, the socket to the backend tool provider is only established upon unanimous positive clearance from Gates 1–4. When an action evaluates to $\text{BLOCK}$ or $\text{ESCALATE}$, the gateway transmits an immediate synthetic error receipt to the client, never opening the outbound socket. Hence zero bytes transit the backend interface. Q.E.D.`,
  },
};

const PROOF_ORDER = [2, 1, 3, 0];

const REGIMES = [
  { regime: 'Regime 5: Interactive Episodes', result: '99.52%', suite: 'AgentDojo Benchmark (629 episodes)', note: 'Full multi-turn interactive environments with exact clean utility parity (6/97).' },
  { regime: 'Regime 3: Standard Academic', result: '98.43%', suite: 'UIUC InjecAgent (4,216 cases)', note: 'P50 decision latency of 267.7ms running INT4 AWQ on commodity CPU.' },
  { regime: 'Regime 4: Benign Safety', result: '0.00%', suite: 'False Alarm Rate (1,000 cases)', note: 'AI Safety Bench evaluation confirmed zero false positives on benign developer tool actions.' },
  { regime: 'Regime 1: Synthetic Holdouts', result: '100%', suite: 'Factorized Diagnostics (145 cases)', note: 'Comprehensive in-scope parameter poisoning contrastive boundary tests.' },
  { regime: 'Regime 2: Pre-Sealed Holdouts', result: '100%', suite: 'Sealed Holdout Suite (75 cases)', note: 'SHA-256 pre-committed test fixtures with zero data leakage into training soup.' },
  { regime: 'Regime 6: White-Box Red Team', result: '100%', suite: 'Adaptive Optimization (500 trials)', note: 'Gradient-free and prompt-mutation evasion attacks neutralized by CBAC structural barriers.' },
] as const;

function CopyLabel({ copied, idle, done }: { copied: boolean; idle: string; done: string }) {
  return (
    <>
      {copied ? (
        <Check size={13} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
      )}
      {copied ? done : idle}
    </>
  );
}

export function AcademicPaperHero({ standalone = false }: { standalone?: boolean }) {
  const [copiedBibtex, setCopiedBibtex] = useState(false);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [activeTab, setActiveTab] = useState<PaperTab>('abstract');
  const [activeTheorem, setActiveTheorem] = useState<number>(2);

  const bibtex = PAPER_BIBTEX;

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

  const proof = PROOFS[activeTheorem];

  return (
    <div className={`panel paper${standalone ? ' paper--standalone' : ''}`} id="academic-paper" data-reveal>
      <div className="paper__head">
        <div className="paper__badges">
          <span className="badge badge-active">Open-access preprint, {PAPER_VERSION}</span>
          <a className="badge" href={`https://doi.org/${ZENODO_DOI}`} target="_blank" rel="noopener noreferrer">
            DOI {ZENODO_DOI}
          </a>
          <a className="badge" href={SSRN_PAPER_URL} target="_blank" rel="noopener noreferrer">
            SSRN {SSRN_ABSTRACT_ID}
          </a>
          <span className="badge">CC-BY 4.0 open access</span>
        </div>
        <a href={PAPER_PDF_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
          <Download size={13} strokeWidth={2} aria-hidden="true" />
          Download manuscript (PDF)
        </a>
      </div>

      <div className="paper__title-block">
        <h2 className="paper__title">{PAPER_TITLE}</h2>
        <p className="paper__subtitle">{PAPER_SUBTITLE}</p>
        <div className="paper__byline">
          <strong>Rudraneel Das</strong>
          <span>Mastyf.ai, Kolkata, India</span>
          <a
            href="https://orcid.org/0009-0009-6173-0262"
            target="_blank"
            rel="noopener noreferrer"
            className="link-icon"
          >
            ORCID 0009-0009-6173-0262
            <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="tablist paper__tabs" role="tablist" aria-label="Paper sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`paper-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls="paper-panel"
            className="tab"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="paper__content" role="tabpanel" id="paper-panel" aria-labelledby={`paper-tab-${activeTab}`}>
        {activeTab === 'abstract' && (
          <div className="paper__abstract">
            <p>
              Autonomous artificial intelligence agents executing over extensible tool interfaces (such as
              Anthropic’s Model Context Protocol) operate with ambient authority over connected tools. Because
              autoregressive Transformers ingest instructions and untrusted third-party data within a single
              homogeneous context window, adversarial observations can manipulate the model into executing
              unintended privileged actions — the classic <em>Confused Deputy</em> problem.
            </p>
            <p>
              We introduce an architectural perimeter that enforces <strong>complete mediation</strong>, least
              privilege, four relational argument invariants (destination containment, scope boundedness, privilege
              monotonicity, and monetary clamping), and execution-certainty semantics. We prove that external
              capability mediation isolates systems even when the model is completely compromised by indirect
              injection, formalizing the core invariant:
            </p>
            <div className="formula">
              <span>
                A<sub>final</sub> = A<sub>struct</sub> ∩ A<sub>semantic</sub> ⊆ A<sub>struct</sub>
              </span>
              <span className="formula__note">
                Subordinate Learned Authority: Semantic classifiers can revoke or escalate, but can never synthesize
                or grant permission.
              </span>
            </div>
            <p>
              Evaluated across 6 distinct regimes totaling 6,662 instances (including UIUC InjecAgent, AgentDojo,
              and AI Safety Bench), the integrated perimeter achieves <strong>99.52% defense</strong> on interactive
              episodes, <strong>98.43% defense</strong> on InjecAgent at 267.7ms CPU latency, and{' '}
              <strong>zero false alarms</strong> on benign workloads.
            </p>

            <div className="paper__actions">
              <a href={PAPER_PDF_URL} className="btn btn-primary btn-sm" target="_blank" rel="noopener noreferrer">
                <Download size={13} strokeWidth={2} aria-hidden="true" />
                Download full manuscript (PDF)
              </a>
              <a href={HF_MODEL_URL} className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer">
                Hugging Face model weights (d59a6aa)
                <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
              </a>
              <a href={ZENODO_URL} className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">
                Zenodo record
                <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
              </a>
              <button type="button" onClick={copyBibtex} className="btn btn-ghost btn-sm">
                <CopyLabel copied={copiedBibtex} idle="Copy BibTeX" done="BibTeX copied" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'theorems' && (
          <ul className="theorems">
            {THEOREM_SUMMARIES.map((item) => (
              <li key={item.title} className="theorem">
                <div>
                  <span className="theorem__kind">{item.kind}</span>
                  <h3 className="theorem__title">{item.title}</h3>
                </div>
                <div>
                  <p>{item.body}</p>
                  <code>{item.formula}</code>
                </div>
              </li>
            ))}
          </ul>
        )}

        {activeTab === 'latex-preview' && (
          <div>
            <div className="latex-bar">
              <div className="tablist tablist--boxed" role="group" aria-label="Theorem">
                {PROOF_ORDER.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="tab"
                    aria-pressed={activeTheorem === n}
                    onClick={() => setActiveTheorem(n)}
                  >
                    {PROOFS[n].tab}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => copyLatex(LATEX_SOURCES[activeTheorem])} className="btn btn-sm">
                <CopyLabel copied={copiedLatex} idle="Copy LaTeX" done="LaTeX copied" />
              </button>
            </div>

            <div className="proof">
              <span className="label">{proof.heading}</span>
              <pre className="proof__equation" data-lenis-prevent>
                <code>{proof.equation}</code>
              </pre>
              <h3 className="proof__title">Proof sketch</h3>
              <p>{proof.proof}</p>
            </div>
          </div>
        )}

        {activeTab === 'regimes' && (
          <div className="table-scroll">
            <table className="data-table regimes">
              <thead>
                <tr>
                  <th scope="col">Regime</th>
                  <th scope="col" className="num">Result</th>
                  <th scope="col">Suite</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {REGIMES.map((row) => (
                  <tr key={row.regime}>
                    <th scope="row">{row.regime}</th>
                    <td className="num regimes__result">{row.result}</td>
                    <td>{row.suite}</td>
                    <td className="dim">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'bibtex' && (
          <div className="codeblock">
            <pre data-lenis-prevent>
              <code>{bibtex}</code>
            </pre>
            <button type="button" onClick={copyBibtex} className="btn btn-sm codeblock__copy">
              <CopyLabel copied={copiedBibtex} idle="Copy" done="Copied" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
