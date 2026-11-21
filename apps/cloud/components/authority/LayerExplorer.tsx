'use client';

import { useState } from 'react';

const LAYERS = [
  {
    id: 'signin', title: 'Sign-in & device',
    what: 'Every person’s laptop or phone holds a passkey. Data is only ever released to a registered device, after a fingerprint or PIN.',
    why: 'Phished passwords, stolen cookies and leaked tokens are the most common way in. Here they open nothing.',
    stat: '0 records', statLabel: 'for a stolen password or session',
  },
  {
    id: 'engine', title: 'Decision engine',
    what: 'Before anything sensitive happens, the request is checked against rules and against what is normal for that person: first-time behaviour, unusual volume, odd destinations.',
    why: 'Catches misuse early and asks a second person when something is unusual.',
    stat: '179 of 187', statLabel: 'real insiders flagged (CERT), no attack examples used',
  },
  {
    id: 'vault', title: 'Key vault',
    what: 'Every record is locked with its own key. A separate vault hands out keys within daily budgets, refuses bait records, and only for the person’s own cases and incoming calls (assigned automatically by the phone or helpdesk system).',
    why: 'It does not trust the decision engine. Even if everything in front of it is hacked, the most anyone can take is a known number.',
    stat: '≤ 5,000', statLabel: 'customer records a day, even with the engine hacked',
  },
  {
    id: 'gates', title: 'Change & undo gates',
    what: 'Gates sit next to storage, code, the website and payments. Publishing is re-checked; history rewrites need two people; anything irreversible waits out an undo window.',
    why: 'Ransomware, wipers and fraud all end with an action that cannot be taken back. Here it can.',
    stat: '0 of 12', statLabel: 'mass deletions executed in a ransomware run',
  },
  {
    id: 'trace', title: 'Marks, bait & alerts',
    what: 'Every copy of data that leaves is invisibly unique to the person who asked for it, and seeded with decoys.',
    why: 'Quiet theft still gets caught: a leaked file points to the account it came from.',
    stat: '20 records', statLabel: 'are enough to identify the source of a leak',
  },
  {
    id: 'agents', title: 'AI agent limits',
    what: 'An AI agent acts only inside a task a person approved: named actions, named recipients, record caps, a time limit.',
    why: 'Agents read web pages and e-mails that can hijack them. A hijacked agent still cannot leave its task.',
    stat: '1.6%', statLabel: 'of worst-case hijacks succeed (AgentDojo), 0% with input tracking',
  },
] as const;

export function LayerExplorer() {
  const [active, setActive] = useState<(typeof LAYERS)[number]['id']>('vault');
  const l = LAYERS.find((x) => x.id === active)!;
  return (
    <div className="auth-layers">
      <div className="auth-layers__stack" role="tablist" aria-label="Layers">
        {LAYERS.map((x, i) => (
          <button key={x.id} role="tab" aria-selected={active === x.id} className="auth-layers__tab"
                  onClick={() => setActive(x.id)} style={{ ['--i' as string]: i }}>
            <span className="auth-layers__num">{String(i + 1).padStart(2, '0')}</span>
            <span>{x.title}</span>
          </button>
        ))}
      </div>
      <div className="auth-layers__panel" role="tabpanel" key={l.id}>
        <h3>{l.title}</h3>
        <p className="auth-layers__what">{l.what}</p>
        <p className="auth-layers__why">{l.why}</p>
        <p className="auth-layers__stat"><strong>{l.stat}</strong> <span>{l.statLabel}</span></p>
      </div>
    </div>
  );
}
