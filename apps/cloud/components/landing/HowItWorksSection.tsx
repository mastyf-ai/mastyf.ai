import { HOW_IT_WORKS } from './stats';
import { RevealOnScroll } from './RevealOnScroll';

export function HowItWorksSection() {
  return (
    <RevealOnScroll>
      <section className="lp-section lp-section-tint" id="how">
        <div className="lp-section-header">
          <h2>How it works</h2>
          <p>Deploy, define policy, score packages — three steps to production-ready MCP security.</p>
        </div>
        <ol className="lp-steps">
          {HOW_IT_WORKS.map((step) => (
            <li key={step.step} className="lp-step card-elevated">
              <span className="lp-step-num">{step.step}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </RevealOnScroll>
  );
}
