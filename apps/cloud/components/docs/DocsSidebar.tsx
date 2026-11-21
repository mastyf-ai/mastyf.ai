'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { RailBrand } from './RailBrand';
import { DOC_TOPICS, docHref } from './topics';

/**
 * Every docs topic, with the current topic's sections listed under it and the section in
 * view highlighted. On narrow screens it becomes a scrolling row of topics.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const current = DOC_TOPICS.find((topic) => pathname === docHref(topic.slug));
  const [active, setActive] = useState(current?.sections[0]?.id);
  // Topics opened or closed by hand; any other topic is open only while it is the current page.
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
    // data-lenis-prevent: the wheel scrolls this rail, not the page's smooth scroll.
    <nav className="docs__nav" aria-label="Documentation" data-lenis-prevent>
      <RailBrand />
      <p className="label docs__nav-title">
        <Link href="/docs">Documentation</Link>
      </p>
      <ul className="docs__topics">
        {DOC_TOPICS.map((topic) => {
          const isCurrent = topic === current;
          const hasSections = topic.sections.length > 1;
          const isOpen = hasSections && (open[topic.slug] ?? isCurrent);
          const listId = `docs-sections-${topic.slug}`;
          return (
            <li key={topic.slug} className={hasSections ? 'docs__group' : undefined}>
              <div className="docs__topic-row">
                <Link
                  href={docHref(topic.slug)}
                  className={`docs__topic${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {topic.title}
                </Link>
                {hasSections ? (
                  <button
                    type="button"
                    className="docs__toggle"
                    aria-expanded={isOpen}
                    aria-controls={listId}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} the sections of ${topic.title}`}
                    onClick={() => setOpen((o) => ({ ...o, [topic.slug]: !isOpen }))}
                  >
                    <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {hasSections ? (
                // Always rendered so it can slide open and shut; closed, it is hidden from tabbing and screen readers.
                <div className={`docs__drawer${isOpen ? ' is-open' : ''}`} id={listId} aria-hidden={!isOpen}>
                  <ul className="docs__sections">
                    {topic.sections.map((section) => {
                      const href = isCurrent ? `#${section.id}` : docHref(topic.slug, section.id);
                      const on = isCurrent && active === section.id;
                      return (
                        <li key={section.id}>
                          <Link
                            href={href}
                            className={on ? 'is-active' : undefined}
                            aria-current={on ? 'location' : undefined}
                            tabIndex={isOpen ? undefined : -1}
                          >
                            {section.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
