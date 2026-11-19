import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Download, Terminal } from 'lucide-react';
import { Flip } from '@/components/ui/Flip';

const STEPS = [
  {
    title: 'Your agent proposes',
    body: 'The model decides to call a tool: read a file, run a command, send a request.',
  },
  {
    title: 'Mastyf decides',
    body: 'The call is checked against your policy before dispatch. The model cannot override the decision.',
  },
  {
    title: 'Your tools execute',
    body: 'Only approved calls reach your files, shell, and network. Blocked calls send zero bytes.',
  },
] as const;

export function HowItWorks() {
  return (
    <section className="section" aria-labelledby="how-title">
      <header className="sec-head sec-head--split">
        <div>
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">One boundary between the model and your systems</h2>
        </div>
        <Link href="/docs/how-it-works" className="link-icon sec-head__link">
          How enforcement works
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>
      <ol className="steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className={`step${index === 1 ? ' step--key' : ''}`}>
            <span className="step__n">{String(index + 1).padStart(2, '0')}</span>
            <h3>
              <Flip light="var(--accent)">{step.title}</Flip>
            </h3>
            <p>{step.body}</p>
            <span className="step__ghost" aria-hidden="true">
              {index + 1}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const PRODUCTS = [
  {
    id: 'shield',
    name: 'Shield',
    line: 'Desktop app that guards local agents like Claude Desktop and Cursor.',
    tags: ['macOS', 'Windows', 'Linux'],
  },
  {
    id: 'gateway',
    name: 'Gateway',
    line: 'Fail-closed proxy for agents running in production.',
    tags: ['MCP stdio & HTTP', 'Audit or enforce'],
  },
  {
    id: 'swarm',
    name: 'Swarm',
    line: 'Attack tests for your agents, run in CI.',
    tags: ['GitHub Actions', 'Regression gates'],
  },
  {
    id: 'trust',
    name: 'Trust',
    line: 'Security scores for the MCP packages your agents install.',
    tags: ['Trust scores', 'CVE index'],
  },
  {
    id: 'control-plane',
    name: 'Control Plane',
    line: 'Fleet-wide policy, signed audit trails, and SSO.',
    tags: ['SSO', 'Audit trails', 'SIEM export'],
  },
] as const;

export function ProductRow() {
  return (
    <section className="section" aria-labelledby="products-title">
      <header className="sec-head sec-head--split">
        <div>
          <p className="eyebrow">Platform — five parts</p>
          <h2 id="products-title">One policy, wherever your agents run</h2>
        </div>
        <Link href="/docs/how-it-works#components" className="link-icon sec-head__link">
          Compare the components
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>
      <ol className="rows">
        {PRODUCTS.map((product, index) => (
          <li key={product.id}>
            <Link href={`/docs#${product.id}`} className="row">
              <span className="row__n">{String(index + 1).padStart(2, '0')}</span>
              <span className="row__name">
                <Flip light="var(--accent)">{product.name}</Flip>
              </span>
              <span className="row__body">
                <span className="row__line">{product.line}</span>
                <span className="row__tags">
                  {product.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </span>
              </span>
              <span className="row__go" aria-hidden="true">
                <ArrowUpRight size={16} strokeWidth={1.75} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const PROOF = [
  { value: '99.52%', label: 'Attack defense, AgentDojo (paper)' },
  { value: '98.43%', label: 'Attack defense, InjecAgent (paper)' },
  { value: '~1.5 ms', label: 'Rule check, median' },
  { value: '0 bytes', label: 'Reach a tool on block' },
] as const;

export function ProofRow() {
  return (
    <section className="section" aria-labelledby="proof-title">
      <header className="sec-head sec-head--split">
        <div>
          <p className="eyebrow">Evidence — public benchmarks</p>
          <h2 id="proof-title">Measured, with the method published</h2>
        </div>
        <span className="sec-head__links">
          <Link href="/docs/performance#benchmarks" className="link-icon">
            Benchmarks and methodology
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/research" className="link-icon">
            Read the paper
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </span>
      </header>
      <dl className="stats">
        {PROOF.map((item) => (
          <div key={item.label} className="stat">
            <dt>{item.label}</dt>
            <dd>
              <Flip light="var(--accent)">{item.value}</Flip>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ClosingCta() {
  return (
    <section className="section closing" id="get-started" aria-labelledby="closing-title">
      <p className="eyebrow">Get started</p>
      <h2 id="closing-title" className="closing__title">
        Give your agents a boundary.
      </h2>
      <p className="closing__lead">
        Protect a desktop agent in minutes, or put the Gateway in front of your production fleet.
      </p>
      <div className="closing__actions">
        <Link href="/download" className="btn btn-primary btn-lg" data-magnetic>
          <Download size={16} strokeWidth={2} aria-hidden="true" />
          <Flip>Download Mastyf Shield</Flip>
        </Link>
        <Link href="/docs/getting-started#free" className="btn btn-lg" data-magnetic>
          <Terminal size={16} strokeWidth={1.75} aria-hidden="true" />
          <Flip light="var(--accent)">Quickstart</Flip>
        </Link>
      </div>
    </section>
  );
}
