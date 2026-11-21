import type { CSSProperties } from 'react';
import Link from 'next/link';
import { WORKS_WITH } from '@/lib/works-with';

/** A quiet row of the tools Mastyf connects to, directly under the hero. */
export function WorksWithRibbon() {
  return (
    <section className="works-with" aria-labelledby="works-with-title">
      <h2 id="works-with-title" className="works-with__title">
        Works with
      </h2>
      <ul className="works-with__list">
        {WORKS_WITH.map((tool) => (
          <li key={tool.name}>
            <Link href={tool.href} className="works-with__item">
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
    </section>
  );
}
