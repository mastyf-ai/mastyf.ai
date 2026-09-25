'use client';

interface Client {
  name: string;
  tag: string;
  icon: string;
  color: string;
}

const CLIENTS: Client[] = [
  { name: 'Claude Desktop', tag: 'MCP Native', icon: '🤖', color: '#f59e0b' },
  { name: 'Cursor AI', tag: 'Agent IDE', icon: '⚡', color: '#22d3ee' },
  { name: 'Windsurf / Codeium', tag: 'Flow Agent', icon: '🌊', color: '#a78bfa' },
  { name: 'LangChain', tag: 'Agent Mesh', icon: '🔗', color: '#10b981' },
  { name: 'LlamaIndex', tag: 'Data Agents', icon: '🦙', color: '#f97316' },
  { name: 'OpenAI Swarm', tag: 'Multi-Agent', icon: '🐝', color: '#60a5fa' },
  { name: 'Model Context Protocol', tag: 'Standard', icon: '📡', color: '#e879f9' },
  { name: 'AutoGen', tag: 'Conversational', icon: '🔄', color: '#34d399' },
  { name: 'Python SDK', tag: 'Integration', icon: '🐍', color: '#fbbf24' },
  { name: 'Docker Compose', tag: 'Container', icon: '🐳', color: '#22d3ee' },
];

export function EcosystemMarquee() {
  const doubled = [...CLIENTS, ...CLIENTS];

  return (
    <section className="lp-ecosystem-section" aria-label="Supported Agent Ecosystem">
      <div className="lp-ecosystem-inner">
        <span className="lp-ecosystem-eyebrow">
          NATIVELY ENFORCED ACROSS THE MCP AGENTIC ECOSYSTEM
        </span>
        <div className="lp-marquee-container">
          <div className="lp-marquee-track">
            {doubled.map((client, idx) => (
              <div key={`${client.name}-${idx}`} className="lp-marquee-item">
                <span
                  className="lp-marquee-icon"
                  role="img"
                  aria-label={client.name}
                  style={{ color: client.color }}
                >
                  {client.icon}
                </span>
                <span className="lp-marquee-name">{client.name}</span>
                <span className="lp-marquee-tag">{client.tag}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip below marquee */}
        <div className="lp-ecosystem-stats">
          <span className="lp-ecosystem-stat">
            <span className="lp-ecosystem-stat-num">10+</span>
            <span>Agent integrations</span>
          </span>
          <span className="lp-ecosystem-stat-divider" aria-hidden="true">·</span>
          <span className="lp-ecosystem-stat">
            <span className="lp-ecosystem-stat-num">330,000+</span>
            <span>Intercepted calls/sec</span>
          </span>
          <span className="lp-ecosystem-stat-divider" aria-hidden="true">·</span>
          <span className="lp-ecosystem-stat">
            <span className="lp-ecosystem-stat-num">&lt;4.8µs</span>
            <span>Zero-overhead protection</span>
          </span>
        </div>
      </div>
    </section>
  );
}
