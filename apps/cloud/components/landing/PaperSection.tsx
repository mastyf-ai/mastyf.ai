import {
  HF_MODEL_URL,
  PAPER_PDF_URL,
  PAPER_TITLE,
  ZENODO_DOI,
  ZENODO_URL,
} from '@/lib/product-links';

export function PaperSection() {
  return (
    <section className="lp-section lp-section-tint" id="paper" aria-label="Research paper">
      <div className="lp-section-header reveal">
        <p className="lp-pill" style={{ margin: '0 auto 1rem' }}>
          Research preprint · Zenodo DOI {ZENODO_DOI} · CC-BY 4.0
        </p>
        <h2>The security your agents were missing</h2>
        <p>
          Give your AI tools a real perimeter. Every call is checked against what it was actually
          allowed to do — so hijacks fail, data stays inside, and your team ships faster.
        </p>
      </div>

      <div className="lp-paper-grid">
        <div className="card lp-paper-card">
          <h3>Why this matters to you</h3>
          <p className="muted">
            Your AI agent reads docs, calls tools, and moves money — but it cannot tell a trusted
            instruction from attacker data hidden in a webpage or tool output. Mastyf Guard puts a{' '}
            <strong>perimeter around every tool call</strong> so bad instructions never execute, and
            good work never gets blocked.
          </p>
          <ul className="lp-paper-theorems">
            <li>
              <strong>Stops hijacked tools cold</strong>
              <span>Even if the model is tricked, out-of-scope tools cannot run — zero chance.</span>
            </li>
            <li>
              <strong>Catches data theft across tools</strong>
              <span>Tracks data across steps and blocks leaks before they leave — 1,152 cases proven.</span>
            </li>
          </ul>
        </div>

        <div className="card lp-paper-card">
          <h3>What you get — proven at scale</h3>
          <div className="lp-paper-metrics">
            <div>
              <strong>99.33%</strong>
              <span>Attacks blocked · tested on 50,000 real cases · instant</span>
            </div>
            <div>
              <strong>97.50%</strong>
              <span>Coverage where it counts · enterprise tasks stay safe</span>
            </div>
            <div>
              <strong>0.00%</strong>
              <span>False alarms in production · 2,000 real team workflows</span>
            </div>
            <div>
              <strong>17.3µs</strong>
              <span>Feels instant · runs on a tiny 1.1GB CPU, no GPU needed</span>
            </div>
          </div>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
            Four simple guarantees: right destination, right scope, no privilege creep, spend stays
            capped. Routine work flows with <strong>0% extra AI cost</strong>.
          </p>
        </div>
      </div>

      <div className="lp-paper-cta">
        <a href={PAPER_PDF_URL} className="btn btn-primary btn-pill motion-cta" target="_blank" rel="noopener noreferrer">
          Read the paper (PDF)
        </a>
        <a href={ZENODO_URL} className="btn btn-secondary btn-pill motion-cta" target="_blank" rel="noopener noreferrer">
          Zenodo · DOI {ZENODO_DOI}
        </a>
        <a href={HF_MODEL_URL} className="btn btn-ghost btn-pill motion-cta" target="_blank" rel="noopener noreferrer">
          Model on Hugging Face
        </a>
      </div>

      <p className="lp-paper-cite">
        Das, Rudraneel. “{PAPER_TITLE}.” <em>Zenodo Research Monograph</em>, v2.0, 2026. doi:{' '}
        <a href={`https://doi.org/${ZENODO_DOI}`} target="_blank" rel="noopener noreferrer">
          {ZENODO_DOI}
        </a>{' '}
        · CC-BY 4.0 ·{' '}
        <a href={PAPER_PDF_URL} target="_blank" rel="noopener noreferrer">
          mastyf-guard.pdf
        </a>
      </p>
    </section>
  );
}
