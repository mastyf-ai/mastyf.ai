import { IconBadge, IconEye, IconShield } from './icons';
import { PROBLEM_CARDS } from './stats';
import { RevealOnScroll } from './RevealOnScroll';

const ICONS = {
  eye: IconEye,
  shield: IconShield,
  badge: IconBadge,
} as const;

export function ProblemSection() {
  return (
    <RevealOnScroll>
      <section className="lp-section lp-section-tint" id="problem">
        <div className="lp-section-header">
          <h2>No perimeter. No audit trail. No trust signal.</h2>
          <p>
            AI agents act on real systems autonomously. mastyf.ai gives security teams enforcement,
            visibility, and trust scores before production.
          </p>
        </div>
        <div className="lp-problem-grid">
          {PROBLEM_CARDS.map((card) => {
            const Icon = ICONS[card.icon];
            return (
              <article key={card.title} className="lp-problem-card card-elevated">
                <div className="lp-problem-icon">
                  <Icon size={28} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            );
          })}
        </div>
      </section>
    </RevealOnScroll>
  );
}
