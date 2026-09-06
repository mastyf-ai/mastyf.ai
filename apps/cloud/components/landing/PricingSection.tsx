import { HF_CHECKOUT_URL, HF_MODEL_URL } from '@/lib/product-links';

export function PricingSection() {
  return (
    <section className="lp-section" id="pricing" aria-label="Pricing">
      <div className="lp-section-header">
        <h2>Developer &amp; Team Licensing</h2>
        <p>
          Deploy autonomous agents with sensitive tool access under a deterministic execution boundary.
          Simple monthly licensing for developers, startups, and security-conscious agent builders.
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
          <span className="lp-pricing-badge">Recommended for Builders</span>
          <h3>Mastyf Guard Pro</h3>
          <p className="muted">Production tool execution boundary (₹2,500 / month).</p>
          <ul className="lp-pricing-features">
            <li>Instance-backed license key for gateway execution</li>
            <li>Gated V6 weights access on Hugging Face</li>
            <li>CBAC capability control + DIFC information flow</li>
            <li>Offline 7-day grace period resilience</li>
          </ul>
          <a href={HF_CHECKOUT_URL} className="btn btn-primary btn-pill" target="_blank" rel="noopener noreferrer">
            Get Pro License — ₹2,500/mo
          </a>
          <small className="muted">Instant activation via Lemon Squeezy with Ed25519 cryptographic token.</small>
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
