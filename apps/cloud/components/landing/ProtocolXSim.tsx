import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HowItWorksSim } from '@/app/attack-lab/GateSim';
import '@/app/attack-lab/attack-lab.css';

/**
 * Right after the hero: the Attack Lab's opening simulation, so a first-time visitor sees
 * Protocol X decide on a real tool call (one allowed, two blocked) before reading anything else.
 */
export function ProtocolXSim() {
  return (
    <section className="section" id="protocol-x" aria-labelledby="protocol-x-title">
      <header className="sec-head sec-head--split">
        <div>
          <p className="eyebrow">Protocol X · recorded runs</p>
          <h2 id="protocol-x-title">Every tool call is checked before it runs</h2>
        </div>
        <Link href="/attack-lab" className="link-icon sec-head__link">
          See every attack in the Attack Lab
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>
      <HowItWorksSim />
    </section>
  );
}
