'use client';

import { useState } from 'react';
import { AUTHORITY_DATA } from '@/lib/authority/data';

const fmt = (n: number | null) => (n === null ? 'unbounded' : n.toLocaleString('en-US'));

export function CeilingCalculator() {
  const [k, setK] = useState(1);
  const [devices, setDevices] = useState(true);
  const rows = AUTHORITY_DATA.ceiling[`${k}-${devices ? 1 : 0}` as keyof typeof AUTHORITY_DATA.ceiling];
  const max = Math.max(...rows.map((r) => r.day ?? 0), 1);
  return (
    <div className="auth-ceiling">
      <div className="auth-ceiling__controls">
        <label className="auth-ceiling__slider">
          <span>Accounts compromised together: <strong>{k}</strong></span>
          <input type="range" min={1} max={3} step={1} value={k} onChange={(e) => setK(Number(e.target.value))} />
        </label>
        <label className="auth-toggle">
          <input type="checkbox" checked={devices} onChange={(e) => setDevices(e.target.checked)} />
          <span>Attacker also controls their laptops</span>
        </label>
        <p className="auth-ceiling__assume">
          Worst combination of accounts, with the decision engine assumed hacked and any compromised approvers
          approving everything. Bait, alerts and people noticing are not counted.
        </p>
      </div>
      <table className="auth-ceiling__table">
        <thead>
          <tr><th>Data</th><th>Most in 24 hours</th><th>Most in 30 days</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cls}>
              <td>{r.cls}{r.who ? <small className="auth-who">worst: {r.who}</small> : null}</td>
              <td>
                <div className="auth-cell">
                  <span className="auth-bar"><span style={{ width: `${((r.day ?? 0) / max) * 100}%` }} /></span>
                  <span className="auth-num">{fmt(r.day)}</span>
                </div>
              </td>
              <td className="auth-num">{fmt(r.month)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="auth-footnote">
        Computed from the policy, then attacked: an adaptive attacker hammering the real vault for six simulated days
        never exceeded these numbers and reached at least 95% of them.
      </p>
    </div>
  );
}
