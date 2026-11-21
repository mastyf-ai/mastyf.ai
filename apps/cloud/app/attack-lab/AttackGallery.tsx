'use client';

import { useEffect, useState } from 'react';
import { ATTACKS } from './data';
import { AttackSim } from './GateSim';

/**
 * Every attack on one stage: pick one and its recorded run plays in a single console, instead of a
 * console per attack down the page. Links to an attack's id (#ssrf-url and the like) still work:
 * they open that attack here.
 */
export function AttackGallery() {
  const [id, setId] = useState(ATTACKS.find((a) => a.section === 'novel')?.id ?? ATTACKS[0].id);
  const attack = ATTACKS.find((a) => a.id === id) ?? ATTACKS[0];

  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (ATTACKS.some((a) => a.id === h)) setId(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const groups: { label: string; section: 'novel' | 'common' }[] = [
    { label: 'Never seen in training', section: 'novel' },
    { label: 'Common', section: 'common' },
  ];

  return (
    <div className="alab-gallery">
      {/* Anchors for the old per-attack links and the sidebar. */}
      {ATTACKS.map((a) => (
        <span key={a.id} id={a.id} className="alab-gallery__anchor" aria-hidden="true" />
      ))}

      <div className="alab-gallery__picker">
        {groups.map((g) => (
          <div key={g.section} className="alab-gallery__group" role="group" aria-label={g.label}>
            <span className="alab-gallery__group-label">{g.label}</span>
            <div className="alab-gallery__chips">
              {ATTACKS.filter((a) => a.section === g.section).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`alab-gallery__chip alab-gallery__chip--${a.section}`}
                  aria-pressed={a.id === id}
                  onClick={() => {
                    setId(a.id);
                    history.replaceState(null, '', `#${a.id}`);
                  }}
                >
                  {a.title}
                  {a.catch ? <span className="alab-gallery__catch">{a.catch}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="alab-gallery__how">{attack.how}</p>
      <AttackSim key={attack.id} a={attack} />
    </div>
  );
}
