'use client';

import { useEffect, useState } from 'react';

const EVENTS = [
  { tool: 'filesystem/read', rule: 'block-sensitive-paths', status: 'blocked' as const, arg: '/etc/passwd' },
  { tool: 'github/create_pr', rule: 'allow', status: 'allowed' as const, arg: 'feat/auth-fix' },
  { tool: 'shell/exec', rule: 'block-shell-injection', status: 'blocked' as const, arg: 'curl | bash' },
  { tool: 'postgres/query', rule: 'rate-limit', status: 'allowed' as const, arg: 'SELECT id FROM users LIMIT 10' },
  { tool: 'slack/post', rule: 'secret-exfil', status: 'blocked' as const, arg: 'sk-live-…' },
];

export function EnforcementFeedDemo() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => {
      setIndex((i) => (i + 1) % EVENTS.length);
      setVisible((v) => Math.min(v + 1, EVENTS.length));
    }, 2200);
    return () => clearInterval(tick);
  }, []);

  const shown = EVENTS.slice(0, Math.max(visible, 1)).reverse();

  return (
    <div className="demo-enforcement">
      <div className="demo-enforcement-header">
        <span className="demo-live-dot" />
        Live tool-call feed
      </div>
      <ul className="demo-enforcement-list">
        {shown.map((e, i) => (
          <li
            key={`${e.tool}-${i}`}
            className={`demo-event demo-event-${e.status}${i === 0 ? ' demo-event-new' : ''}`}
          >
            <span className={`demo-event-badge demo-event-badge-${e.status}`}>
              {e.status === 'blocked' ? 'BLOCKED' : 'ALLOWED'}
            </span>
            <div className="demo-event-body">
              <strong>{e.tool}</strong>
              <span className="muted">{e.rule}</span>
              <code>{e.arg}</code>
            </div>
          </li>
        ))}
      </ul>
      <p className="demo-caption muted">
        BlockGuard enforced {EVENTS[index].status} on <code>{EVENTS[index].tool}</code>
      </p>
    </div>
  );
}
