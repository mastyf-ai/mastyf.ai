import Link from 'next/link';
import { ArrowRight, Check, FileSearch, GitBranch, Terminal } from 'lucide-react';

/**
 * The offer: a Damage Ceiling Report from 30 days of read-only logs, plus the open-source research preview.
 * The sample report uses the fictional "Acme" company from the public break-it sandbox (same policy file).
 */

// From `authority ceiling --k 1` on the sandbox policy (policies/default.json): one stolen login, the decision
// engine assumed bypassed, approvers not compromised.
const SAMPLE = [
  { who: 'svc:export-job', what: 'customer records', today: 'Everything it can read', with: '20,000 / day', note: 'only to the warehouse' },
  { who: 'human:alice', what: 'customer records', today: 'Everything she can read', with: '5,000 / day', note: 'support agent' },
  { who: 'human:bob', what: 'SSH keys and secrets', today: 'All of them', with: '100 keys + 20 secrets / day', note: 'on-call engineer' },
  { who: 'svc:backup', what: 'backup deletion', today: 'Instant', with: 'Waits 72 h, cancellable', note: 'ransomware path' },
  { who: 'agent:support-bot', what: 'customer records', today: 'Whatever it is told', with: '1,000 / day', note: 'AI agent' },
];

const GETS = [
  'The most a stolen login could take, per account and per day, and the five accounts that matter most',
  'What your logs already show: new devices, new apps given access, secrets created, unusual sign-ins',
  'The exact limits that would cap each account, ready to paste into a policy',
  'A shadow run: how often Authority would have asked someone, per day, on your real activity',
];

export function CeilingAudit() {
  return (
    <div className="ca">
      <div className="ca__offer">
        <p className="ca__kicker"><FileSearch size={14} strokeWidth={1.75} aria-hidden="true" /> Damage Ceiling Report · 48 hours</p>
        <ul className="ca__gets">
          {GETS.map((g) => (
            <li key={g}><Check size={16} strokeWidth={2} aria-hidden="true" /><span>{g}</span></li>
          ))}
        </ul>
        <div className="ca__how">
          <div><strong>1</strong><span>Export 30 days of read-only logs: GitHub, Okta or AWS CloudTrail</span></div>
          <div><strong>2</strong><span>We run Authority in shadow mode. Nothing is installed, nothing is blocked.</span></div>
          <div><strong>3</strong><span>You get the report and a 30-minute walkthrough</span></div>
        </div>
        <div className="ca__cta">
          <Link href="/pilot" className="btn btn-primary">Get your report<ArrowRight size={14} strokeWidth={2} aria-hidden="true" /></Link>
          <span className="ca__price"><strong>Free</strong> for our first 10 companies</span>
        </div>
        <p className="ca__proof">
          We ran it on our own GitHub account first: 755 security events over 5 months. With ask-once approvals it
          would have interrupted us 0.33 times a day, and it flagged every OAuth client secret we generated.
        </p>
      </div>

      <figure className="ca__sample" aria-label="Sample report for the fictional company Acme">
        <figcaption>
          <span>Sample report</span>
          <span className="ca__tag">Acme Ltd · fictional company from our public sandbox</span>
        </figcaption>
        <div className="ca__table" role="table">
          <div className="ca__row ca__row--head" role="row">
            <span role="columnheader">Stolen account</span>
            <span role="columnheader">Could take today</span>
            <span role="columnheader">With Authority</span>
          </div>
          {SAMPLE.map((r) => (
            <div className="ca__row" role="row" key={r.who}>
              <span role="cell"><code>{r.who}</code><small>{r.what} · {r.note}</small></span>
              <span role="cell" className="ca__bad">{r.today}</span>
              <span role="cell" className="ca__good">{r.with}</span>
            </div>
          ))}
        </div>
        <p className="ca__foot">Worst case assumes the attacker also controls the decision engine. Limits are enforced where the keys live.</p>
      </figure>
    </div>
  );
}

export function OpenSourceCard() {
  return (
    <div className="os">
      <a className="os__card" href="https://github.com/mastyf-ai/mastyf-authority" target="_blank" rel="noopener noreferrer">
        <GitBranch size={20} strokeWidth={1.75} aria-hidden="true" />
        <strong>Read every line that sets the ceiling</strong>
        <span>github.com/mastyf-ai/mastyf-authority · AGPL-3.0 · research preview</span>
      </a>
      <a className="os__card" href="https://github.com/mastyf-ai/mastyf-authority/tree/main/sandbox" target="_blank" rel="noopener noreferrer">
        <Terminal size={20} strokeWidth={1.75} aria-hidden="true" />
        <strong>Break it on your laptop</strong>
        <code>cd sandbox &amp;&amp; docker compose up -d --build</code>
        <span>A fake company on the real components. Take more than 5,000 records and you capture the flag.</span>
      </a>
      <Link className="os__card" href="/pilot">
        <FileSearch size={20} strokeWidth={1.75} aria-hidden="true" />
        <strong>Enterprise and commercial licence</strong>
        <span>Log connectors, shadow-mode pilots, SCIM, leak tracing, hosted cloud, support. Talk to us.</span>
      </Link>
    </div>
  );
}

const PILOTS = [
  {
    kicker: 'Pilot 0 · Mastyf itself',
    data: 'Our own GitHub security log, 5 months',
    big: '0.33',
    unit: 'interruptions a day',
    note: 'Flagged every OAuth client secret we created.',
  },
  {
    kicker: 'Pilot 1 · A real enterprise',
    data: "Los Alamos National Laboratory's public sign-in logs: 300 employees and 94 compromised accounts",
    big: '60 of 94',
    unit: 'compromised accounts caught at the first malicious login',
    note: 'At 0.20 interruptions per person per day.',
  },
  {
    kicker: 'Attack replay',
    data: '71 real attack log sets from AWS CloudTrail, Okta and GitHub (Splunk attack_data)',
    big: '55 of 62',
    unit: 'attacks stopped, escalated or held',
    note: '4 of the 7 misses had already been blocked by Okta.',
  },
];

export function PilotResults() {
  return (
    <div className="pr">
      <div className="pr__grid">
        {PILOTS.map((p) => (
          <article key={p.kicker} className="pr__card">
            <p className="pr__kicker">{p.kicker}</p>
            <p className="pr__big">{p.big}</p>
            <p className="pr__unit">{p.unit}</p>
            <p className="pr__note">{p.note}</p>
            <p className="pr__data">{p.data}</p>
          </article>
        ))}
      </div>
      <p className="pr__lesson">
        <strong>What Pilot 1 changed:</strong> on raw sign-ins, the behavioural model would have interrupted each person
        about 31 times a day. Sign-ins are now judged by device binding (0.20 a day), and the model is kept for
        high-impact actions like exports, secrets and deletions.
      </p>
      <p className="pr__honest">
        Not customer pilots yet: our own account, a real organisation&apos;s public logs, and public attack logs. Method,
        caveats and every variant we measured:{' '}
        <a href="https://github.com/mastyf-ai/mastyf-authority/blob/main/PILOTS.md" target="_blank" rel="noopener noreferrer">PILOTS.md</a>.
        Want yours? The <a href="#report">free Damage Ceiling Report</a> is the same pilot on 30 days of your logs.
      </p>
    </div>
  );
}
