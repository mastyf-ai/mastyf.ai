'use client';

import { useEffect, useState } from 'react';

const DIMENSIONS = [
  { label: 'Supply chain', value: 94, color: '#2d6a4f' },
  { label: 'Runtime behavior', value: 88, color: '#c5a059' },
  { label: 'Policy coverage', value: 91, color: '#1d3557' },
  { label: 'Corpus parity', value: 96, color: '#457b9d' },
];

export function ScoreBreakdownDemo() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % DIMENSIONS.length), 2500);
    return () => clearInterval(t);
  }, []);

  const total = Math.round(DIMENSIONS.reduce((s, d) => s + d.value, 0) / DIMENSIONS.length);

  return (
    <div className="demo-score">
      <div className="demo-score-total">
        <span className="demo-score-big">{total}</span>
        <span className="muted">composite trust</span>
      </div>
      <ul className="demo-score-bars">
        {DIMENSIONS.map((d, i) => (
          <li key={d.label} className={i === active ? 'demo-score-bar-active' : ''}>
            <div className="demo-score-bar-label">
              <span>{d.label}</span>
              <strong>{d.value}</strong>
            </div>
            <div className="demo-score-bar-track">
              <div
                className="demo-score-bar-fill"
                style={{ width: `${d.value}%`, background: d.color }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
