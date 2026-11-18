import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { Flip } from '@/components/ui/Flip';
import { HeroBackdrop } from './HeroBackdrop';

type Props = {
  session: boolean;
};

const FACTS = [
  { label: 'Layer', value: 'MCP tool calls' },
  { label: 'Decision', value: 'Under 4.8 µs' },
  { label: 'License', value: 'AGPL-3.0' },
] as const;

export function HeroSection(_props: Props) {
  return (
    <div className="hero-wrap">
      <HeroBackdrop />
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow eyebrow--dot">Open source · AI agent security</p>
          <h1 id="hero-title" className="hero__title">
            <span>Your model proposes.</span>
            <span>Mastyf decides.</span>
          </h1>
          <p className="hero__lead">
            Your AI can reason. Mastyf controls what it can execute: <mark>every tool call</mark> is checked
            against your policy, and unsafe ones are stopped <mark className="mark--ok">before they run</mark>.
          </p>
          <div className="hero__actions">
            <Link href="/download" className="btn btn-primary btn-lg" data-magnetic>
              <Download size={16} strokeWidth={2} aria-hidden="true" />
              <Flip>Download Shield</Flip>
            </Link>
            <Link href="/docs" className="btn btn-lg" data-magnetic>
              <Flip light="var(--accent)">Read the docs</Flip>
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
          <dl className="hero__facts">
            {FACTS.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
