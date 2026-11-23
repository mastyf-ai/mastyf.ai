'use client';

import { FREE_FEATURES, PAID_FEATURES } from '@/lib/tier-features';

/** Free and Shield side by side, from the same list the mastyf.ai pricing page uses. */
export function PlanCompare({ paid, upgradeUrl }: { paid: boolean; upgradeUrl: string | null }) {
  return (
    <section className="plans" aria-labelledby="plans-title">
      <div className="plans-head">
        <h2 id="plans-title" className="home-h2">{paid ? 'Your plan' : 'Free, and what Shield adds'}</h2>
        <p className="home-lede">
          {paid
            ? 'Your Shield plan is active. It includes everything in Free.'
            : 'You are on Free: everything runs on your machines, with no account. Shield adds the desktop app, Protocol X and the paid layers.'}
        </p>
      </div>
      <div className="plans-grid">
        <div className={`plan${paid ? '' : ' current'}`}>
          <div className="plan-top">
            <h3>Free</h3>
            {!paid && <span className="plan-badge">You are here</span>}
          </div>
          <ul>
            {FREE_FEATURES.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong>
                {f.status === 'coming' && <span className="plan-soon">Soon</span>}
                <span>{f.what}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`plan shield${paid ? ' current' : ''}`}>
          <div className="plan-top">
            <h3>Shield</h3>
            {paid ? <span className="plan-badge">Active</span> : <span className="plan-note">Everything in Free, plus</span>}
          </div>
          <ul>
            {PAID_FEATURES.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong>
                <span>{f.what}</span>
              </li>
            ))}
          </ul>
          {!paid && upgradeUrl && (
            <a className="btn btn-primary plan-cta" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
              See Shield plans and pricing
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
