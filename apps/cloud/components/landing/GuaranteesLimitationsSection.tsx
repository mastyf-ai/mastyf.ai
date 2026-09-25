import { GUARANTEES_AND_LIMITATIONS } from './stats';

export function GuaranteesLimitationsSection() {
  return (
    <section className="lp-section" id="limitations" aria-label="Security Guarantees and Limitations">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Rigorous Engineering Trust</span>
        <h2>What Mastyf Guarantees — and Does Not Guarantee</h2>
        <p>
          In an industry filled with vague claims of &ldquo;100% unbreakable AI firewalls&rdquo;, we publish our formal security invariants and our explicit scientific limitations side by side.
        </p>
      </div>

      <div className="lp-guarantees-grid">
        <div className="card lp-guarantee-card">
          <div className="lp-guarantee-header">
            <span className="lp-icon-check" aria-hidden>✓</span>
            <h3>Architectural Guarantees</h3>
          </div>
          <p className="text-sm muted mb-4">
            Under formal Complete Mediation Axioms (A1–A6) and reference monitor integrity:
          </p>
          <ul className="lp-guarantee-list">
            {GUARANTEES_AND_LIMITATIONS.guarantees.map((item, idx) => (
              <li key={idx}>
                <span className="lp-guarantee-bullet" aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card lp-limitation-card">
          <div className="lp-limitation-header">
            <span className="lp-icon-warning" aria-hidden>⚠️</span>
            <h3>Scientific Boundaries &amp; Scope Limits</h3>
          </div>
          <p className="text-sm muted mb-4">
            Honest constraints documented in our peer-reviewed research:
          </p>
          <ul className="lp-limitation-list">
            {GUARANTEES_AND_LIMITATIONS.limitations.map((item, idx) => (
              <li key={idx}>
                <span className="lp-limitation-bullet" aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
