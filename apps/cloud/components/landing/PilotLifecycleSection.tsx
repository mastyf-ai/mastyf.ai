import Link from 'next/link';

export function PilotLifecycleSection() {
  const weeks = [
    {
      period: 'Week 1',
      title: 'Observe (Audit Mode)',
      desc: 'Drop in Mastyf Gateway between your agent and tools. Zero workflow disruption, zero false rejections. Passively log and classify every tool call.',
    },
    {
      period: 'Week 2',
      title: 'Discover & Map',
      desc: 'Map tool inventory, flag ambient authority risks, and generate baseline Capability-Based Access Control (CBAC) schemas automatically.',
    },
    {
      period: 'Week 3',
      title: 'Adversarial Hardening',
      desc: 'Run Mastyf Swarm multi-turn injection fixtures against your policies. Tune relational argument invariants and workflow certainty constraints.',
    },
    {
      period: 'Week 4',
      title: 'Active Enforcement & Report',
      desc: 'Switch high-risk tools to Block Mode. Receive a comprehensive Executive Agent Security Report for CISO & architecture sign-off.',
    },
  ];

  return (
    <section className="lp-section" id="pilot" aria-label="30-Day Agent Security Pilot">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Enterprise Onboarding</span>
        <h2>Secure One Production-Ready Agent in 30 Days</h2>
        <p>
          Don&rsquo;t try to boil the ocean. Our pilot process proves measurable security improvement on a single high-impact agent with zero initial disruption.
        </p>
      </div>

      <div className="lp-pilot-grid">
        {weeks.map((w) => (
          <div key={w.period} className="card lp-pilot-card">
            <span className="lp-pilot-week-tag">{w.period}</span>
            <h4 className="lp-pilot-title">{w.title}</h4>
            <p className="muted text-sm">{w.desc}</p>
          </div>
        ))}
      </div>

      <div className="lp-pilot-report-preview card mt-6">
        <div className="lp-pilot-report-copy">
          <span className="lp-pill">Pilot Deliverable</span>
          <h3>The Mastyf Executive Agent Security Report</h3>
          <p className="muted">
            At the conclusion of the 30-day pilot, your security engineering leadership receives an actionable, board-ready audit containing:
          </p>
          <ul className="lp-pilot-bullets">
            <li>Full tool dependency inventory and privilege blast radius</li>
            <li>Observed indirect prompt injection &amp; data exfiltration attempts</li>
            <li>Adversarial red-team test scores and bypass prevention metrics</li>
            <li>Production-tested YAML policy-as-code manifests for your fleet</li>
          </ul>
          <div className="lp-pilot-actions mt-4">
            <Link href="/pilot" className="btn btn-primary btn-pill">
              Start an Agent Security Pilot →
            </Link>
            <Link href="/assessment" className="btn btn-secondary btn-pill">
              Take Free 2-Min Exposure Assessment
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
