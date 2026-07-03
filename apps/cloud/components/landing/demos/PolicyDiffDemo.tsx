'use client';

import { useEffect, useState } from 'react';

const MODES = ['audit', 'warn', 'block'] as const;

export function PolicyDiffDemo() {
  const [modeIdx, setModeIdx] = useState(2);

  useEffect(() => {
    const t = setInterval(() => setModeIdx((i) => (i + 1) % MODES.length), 3000);
    return () => clearInterval(t);
  }, []);

  const mode = MODES[modeIdx];

  return (
    <div className="demo-policy">
      <div className="demo-policy-modes">
        {MODES.map((m, i) => (
          <span key={m} className={`demo-policy-mode${i === modeIdx ? ' demo-policy-mode-active' : ''}`}>
            {m}
          </span>
        ))}
      </div>
      <div className="demo-policy-diff">
        <div className="demo-policy-pane">
          <span className="demo-policy-label">Before</span>
          <pre>{`rules:
  - name: block-secret-exfil
    action: pass
    pattern: "api[_-]?key"`}</pre>
        </div>
        <div className="demo-policy-arrow">→</div>
        <div className="demo-policy-pane demo-policy-pane-new">
          <span className="demo-policy-label">After · {mode}</span>
          <pre>{`rules:
  - name: block-secret-exfil
    action: ${mode === 'audit' ? 'pass' : 'block'}
    pattern: "api[_-]?key"
  - name: rate-limit-calls
    action: block
    maxCallsPerMinute: 120`}</pre>
        </div>
      </div>
    </div>
  );
}
