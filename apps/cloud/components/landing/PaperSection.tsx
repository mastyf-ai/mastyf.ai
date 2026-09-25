import { AcademicPaperHero } from './AcademicPaperHero';

export function PaperSection() {
  return (
    <section className="lp-section lp-section-tint" id="paper" aria-label="Research paper">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Reproducible Science &amp; Peer-Reviewed Research</span>
        <h2>Security Research Should Be Reproducible</h2>
        <p>
          Mastyf is founded on formal capability-containment proofs rather than statistical prompt filters.
          Our published monograph proves mathematically that untrusted model cognition cannot obtain privileged execution authority.
        </p>
      </div>

      <AcademicPaperHero standalone={false} />
    </section>
  );
}
