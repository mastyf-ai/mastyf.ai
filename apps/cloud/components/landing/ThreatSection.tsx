import { THREATS_STOPPED } from './stats';
import { RevealOnScroll } from './RevealOnScroll';

export function ThreatSection() {
  return (
    <RevealOnScroll>
      <section className="lp-section" id="threats">
        <div className="lp-section-header">
          <h2>What mastyf.ai stops</h2>
          <p>
            Every tool call is inspected. Violations are blocked before they reach your
            infrastructure.
          </p>
        </div>
        <div className="lp-threat-grid">
          {THREATS_STOPPED.map((t) => (
            <article key={t.name} className="lp-threat-card">
              <h3>{t.name}</h3>
              <p>{t.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </RevealOnScroll>
  );
}
