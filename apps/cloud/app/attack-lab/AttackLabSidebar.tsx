'use client';

import { useEffect, useState } from 'react';
import { OUTLINE } from './data';

/** Every anchor on the page, in document order: each group, then the attacks under it. */
const ANCHORS = OUTLINE.flatMap((group) => [group.id, ...group.items.map((item) => item.id)]);

/**
 * The Attack Lab outline, styled like the docs sidebar: groups with their attacks nested under
 * them, the one being read highlighted. On narrow screens it becomes a scrolling row of groups.
 */
export function AttackLabSidebar() {
  const [active, setActive] = useState(ANCHORS[0]);

  useEffect(() => {
    const targets = ANCHORS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    let frame = 0;
    // The current anchor is the last one whose top has passed a line 30% down the viewport, so an
    // attack takes over from its group as soon as the reader reaches it.
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = targets[0]?.id;
      for (const el of targets) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      if (current) setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <nav className="docs__nav" aria-label="Attack Lab">
      <p className="label docs__nav-title">
        <a href="#top">Attack Lab</a>
      </p>
      <ul className="docs__topics">
        {OUTLINE.map((group) => {
          const isCurrent = group.id === active || group.items.some((item) => item.id === active);
          return (
            <li key={group.id}>
              <a
                href={`#${group.id}`}
                className={`docs__topic${isCurrent ? ' is-current' : ''}${group.id === active ? ' is-active' : ''}`}
                aria-current={group.id === active ? 'location' : undefined}
              >
                {group.label}
              </a>
              {group.items.length ? (
                <ul className="docs__sections">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={active === item.id ? 'is-active' : undefined}
                        aria-current={active === item.id ? 'location' : undefined}
                      >
                        {item.label}
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
