import { HF_CHECKOUT_URL, HF_MODEL_URL } from '@/lib/product-links';

export function PricingSection() {
  return (
    <section className="lp-section" id="pricing" aria-label="Pricing">
      <div className="lp-section-header">
        <h2>From research preview to production</h2>
        <p>
          The 1.5B guard is gated on Hugging Face for research and enterprise preview. Commercial
          production requires an active Mastyf Enterprise Pass.
        </p>
      </div>

      <div className="lp-pricing-grid">
        <div className="card lp-pricing-card">
          <h3>Research &amp; Preview</h3>
          <p className="muted">Try the frozen v2.0 baseline locally.</p>
          <ul className="lp-pricing-features">
            <li>Gated HF repo — share contact to access weights</li>
            <li>Ollama, vLLM, llama.cpp, Docker — Q4_K_M 986 MB</li>
            <li>Paper + 9 figures + 28,450 train / 3,550 val</li>
          </ul>
          <a href={HF_MODEL_URL} className="btn btn-secondary btn-pill" target="_blank" rel="noopener noreferrer">
            Request access on HF
          </a>
        </div>

        <div className="card lp-pricing-card lp-pricing-featured">
          <span className="lp-pricing-badge">Most teams</span>
          <h3>Enterprise Pass</h3>
          <p className="muted">Commercial production deployments.</p>
          <ul className="lp-pricing-features">
            <li>License key for production tool dispatch</li>
            <li>Fleet policy, evidence packs, support</li>
            <li>Cloud console — policy, keys, fleet, audit</li>
          </ul>
          <a href={HF_CHECKOUT_URL} className="btn btn-primary btn-pill" target="_blank" rel="noopener noreferrer">
            Get Enterprise Pass — Lemon Squeezy
          </a>
          <small className="muted">Requires Lemon Squeezy order / API license key for gated checkout.</small>
        </div>

        <div className="card lp-pricing-card">
          <h3>Open source</h3>
          <p className="muted">Perimeter proxy, swarm, and trust scores.</p>
          <ul className="lp-pricing-features">
            <li>AGPL 3.0 — self-hostable</li>
            <li>228/228 corpus gates · Security Swarm</li>
            <li>github.com/mastyf-ai/mastyf.ai</li>
          </ul>
          <a href="https://github.com/mastyf-ai/mastyf.ai" className="btn btn-ghost btn-pill" target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
