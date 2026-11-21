import Link from 'next/link';
import { Flip } from '@/components/ui/Flip';
import { HeroBackdrop } from './HeroBackdrop';

type Props = {
  session: boolean;
};

export function HeroSection(_props: Props) {
  return (
    <div className="hero-wrap">
      <HeroBackdrop />
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero__copy">
          <h1 id="hero-title" className="hero__title">
            <span>
              <span className="hero__brand">Mastyf</span> guards every
            </span>
            <span>action your AI agents take.</span>
          </h1>
          <p className="hero__lead">
            It sits between your agents and your files, terminal and online accounts, and checks each action against
            your rules before it runs.
          </p>
          <div className="hero__actions">
            <Link href="/docs" className="btn btn-glass btn-lg" data-magnetic>
              <Flip>Read the docs</Flip>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
