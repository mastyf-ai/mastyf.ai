import type { CSSProperties } from 'react';
import Link from 'next/link';
import { WORKS_WITH } from '@/lib/works-with';

/**
 * The tools Mastyf connects to, directly under the hero: a centred heading over a ribbon that
 * scrolls sideways without end. The list is drawn twice so the loop is seamless; the copy is
 * hidden from assistive tech and keyboard focus.
 */
export function WorksWithRibbon() {
  const list = (copy: boolean) => (
    <ul className="works-with__list" aria-hidden={copy || undefined}>
      {WORKS_WITH.map((tool) => (
        <li key={tool.name}>
          <Link href={tool.href} className="works-with__item" tabIndex={copy ? -1 : undefined}>
            <span
              className="works-with__mark"
              aria-hidden="true"
              style={{ '--logo': `url(${tool.logo})` } as CSSProperties}
            />
            <span>{tool.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="works-with" aria-labelledby="works-with-title">
      <h2 id="works-with-title" className="works-with__title">
        Works with
      </h2>
      <div className="works-with__viewport">
        {/* Four copies: the loop moves by half the track, and half (two copies) is always wider
            than the screen, so the next pass is already in place when the loop restarts. */}
        <div className="works-with__track">
          {list(false)}
          {list(true)}
          {list(true)}
          {list(true)}
        </div>
      </div>
    </section>
  );
}
