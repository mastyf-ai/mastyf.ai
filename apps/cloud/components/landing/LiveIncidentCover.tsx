'use client';

import React, { useEffect, useState, useMemo } from 'react';
import type { LiveIncidentItem } from '@/app/api/v1/live-incidents/route';

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return 'Recently';
  }
}

export function LiveIncidentCover() {
  const [incidents, setIncidents] = useState<LiveIncidentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [activeIncidentIndex, setActiveIncidentIndex] = useState<number>(0);

  // Fetch real-time live articles from our edge API route
  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/v1/live-incidents');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.incidents) && data.incidents.length > 0) {
          setIncidents(data.incidents);
        }
      }
    } catch (err) {
      console.error('Failed to load live incident wire:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
    // Poll for new live breaking dispatches every 60 seconds
    const interval = setInterval(fetchIncidents, 60000);
    return () => clearInterval(interval);
  }, []);

  // Track scroll position for the containment convergence transition
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      // Normalizes scroll progress from 0 (top of cover) to 1 (passed 350px)
      const progress = Math.min(Math.max(y / 350, 0), 1);
      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Filter incidents based on category pill
  const filteredIncidents = useMemo(() => {
    if (activeFilter === 'ALL') return incidents;
    return incidents.filter((item) => item.category === activeFilter);
  }, [incidents, activeFilter]);

  // Rotate featured alert every 5 seconds to simulate live wire breaking updates
  useEffect(() => {
    if (filteredIncidents.length === 0) return;
    const timer = setInterval(() => {
      setActiveIncidentIndex((prev) => (prev + 1) % Math.min(filteredIncidents.length, 6));
    }, 5500);
    return () => clearInterval(timer);
  }, [filteredIncidents.length]);

  return (
    <div className={`lp-incident-cover-wrapper ${scrollProgress > 0.6 ? 'is-collapsed' : ''}`}>
      {/* Background cybernetic grid lines */}
      <div className="lp-incident-cover-bg" aria-hidden="true">
        <div className="lp-incident-radial-glow" />
        <div className="lp-incident-grid-lines" />
      </div>

      <div className="lp-incident-cover-inner">
        {/* Real-time Status Bar */}
        <div className="lp-incident-telemetry-strip">
          <div className="lp-incident-live-beacon">
            <span className="lp-pulse-ring" />
            <span className="lp-pulse-dot" />
            <span className="lp-telemetry-label">REAL-TIME GLOBAL AGENT ATTACK WIRE</span>
          </div>
          <div className="lp-telemetry-meta">
            <span className="lp-telemetry-stat">
              FEED STATUS: <strong className="text-emerald-400">ACTIVE DISPATCH</strong>
            </span>
            <span className="lp-telemetry-sep">/</span>
            <span className="lp-telemetry-stat">
              LIVE COVERAGE: <strong>{incidents.length > 0 ? `${incidents.length} DISPATCHES` : 'STREAMING...'}</strong>
            </span>
          </div>
        </div>

        {/* Hero Incident Headline Hook */}
        <div className="lp-incident-hero-block">
          <h1 className="lp-incident-hero-title">
            AI AGENTS ARE GAINING ROOT ACCESS.{' '}
            <span className="lp-incident-title-gradient">
              ATTACKERS ARE TURNING THEM INTO WEAPONS.
            </span>
          </h1>
          <p className="lp-incident-hero-desc">
            Autonomous coding, DevOps, and customer agents execute unchecked bash, database, and API tools.
            Below is the live uncurated stream of real-world prompt injections, tool poisoning disclosures, and enterprise data breaches happening right now.
          </p>

          {/* Category Filter Pills */}
          <div className="lp-incident-filters" role="tablist" aria-label="Incident Categories">
            {[
              { id: 'ALL', label: 'All Live Dispatches' },
              { id: 'PROMPT_INJECTION', label: 'Prompt Injections' },
              { id: 'AGENT_EXPLOIT', label: 'Agent Tool Exploits' },
              { id: 'MCP_VULNERABILITY', label: 'MCP Protocol Risks' },
              { id: 'CREDENTIAL_LEAK', label: 'Credential Leaks' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`lp-incident-filter-btn ${activeFilter === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clustered Real-Time Newspaper Headline Cards */}
        <div
          className="lp-incident-cluster-grid"
          style={{
            transform: `scale(${1 - scrollProgress * 0.12}) translateY(-${scrollProgress * 40}px)`,
            opacity: Math.max(1 - scrollProgress * 1.3, 0),
            pointerEvents: scrollProgress > 0.8 ? 'none' : 'auto',
          }}
        >
          {loading && incidents.length === 0 ? (
            <div className="lp-incident-loading-state">
              <span className="lp-pulse-dot" />
              <span>Querying global cybersecurity newsrooms & threat feeds...</span>
            </div>
          ) : (
            filteredIncidents.slice(0, 6).map((item, idx) => {
              const isHighlight = idx === activeIncidentIndex;
              return (
                <article
                  key={item.id || idx}
                  className={`lp-incident-card ${isHighlight ? 'is-highlighted' : ''}`}
                >
                  <div className="lp-incident-card-top">
                    <span className="lp-incident-source-badge">
                      <span className="lp-incident-source-dot" />
                      {item.source}
                    </span>
                    <div className="lp-incident-badges">
                      <span className={`lp-severity-badge lp-sev-${item.severity.toLowerCase()}`}>
                        {item.severity}
                      </span>
                      <span className="lp-incident-time">{formatRelativeTime(item.publishedAt)}</span>
                    </div>
                  </div>

                  <h2 className="lp-incident-card-headline">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lp-incident-headline-link"
                    >
                      {item.title}
                    </a>
                  </h2>

                  <p className="lp-incident-card-snippet">{item.snippet}</p>

                  <div className="lp-incident-card-footer">
                    <span className="lp-incident-category-tag">
                      #{item.category.replace('_', ' ')}
                    </span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lp-incident-action-link"
                    >
                      Read Full Article <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Scroll Down Convergence Prompt & In-Line Barrier Anchor */}
        <div
          className="lp-incident-scroll-cue"
          style={{
            opacity: Math.max(1 - scrollProgress * 2, 0),
          }}
        >
          <div className="lp-scroll-beam-line" />
          <span className="lp-scroll-prompt-text">
            SCROLL DOWN TO DEPLOY MASTYF IN-LINE CONTAINMENT
          </span>
          <div className="lp-scroll-arrow">↓</div>
        </div>
      </div>

      {/* The Laser Containment Line that ignites when scrolled */}
      <div
        className="lp-incident-severance-laser"
        style={{
          opacity: Math.min(scrollProgress * 2, 1),
          transform: `scaleX(${Math.min(0.2 + scrollProgress * 0.8, 1)})`,
        }}
      >
        <div className="lp-laser-core" />
        <div className="lp-laser-glow" />
        <span className="lp-laser-badge">
          MASTYF SHIELD & GATEWAY /// IN-LINE PROTOCOL INTERCEPT ACTIVE (SUB-4.8µS)
        </span>
      </div>
    </div>
  );
}
