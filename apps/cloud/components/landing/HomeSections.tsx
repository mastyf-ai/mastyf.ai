import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Flip } from '@/components/ui/Flip';

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
      <header className="sec-head">
        <h2 id="products-title">One policy, wherever your agents run</h2>
      </header>
      <ol className="rows">
        {PRODUCTS.map((product, index) => (
          <li key={product.id}>
            <Link href={`/docs#${product.id}`} className="row">
              <span className="row__head">
                <span className="row__name">
                  <Flip light="var(--accent)">{product.name}</Flip>
                </span>
                <span className="row__n" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
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
  { value: '99.52%', label: 'of attacks stopped on the AgentDojo benchmark, as reported in our paper' },
  { value: '98.43%', label: 'of attacks stopped on the InjecAgent benchmark, as reported in our paper' },
  { value: '~1.5 ms', label: 'typical time to check a request against your rules' },
  { value: '0 bytes', label: 'reach your tools when a request is stopped' },
] as const;

export function ProofRow() {
  return (
    <section className="section" aria-labelledby="proof-title">
      <header className="sec-head">
        <h2 id="proof-title">Measured, with the method published</h2>
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
      <h2 id="closing-title" className="closing__title">
        Give your agents a boundary.
      </h2>
      <p className="closing__lead">
        Protect your desktop agents with Shield in minutes, or add the free checks to an agent you build.
      </p>
      <div className="closing__actions">
        <Link href="/login" className="btn btn-luxe btn-lg" data-magnetic>
          <Flip>Get started</Flip>
        </Link>
      </div>
    </section>
  );
}
