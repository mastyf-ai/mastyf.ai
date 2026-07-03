'use client';

import { useEffect, useState } from 'react';

export function CostGuardDemo() {
  const [spent, setSpent] = useState(62);

  useEffect(() => {
    const t = setInterval(() => {
      setSpent((s) => {
        if (s >= 94) return 58;
        return s + Math.floor(Math.random() * 8) + 2;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  const pool = 100;
  const pct = Math.min(spent, pool);
  const status = pct >= 90 ? 'critical' : pct >= 75 ? 'warn' : 'ok';

  return (
    <div className="demo-cost">
      <div className="demo-cost-header">
        <span>Spend pool · agent-fleet-prod</span>
        <span className={`demo-cost-status demo-cost-${status}`}>
          {status === 'critical' ? 'Loop halt' : status === 'warn' ? 'Throttle' : 'Healthy'}
        </span>
      </div>
      <div className="demo-cost-meter">
        <div className="demo-cost-fill" style={{ width: `${pct}%` }} />
        <span className="demo-cost-label">${spent} / ${pool} daily cap</span>
      </div>
      <ul className="demo-cost-events">
        <li>Token burn · gpt-4o-mini · 12.4k tokens</li>
        <li>Economics gate · blocked recursive tool loop</li>
        <li>Upstream budget · 3 calls remaining this window</li>
      </ul>
    </div>
  );
}
