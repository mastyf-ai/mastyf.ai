const REFS = [
  { n: 1, text: 'J. von Neumann — First Draft of a Report on the EDVAC, IEEE Annals, 1945. doi:10.1109/85.238389' },
  { n: 2, text: 'Aleph One — Smashing the Stack for Fun and Profit, Phrack 49, 1996.' },
  { n: 3, text: 'Anthropic — Model Context Protocol Specification, 2024. modelcontextprotocol.io' },
  { n: 4, text: 'J. Yi et al. — Benchmarking and Defending Against Indirect Prompt Injection, KDD ’25. doi:10.1145/3690624.3709214' },
  { n: 5, text: 'Q. Zhang et al. — InjecAgent: Benchmarking Indirect Prompt Injection, arXiv:2403.02691, 2024.' },
  { n: 6, text: 'N. Hardy — The Confused Deputy, ACM SIGOPS 22(4), 1988. doi:10.1145/54289.848445' },
  { n: 7, text: 'H. Inan et al. — Llama Guard: LLM-based Input-Output Safeguard, arXiv:2312.06674, 2023.' },
  { n: 8, text: 'T. Rebedea et al. — NeMo Guardrails, arXiv:2310.10501, 2023.' },
  { n: 9, text: 'J. H. Saltzer & M. D. Schroeder — The protection of information in computer systems, Proc. IEEE 63(9), 1975.' },
  { n: 10, text: 'N. Hardy — The KeyKOS architecture, ACM SIGOPS 19(4), 1985.' },
  { n: 12, text: 'Qwen Team — Qwen2.5 Technical Report, arXiv:2412.15115, 2024.' },
  { n: 13, text: 'E. J. Hu et al. — LoRA: Low-Rank Adaptation, ICLR 2022.' },
  { n: 14, text: 'B. Efron & R. J. Tibshirani — An introduction to the bootstrap, Chapman & Hall, 1994.' },
  { n: 15, text: 'L. Shieh et al. — Garak: A Framework for LLM Vulnerability Scanning, arXiv:2311.14498, 2023.' },
  { n: 19, text: 'D. E. Denning — A lattice model of secure information flow, CACM 19(5), 1976.' },
  { n: 25, text: 'J. A. Goguen & J. Meseguer — Security policies and security models, IEEE S&P 1982.' },
  { n: 26, text: 'E. Debenedetti et al. — AgentDojo: Benchmarking Agent Attacks and Defenses, NeurIPS 2024.' },
  { n: 27, text: 'S. Chen et al. — Clawed and Dangerous: Can We Trust Open Agentic Systems? arXiv:2603.26221, 2026.' },
  { n: 30, text: 'OWASP — Top 10 for LLM Applications and Agentic AI, 2025. owasp.org' },
  { n: 31, text: 'T. Y. Lin et al. — Focal Loss for Dense Object Detection, ICCV 2017.' },
  { n: 32, text: 'A. C. Myers & B. Liskov — A decentralized model for information flow control, SOSP 1997.' },
  { n: 34, text: 'K. Greshake et al. — Not What You’ve Signed Up For (Indirect Prompt Injection), AISEC ’23.' },
] as const;

export function ReferencesSection() {
  return (
    <section className="lp-section" id="references" aria-label="References">
      <div className="lp-section-header">
        <h2>References</h2>
        <p>45 sources — complete bibliography in <a href="/paper/references.bib" target="_blank" rel="noopener noreferrer">references.bib</a> and <a href="/paper/mastyf-guard.pdf" target="_blank" rel="noopener noreferrer">mastyf-guard.pdf</a>.</p>
      </div>
      <ol className="lp-references">
        {REFS.map((r) => (
          <li key={r.n}>
            <span className="lp-ref-n">[{r.n}]</span> {r.text}
          </li>
        ))}
      </ol>
      <p className="muted" style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
        Full 45 refs: von Neumann (1945) · Saltzer & Schroeder (1975) · Hardy (1988) · Myers & Liskov (1997) · watermark — see paper.
      </p>
    </section>
  );
}
