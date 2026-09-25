'use client';

export function ArcadeFeatureCards() {
  return (
    <section className="lp-section lp-arcade-features-section" id="capabilities">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Hardware-Grade Defense</span>
        <h2 className="lp-editorial-heading">Built for Speed. Enforced without Compromise.</h2>
        <p>
          Drop Mastyf into any agent architecture in under 10 seconds. From local developer CLI to enterprise fleet governance.
        </p>
      </div>

      <div className="lp-arcade-cards-grid">
        {/* Card 1: Zero Setup (Fuchsia) */}
        <div className="card lp-arcade-card lp-card-fuchsia">
          <div className="lp-arcade-icon-wrap" style={{ color: '#FF20BC' }}>
            <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
              <path d="M24 42C33.1127 42 40.5 34.6127 40.5 25.5C40.5 16.3873 33.1127 9 24 9C14.8873 9 7.5 16.3873 7.5 25.5C7.5 34.6127 14.8873 42 24 42Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M24 25.5L31.5 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19.5 3H28.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="lp-arcade-card-body">
            <h3 className="text-lg font-bold text-white mb-1">Zero Setup</h3>
            <p className="text-xs text-slate-300 leading-relaxed m-0">
              Spin up a working fail-closed reference monitor with one command: <code>npx @mastyf/gateway start</code>.
            </p>
          </div>
        </div>

        {/* Card 2: Production-Ready (Crimson) */}
        <div className="card lp-arcade-card lp-card-crimson">
          <div className="lp-arcade-icon-wrap" style={{ color: '#FF0037' }}>
            <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
              <path d="M35.8331 21.1668C40.3331 16.6668 40.6144 11.3137 40.4738 8.92679C40.4504 8.563 40.2953 8.22018 40.0375 7.96241C39.7797 7.70464 39.4369 7.54956 39.0731 7.52617C36.6862 7.38554 31.3369 7.66304 26.8331 12.1668L15 23.9999L24 32.9999L35.8331 21.1668Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M25.5 13.5H13.9406C13.5433 13.5002 13.1623 13.658 12.8812 13.9387L6.44062 20.3794C6.24398 20.5765 6.10606 20.8244 6.0423 21.0954C5.97855 21.3664 5.99147 21.6498 6.07963 21.9138C6.16778 22.1779 6.32769 22.4122 6.54145 22.5906C6.75522 22.769 7.0144 22.8843 7.28999 22.9238L15 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="lp-arcade-card-body">
            <h3 className="text-lg font-bold text-white mb-1">0 Backend Bytes</h3>
            <p className="text-xs text-slate-300 leading-relaxed m-0">
              Complete mediation guarantees that any blocked or uncertain action produces strictly 0 bytes to tools.
            </p>
          </div>
        </div>

        {/* Card 3: Intuitive by Design (Amber) */}
        <div className="card lp-arcade-card lp-card-amber">
          <div className="lp-arcade-icon-wrap" style={{ color: '#FFB700' }}>
            <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
              <path d="M14.4 14.4V9.6C14.4 9.6 14.4 4.8 24 4.8C33.6 4.8 33.6 9.6 33.6 9.6V19.2C33.6 22.08 31.2 24 28.8 24H19.2C16.8 24 14.4 25.92 14.4 28.8V38.4C14.4 38.4 14.4 43.2 24 43.2C33.6 43.2 33.6 38.4 33.6 38.4V33.6" stroke="currentColor" strokeWidth="2" />
              <path d="M24 14.4H9.6C9.6 14.4 4.8 14.4 4.8 24C4.8 33.6 9.6 33.6 9.6 33.6H14.4" stroke="currentColor" strokeWidth="2" />
              <path d="M33.6 14.4H38.4C38.4 14.4 43.2 14.4 43.2 24C43.2 33.6 38.4 33.6 38.4 33.6H24" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="lp-arcade-card-body">
            <h3 className="text-lg font-bold text-white mb-1">Intuitive by Design</h3>
            <p className="text-xs text-slate-300 leading-relaxed m-0">
              Declare capability policies in readable YAML or Python decorators. Relational invariants validate in &lt;4.8µs.
            </p>
          </div>
        </div>

        {/* Card 4: Agent-Compatible (Chartreuse) */}
        <div className="card lp-arcade-card lp-card-chartreuse">
          <div className="lp-arcade-icon-wrap" style={{ color: '#C3FF00' }}>
            <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
              <path d="M20 20L16 24L20 28M28 28L32 24L28 20M10 42C8.93913 42 7.92172 41.5786 7.17157 40.8284C6.42143 40.0783 6 39.0609 6 38V10C6 8.93913 6.42143 7.92172 7.17157 7.17157C7.92172 6.42143 8.93913 6 10 6H38C39.0609 6 40.0783 6.42143 40.8284 7.17157C41.5786 7.92172 42 8.93913 42 10V38C42 39.0609 41.5786 40.0783 40.8284 40.8284C40.0783 41.5786 39.0609 42 38 42M18 42H20M28 42H30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="lp-arcade-card-body">
            <h3 className="text-lg font-bold text-white mb-1">Universal Compatibility</h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-2">
              Intercepts MCP stdio, SSE, JSON-RPC, and HTTP. Works seamlessly across your agent ecosystem:
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="lp-mini-tag">Claude Desktop</span>
              <span className="lp-mini-tag">Cursor</span>
              <span className="lp-mini-tag">Windsurf</span>
              <span className="lp-mini-tag">LangGraph</span>
              <span className="lp-mini-tag">OpenAI Swarm</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
