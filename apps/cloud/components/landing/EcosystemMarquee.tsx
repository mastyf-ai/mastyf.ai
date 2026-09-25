'use client';

import React from 'react';

interface Client {
  name: string;
  tag: string;
  color: string;
  renderLogo: () => React.ReactNode;
}

const CLIENTS: Client[] = [
  {
    name: 'Claude Desktop',
    tag: 'MCP Native',
    color: '#D97757',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Claude / Anthropic organic spark mark */}
        <path
          d="M13.82 3.16a.75.75 0 0 0-1.34 0l-1.92 4.3a.75.75 0 0 1-.41.41l-4.3 1.92a.75.75 0 0 0 0 1.34l4.3 1.92a.75.75 0 0 1 .41.41l1.92 4.3a.75.75 0 0 0 1.34 0l1.92-4.3a.75.75 0 0 1 .41-.41l4.3-1.92a.75.75 0 0 0 0-1.34l-4.3-1.92a.75.75 0 0 1-.41-.41l-1.92-4.3z"
          fill="#D97757"
        />
        <circle cx="18.5" cy="5.5" r="1.5" fill="#F59E0B" />
        <circle cx="5.5" cy="18.5" r="1.2" fill="#D97757" opacity="0.7" />
      </svg>
    ),
  },
  {
    name: 'Cursor AI',
    tag: 'Agent IDE',
    color: '#38BDF8',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Cursor 3D isometric cube */}
        <path d="M12 2.5L20.5 7.4v9.8L12 22.1 3.5 17.2V7.4L12 2.5z" stroke="#38BDF8" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 12.3L20.5 7.4M12 12.3v9.8M12 12.3L3.5 7.4" stroke="#38BDF8" strokeWidth="1.8" strokeLinejoin="round" />
        <polygon points="12,2.5 20.5,7.4 12,12.3 3.5,7.4" fill="#38BDF8" fillOpacity="0.25" />
        <polygon points="3.5,7.4 12,12.3 12,22.1 3.5,17.2" fill="#38BDF8" fillOpacity="0.1" />
        <polygon points="20.5,7.4 12,12.3 12,22.1 20.5,17.2" fill="#38BDF8" fillOpacity="0.4" />
      </svg>
    ),
  },
  {
    name: 'Windsurf / Codeium',
    tag: 'Flow Agent',
    color: '#09B6A2',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Windsurf / Codeium flowing wave sail */}
        <path
          d="M4.5 15.5C6 11 9.5 7 14.5 7c4.5 0 6.5 3 6.5 6.5s-2 6.5-6.5 6.5c-4 0-7-2.5-8.5-5.5"
          stroke="#09B6A2"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M9 13.5c1-2.5 3-4 5.5-4 2.5 0 3.5 1.5 3.5 3.5s-1 3.5-3.5 3.5c-2 0-3.8-1.2-4.8-3"
          stroke="#34D399"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="14.5" cy="13" r="1.5" fill="#09B6A2" />
      </svg>
    ),
  },
  {
    name: 'LangChain',
    tag: 'Agent Mesh',
    color: '#22C55E',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* LangChain dual interlocking chain link */}
        <rect x="3.5" y="6.5" width="10" height="6" rx="3" stroke="#22C55E" strokeWidth="2" transform="rotate(-30 8.5 9.5)" />
        <rect x="10.5" y="11.5" width="10" height="6" rx="3" stroke="#86EFAC" strokeWidth="2" transform="rotate(-30 15.5 14.5)" />
        <circle cx="12" cy="12" r="1.2" fill="#22C55E" />
      </svg>
    ),
  },
  {
    name: 'LlamaIndex',
    tag: 'Data Agents',
    color: '#A855F7',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* LlamaIndex geometric origami llama silhouette */}
        <path
          d="M8 20h3v-6h2v6h3v-8l-1.5-2.5V5l-1.8 1.8-.7-1.8-.7 1.8L10.5 5v4.5L9 12v8H8z"
          fill="#A855F7"
        />
        <circle cx="12.2" cy="7.8" r="0.8" fill="#FFFFFF" />
        <path d="M12.5 12h3l1.5 2.5v3.5" stroke="#C084FC" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    name: 'OpenAI Swarm',
    tag: 'Multi-Agent',
    color: '#10A37F',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* OpenAI rosette swirl */}
        <g stroke="#10A37F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a4.5 4.5 0 0 0-4.4 3.5A4.5 4.5 0 0 0 3.7 9a4.5 4.5 0 0 0 .8 5.6 4.5 4.5 0 0 0 3.6 4.3A4.5 4.5 0 0 0 12 22a4.5 4.5 0 0 0 4.4-3.5 4.5 4.5 0 0 0 3.9-3.5 4.5 4.5 0 0 0-.8-5.6 4.5 4.5 0 0 0-3.6-4.3A4.5 4.5 0 0 0 12 2z" />
          <path d="M12 6.5v11M7.5 9l9 6M7.5 15l9-6" strokeOpacity="0.6" strokeWidth="1.4" />
        </g>
      </svg>
    ),
  },
  {
    name: 'Model Context Protocol',
    tag: 'Standard',
    color: '#C084FC',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Official MCP node protocol connector */}
        <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" stroke="#C084FC" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="7.5" r="2" fill="#E879F9" />
        <circle cx="7.5" cy="15" r="2" fill="#A855F7" />
        <circle cx="16.5" cy="15" r="2" fill="#A855F7" />
        <path d="M12 9.5v3m-3 1.5l2-1.5m4 0l-2 1.5" stroke="#E879F9" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    name: 'AutoGen',
    tag: 'Conversational',
    color: '#0078D4',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Microsoft AutoGen neural agent topology */}
        <circle cx="6" cy="6" r="2.8" stroke="#0078D4" strokeWidth="1.8" fill="#0078D4" fillOpacity="0.25" />
        <circle cx="18" cy="6" r="2.8" stroke="#0078D4" strokeWidth="1.8" fill="#0078D4" fillOpacity="0.25" />
        <circle cx="12" cy="17.5" r="3.2" stroke="#38BDF8" strokeWidth="2" fill="#38BDF8" fillOpacity="0.35" />
        <path d="M8 8l3 7m5-7l-3 7M8.8 6h6.4" stroke="#60A5FA" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    name: 'Python SDK',
    tag: 'Integration',
    color: '#3776AB',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Official Python dual-snake emblem */}
        <path
          d="M11.9 2c-4.4 0-4.1 1.9-4.1 1.9l.01 2h4.2v.6H6.1S3.5 6.2 3.5 10.6s2.3 4.3 2.3 4.3h1.4v-2s-.1-2.4 2.4-2.4h4.1s2.3.05 2.3-2.3V4.3S16.3 2 11.9 2zm-1.3 1.2c.4 0 .7.3.7.7s-.3.7-.7.7-.7-.3-.7-.7.3-.7.7-.7z"
          fill="#3776AB"
        />
        <path
          d="M12.1 22c4.4 0 4.1-1.9 4.1-1.9l-.01-2h-4.2v-.6h5.9s2.6.3 2.6-4.1-2.3-4.3-2.3-4.3h-1.4v2s.1 2.4-2.4 2.4H10.3s-2.3-.05-2.3 2.3v3.9s-.3 2.3 4.1 2.3zm1.3-1.2c-.4 0-.7-.3-.7-.7s.3-.7.7-.7.7.3.7.7-.3.7-.7.7z"
          fill="#FFD438"
        />
      </svg>
    ),
  },
  {
    name: 'Docker Compose',
    tag: 'Container',
    color: '#0DB7ED',
    renderLogo: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Official Docker whale and containers mark */}
        <rect x="7" y="6" width="2" height="2" fill="#0DB7ED" />
        <rect x="10" y="6" width="2" height="2" fill="#0DB7ED" />
        <rect x="13" y="6" width="2" height="2" fill="#0DB7ED" />
        <rect x="4" y="9" width="2" height="2" fill="#0DB7ED" />
        <rect x="7" y="9" width="2" height="2" fill="#0DB7ED" />
        <rect x="10" y="9" width="2" height="2" fill="#0DB7ED" />
        <rect x="13" y="9" width="2" height="2" fill="#0DB7ED" />
        <path
          d="M21.5 11.5c-.3-.2-1.2-.3-2 .2-.2-.5-.6-1-1.1-1.2l-.5-.3-.3.5c-.5 1-.4 2.2.2 3-1 .6-2.5.8-4.1.8H2.5c-.4 1.5.3 3.3 1.6 4.3 1.9 1.4 5 1.4 8 1.4 4.1 0 8-1.6 9-5.2.7-.1 1.5-.6 1.7-1.5.3-.6.1-1.6-1.3-2z"
          fill="#0DB7ED"
        />
      </svg>
    ),
  },
];

export function EcosystemMarquee() {
  const doubled = [...CLIENTS, ...CLIENTS];

  return (
    <section className="lp-ecosystem-section" aria-label="Supported Agent Ecosystem">
      <div className="lp-ecosystem-inner">
        <span className="lp-ecosystem-eyebrow">
          TRANSPARENT IN-LINE ENFORCEMENT ACROSS EVERY MCP CLIENT
        </span>
        <p className="lp-ecosystem-sub">
          Works out-of-the-box with any client, IDE, or framework speaking the Model Context Protocol.
        </p>
        <div className="lp-marquee-container">
          <div className="lp-marquee-track">
            {doubled.map((client, idx) => (
              <div key={`${client.name}-${idx}`} className="lp-marquee-item">
                <span className="lp-marquee-icon" aria-hidden="true">
                  {client.renderLogo()}
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
