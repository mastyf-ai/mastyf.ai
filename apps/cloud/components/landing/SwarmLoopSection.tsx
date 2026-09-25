import Link from 'next/link';

export function SwarmLoopSection() {
  const steps = [
    {
      num: '01',
      title: 'Live Production Signal',
      desc: 'Gateway flags anomalous tool calls, untrusted inputs, or policy near-misses in runtime traffic.',
    },
    {
      num: '02',
      title: 'Threat Lab Attack Mutation',
      desc: 'Adversarial generators synthesize multi-step, mutated variations of the attack vector.',
    },
    {
      num: '03',
      title: 'Human-in-the-Loop Review',
      desc: 'Security engineers inspect and approve proposed regression tests before policies change.',
    },
    {
      num: '04',
      title: 'CI Security Swarm Gates',
      desc: 'Permanent regression fixtures are evaluated on every pull request and model update.',
    },
    {
      num: '05',
      title: 'Hardened Runtime Boundary',
      desc: 'Policies, invariants, and semantic boundaries update to prevent the entire attack family.',
    },
  ];

  return (
    <section className="lp-section" id="swarm" aria-label="Security Swarm">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Continuous Hardening Loop</span>
        <h2>Attack Your Agent Before Attackers Do</h2>
        <p>
          Security cannot be a static checkpoint. Mastyf Swarm connects continuous CI/CD red-teaming directly with runtime threat discovery into a closed-loop feedback cycle.
        </p>
      </div>

      <div className="lp-swarm-loop-container card">
        <div className="lp-swarm-steps-grid">
          {steps.map((st, i) => (
            <div key={st.num} className="lp-swarm-step-card">
              <div className="lp-swarm-step-num">{st.num}</div>
              <h4>{st.title}</h4>
              <p className="muted text-sm">{st.desc}</p>
              {i < steps.length - 1 && <span className="lp-swarm-arrow" aria-hidden>→</span>}
            </div>
          ))}
        </div>

        <div className="lp-swarm-footer-banner">
          <div className="lp-swarm-banner-text">
            <strong>Automated Regression Guard:</strong> Over 228 multi-turn adversarial fixtures guard every release against regression.
          </div>
          <Link href="/platform#swarm" className="btn btn-secondary btn-sm btn-pill">
            Explore Mastyf Swarm Architecture →
          </Link>
        </div>
      </div>
    </section>
  );
}
