'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOC_TOPICS, docHref } from './topics';

/**
 * Every docs topic, with the current topic's sections listed under it and the section in
 * view highlighted. On narrow screens it becomes a scrolling row of topics.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const current = DOC_TOPICS.find((topic) => pathname === docHref(topic.slug));
  const [active, setActive] = useState(current?.sections[0]?.id);

  useEffect(() => {
    if (!current) return;
    setActive(current.sections[0]?.id);
    const targets = current.sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-18% 0px -72% 0px' },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [current]);

  return (
    <nav className="docs__nav" aria-label="Documentation">
      <p className="label docs__nav-title">
        <Link href="/docs">Documentation</Link>
      </p>
      <ul className="docs__topics">
        {DOC_TOPICS.map((topic) => {
          const isCurrent = topic === current;
          return (
            <li key={topic.slug}>
              <Link
                href={docHref(topic.slug)}
                className={`docs__topic${isCurrent ? ' is-current' : ''}`}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {topic.title}
              </Link>
              {isCurrent && topic.sections.length > 1 ? (
                <ul className="docs__sections">
                  {topic.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className={active === section.id ? 'is-active' : undefined}
                        aria-current={active === section.id ? 'location' : undefined}
                      >
                        {section.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
