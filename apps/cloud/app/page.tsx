import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { GITHUB_REPO_URL } from '@/lib/github-links';
import {
  DETECTION_LAYERS,
  FOUNDATION_POINTS,
  HOW_IT_WORKS,
  HERO_STATS,
  NPM_INSTALL_CMD,
  NPM_PACKAGE_NAME,
  NPM_PACKAGE_URL,
  NPM_PRODUCT_NAME,
  PLATFORM_FEATURES,
  PROBLEM_BULLETS,
  SITE_NAME,
  SWARM_AGENTS,
} from '@/components/landing/stats';
import { ThreatArchitectureTabs } from '@/components/landing/ThreatArchitectureTabs';
import { BadgeLookupWidget } from '@/components/BadgeLookupWidget';
import './landing.css';
import './certified/certified.css';
import './certified/socket-certified.css';

const CI_AGENTS = SWARM_AGENTS.filter((a) => a.track === 'CI');
const RUNTIME_AGENTS = SWARM_AGENTS.filter((a) => a.track === 'Runtime');

export default async function HomePage() {
  const session = await auth();

  return (
    <div className="landing">
      <nav className="landing-nav">
        <Link href="/" className="brand">
          <Image src="/logo.jpeg" alt="" width={28} height={28} className="landing-brand-logo" />
          <strong>mastyf.ai</strong>
        </Link>
        <div className="landing-nav-links">
          <a href="#product">Product</a>
          <Link href="/certified">Security scores</Link>
          <a href="#how">How it works</a>
          <a href="#architecture">Architecture</a>
          <a href="#foundation">{NPM_PRODUCT_NAME}</a>
          <Link href="/dashboard">Cloud console</Link>
          <a href={GITHUB_REPO_URL} rel="noopener noreferrer">
            GitHub
          </a>
          {session ? (
            <Link href="/dashboard">Dashboard</Link>
          ) : (
            <Link href="/login">Sign in</Link>
          )}
        </div>
      </nav>

      <div className="landing-wrap">
        <header className="landing-hero" id="top">
          <div className="landing-eyebrow">
            <span className="landing-pill landing-pill-accent">MCP security platform</span>
            <span className="landing-pill">Free to use</span>
          </div>
          <h1>Know which MCP servers are safe to trust</h1>
          <p className="lead">
            <strong>{SITE_NAME}</strong> scores MCP packages, hosts public trust badges, and gives you a
            free cloud console to manage policy — so teams can ship AI agents without guessing which tools
            are safe.
          </p>
          <p className="landing-hero-sub">
            Built on <strong>{NPM_PRODUCT_NAME}</strong>, the open-source MCP security proxy on npm.{' '}
            {SITE_NAME} is the platform; {NPM_PRODUCT_NAME} is the engine underneath.
          </p>
          <div className="landing-hero-cta">
            <Link href="/certified" className="btn btn-primary">
              Look up a package
            </Link>
            {session ? (
              <Link href="/dashboard" className="btn">
                Cloud console
              </Link>
            ) : (
              <Link href="/login" className="btn">
                Sign in free
              </Link>
            )}
            <a href={GITHUB_REPO_URL} className="btn" rel="noopener noreferrer">
              View source on GitHub
            </a>
            <Link href="/tutorials/site-walkthrough" className="btn">
              Watch walkthrough
            </Link>
          </div>
        </header>

        <section className="landing-stats" aria-label="At a glance">
          {HERO_STATS.map((s) => (
            <article key={s.label} className="landing-stat">
              <div className="landing-stat-value">{s.value}</div>
              <div className="landing-stat-label">{s.label}</div>
              <div className="landing-stat-detail">{s.detail}</div>
            </article>
          ))}
        </section>

        <section className="landing-section" id="product">
          <div className="landing-section-header">
            <h2>What is {SITE_NAME}?</h2>
            <p>
              A website and cloud platform for MCP security — not an npm package. Look up scores here,
              manage policy in the console, and embed badges in your docs.
            </p>
          </div>
          <div className="landing-product-grid">
            {PLATFORM_FEATURES.map((f) => (
              <article key={f.title} className="landing-product-card">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <Link href={f.href} className="landing-product-link">
                  {f.cta} →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-badge socket-style" id="scores">
          <div className="landing-section-header">
            <h2 className="landing-brand-heading">
              <Image src="/logo.jpeg" alt="" width={36} height={36} className="landing-brand-logo" />
              <span>
                {SITE_NAME} <span className="landing-brand-sub">security score</span>
              </span>
            </h2>
            <p>
              Try it now — enter any npm MCP package name. You get a score, grade, and fix suggestions
              without signing up.
            </p>
          </div>
          <div className="landing-badge-grid">
            <BadgeLookupWidget variant="hero" />
          </div>
          <div className="landing-how-inline">
            <div className="landing-how-inline-item">
              <strong>Static scan</strong>
              <span>CVE, supply chain, and registry signals — instant.</span>
            </div>
            <div className="landing-how-inline-item">
              <strong>Deep scan</strong>
              <span>Optional live probe for tool and auth signals.</span>
            </div>
            <div className="landing-how-inline-item">
              <strong>Embed</strong>
              <span>Copy badge markdown into your README.</span>
            </div>
          </div>
        </section>

        <section className="landing-section" id="how">
          <div className="landing-section-header">
            <h2>How it works</h2>
            <p>Three steps — no jargon required.</p>
          </div>
          <ol className="landing-steps">
            {HOW_IT_WORKS.map((step) => (
              <li key={step.step} className="landing-step-card">
                <span className="landing-step-num">{step.step}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-problem" id="problem">
          <div className="landing-section-header">
            <h2>Why this matters</h2>
            <p>MCP connects AI agents to real systems. Security teams need visibility before production.</p>
          </div>
          <ul className="landing-problem-list landing-problem-list-simple">
            {PROBLEM_BULLETS.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>

        <section className="landing-section" id="architecture">
          <div className="landing-section-header">
            <h2>How {SITE_NAME} detects threats</h2>
            <p>
              Scores and badges on this site are powered by the same engine as {NPM_PRODUCT_NAME} — a
              closed-loop Security Swarm that red-teams itself in CI and at runtime.
            </p>
          </div>

          <div className="landing-section-header" id="swarm">
            <h3 className="landing-subsection-title">Security Swarm</h3>
            <p>
              Two tracks: <strong>CI</strong> validates policy before merge; <strong>runtime</strong>{' '}
              learns from live proxy blocks. Solo analyze adds live MCP probes and dashboard reports.
            </p>
          </div>
          <figure className="landing-arch">
            <Image
              src="/assets/security-swarm-architecture.png"
              alt="mastyf.ai Security Swarm diagram: CI agents Scout through Report, runtime BlockGuard through Calibrator, connected to MCP proxy and dashboard"
              width={1400}
              height={900}
              priority
              style={{ width: '100%', height: 'auto' }}
            />
            <figcaption className="landing-arch-caption">
              {SITE_NAME} Security Swarm — corpus regression, evasion probes, parity checks, and instant
              attack learning on the hot path. Powered by {NPM_PRODUCT_NAME}.
            </figcaption>
          </figure>
          <div className="landing-tracks">
            <div className="landing-track landing-track-ci">
              <h3>CI track</h3>
              <ul className="landing-agent-list">
                {CI_AGENTS.map((a) => (
                  <li key={a.name}>
                    <span className="landing-agent-name">{a.name}</span>
                    <span className="landing-agent-role">{a.role}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="landing-track landing-track-runtime">
              <h3>Runtime track</h3>
              <ul className="landing-agent-list">
                {RUNTIME_AGENTS.map((a) => (
                  <li key={a.name}>
                    <span className="landing-agent-name">{a.name}</span>
                    <span className="landing-agent-role">{a.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="landing-section-header" style={{ marginTop: '3rem' }}>
            <h3 className="landing-subsection-title">Three-layer detection</h3>
            <p>Regex triage → schema validation → optional semantic LLM with circuit breaker and local fallback.</p>
          </div>
          <div className="landing-detection">
            {DETECTION_LAYERS.map((layer, i) => (
              <div key={layer.title} className="landing-layer">
                <div className="landing-layer-num">{i + 1}</div>
                <h3>{layer.title}</h3>
                <p>{layer.body}</p>
              </div>
            ))}
          </div>

          <div className="landing-section-header" id="threat-research" style={{ marginTop: '3rem' }}>
            <h3 className="landing-subsection-title">LLM threat discovery</h3>
            <p>
              Open-source pipelines turn live blocks and swarm bypasses into new adversarial fixtures.
              Human review for policy changes; autonomous corpus growth for regression.
            </p>
          </div>
          <ThreatArchitectureTabs />
        </section>

        <section className="landing-section landing-foundation" id="foundation">
          <div className="landing-section-header">
            <span className="landing-foundation-label">Under the hood</span>
            <h2>Built on {NPM_PRODUCT_NAME}</h2>
            <p>
              {SITE_NAME} is not published to npm. The runtime proxy that powers our detection is{' '}
              <strong>{NPM_PRODUCT_NAME}</strong> — MIT licensed, 11k+ monthly downloads, installable
              separately when you want self-hosted enforcement.
            </p>
          </div>
          <div className="landing-foundation-grid">
            {FOUNDATION_POINTS.map((p) => (
              <article key={p.title} className="landing-foundation-card">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
          <div className="landing-foundation-cta card">
            <div>
              <h3>Want the proxy on your own servers?</h3>
              <p className="muted">
                Install {NPM_PRODUCT_NAME} from npm. Use {SITE_NAME} when you want scores, badges, and
                cloud policy — use {NPM_PRODUCT_NAME} when you want a local gateway in front of your MCP
                servers.
              </p>
              <code className="landing-install-cmd">{NPM_INSTALL_CMD}</code>
            </div>
            <div className="landing-foundation-actions">
              <a href={NPM_PACKAGE_URL} className="btn btn-primary" rel="noopener noreferrer">
                {NPM_PACKAGE_NAME} on npm
              </a>
              <a href={GITHUB_REPO_URL} className="btn" rel="noopener noreferrer">
                {SITE_NAME} on GitHub
              </a>
            </div>
          </div>
        </section>

        <section className="landing-section landing-cloud" id="cloud">
          <div className="landing-cloud-inner card">
            <div>
              <h2>Cloud console</h2>
              <p className="muted">
                Sign in with Google or GitHub to edit policy YAML, copy tenant env snippets, rotate API
                keys, and optionally SSO into a self-hosted {NPM_PRODUCT_NAME} dashboard. Free — no credit
                card.
              </p>
            </div>
            <div className="landing-cloud-actions">
              {session ? (
                <Link href="/dashboard" className="btn btn-primary">
                  Go to dashboard
                </Link>
              ) : (
                <Link href="/login" className="btn btn-primary">
                  Sign in free
                </Link>
              )}
              <Link href="/dashboard/connect" className="btn">
                Connect self-hosted proxy
              </Link>
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <Image src="/logo.jpeg" alt="" width={24} height={24} className="landing-brand-logo" />
            <span>{SITE_NAME}</span>
          </div>
          <p className="landing-footer-tagline muted">
            MCP security scores and cloud console · Powered by {NPM_PRODUCT_NAME} on npm
          </p>
          <div className="footer-links">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/certified">Security scores</Link>
            <a href={GITHUB_REPO_URL} rel="noopener noreferrer">
              GitHub
            </a>
            <a href={NPM_PACKAGE_URL} rel="noopener noreferrer">
              npm · {NPM_PACKAGE_NAME}
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
