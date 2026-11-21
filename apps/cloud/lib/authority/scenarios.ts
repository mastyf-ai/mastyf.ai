// What happens when each kind of attacker goes after each goal. Every outcome is taken from a
// measured run (attack scorecard, damage-ceiling attack tests, AgentDojo worst case); the
// `evidence` field names the run. Describes behaviour, not implementation.

export type Layer = 'signin' | 'engine' | 'vault' | 'gates' | 'trace';
export type StepState = 'pass' | 'stop' | 'cap' | 'hold' | 'watch' | 'skip';
export type Verdict = 'Blocked' | 'Capped' | 'Held' | 'Contained';

export const LAYERS: { id: Layer; name: string; short: string }[] = [
  { id: 'signin', name: 'Sign-in & device', short: 'Device' },
  { id: 'engine', name: 'Decision engine', short: 'Engine' },
  { id: 'vault', name: 'Key vault', short: 'Vault' },
  { id: 'gates', name: 'Change & undo gates', short: 'Gates' },
  { id: 'trace', name: 'Marks, bait & alerts', short: 'Trace' },
];

export const ATTACKERS = [
  { id: 'password', label: 'Stolen password or session', hint: 'Phished login, leaked token, stolen cookie' },
  { id: 'laptop', label: 'Malware on a laptop', hint: 'Controls the person’s own registered device' },
  { id: 'engine', label: 'Decision engine hacked', hint: 'Signs any permission it likes' },
  { id: 'insiders', label: '3 accounts, 2 of them approvers', hint: 'A small group of insiders or a deep breach' },
] as const;

export const GOALS = [
  { id: 'data', label: 'Steal customer data' },
  { id: 'ransom', label: 'Ransomware / wipe backups' },
  { id: 'money', label: 'Wire money out' },
  { id: 'agent', label: 'Hijack an AI agent' },
  { id: 'script', label: 'Plant a skimmer on the website' },
] as const;

export type AttackerId = (typeof ATTACKERS)[number]['id'];
export type GoalId = (typeof GOALS)[number]['id'];

export type Outcome = {
  verdict: Verdict;
  headline: string;
  detail: string;
  evidence: string;
  steps: Partial<Record<Layer, { state: StepState; note: string }>>;
};

const S = (state: StepState, note: string) => ({ state, note });

export const OUTCOMES: Record<AttackerId, Record<GoalId, Outcome>> = {
  password: {
    data: {
      verdict: 'Blocked', headline: '0 records',
      detail: 'Data keys are only released to the person’s own registered device, after a fingerprint or PIN. A password, session cookie or API token alone opens nothing.',
      evidence: 'ATT&CK T1078 and T1550.004: 0 records, with and without the decision engine in the way.',
      steps: { signin: S('stop', 'No registered device: no keys'), engine: S('skip', ''), vault: S('skip', ''), gates: S('skip', ''), trace: S('watch', 'Attempt logged') },
    },
    ransom: {
      verdict: 'Blocked', headline: 'Nothing deleted',
      detail: 'Backup deletion needs two approvers and a 72-hour lock that anyone can cancel; people cannot overwrite production files at all.',
      evidence: 'ATT&CK T1490 refused; T1486 0 files for people.',
      steps: { signin: S('pass', 'Login accepted'), engine: S('stop', 'Always needs approval'), gates: S('stop', 'Gate: 2 approvers + 72 h'), trace: S('watch', 'Alert raised') },
    },
    money: {
      verdict: 'Held', headline: 'Held 4 hours',
      detail: 'Large payments wait out an undo window. The person, any approver or security can cancel; a burst of payments freezes the account.',
      evidence: 'ATT&CK T1657: held 4 h, cancellable.',
      steps: { signin: S('pass', 'Login accepted'), engine: S('pass', 'Within rules'), gates: S('hold', 'Undo window 4 h'), trace: S('watch', 'Person and security alerted') },
    },
    agent: {
      verdict: 'Blocked', headline: 'No agent session',
      detail: 'An agent only runs a task the person approved with their passkey. A stolen login cannot approve a task.',
      evidence: 'Agent limit tests: sessions need the person’s passkey.',
      steps: { signin: S('stop', 'Approval needs the passkey'), engine: S('skip', ''), vault: S('skip', ''), gates: S('skip', ''), trace: S('watch', 'Attempt logged') },
    },
    script: {
      verdict: 'Blocked', headline: 'Skimmer never served',
      detail: 'Every published script is re-checked at the CDN gate; skimmer, hidden loaders and remote code are refused even if publishing was allowed.',
      evidence: 'ATT&CK T1195.002 refused at the gate.',
      steps: { signin: S('pass', 'Login accepted'), engine: S('stop', 'Integrity check: block'), gates: S('stop', 'Gate re-checks the file'), trace: S('watch', 'Alert raised') },
    },
  },
  laptop: {
    data: {
      verdict: 'Capped', headline: '≤ 5,000 records a day',
      detail: 'Even with the real device, the vault releases at most the person’s daily budget, new-to-them records are limited, and touching a bait record freezes the account at once. Every copy that leaves is marked to the person.',
      evidence: 'ATT&CK T1213: 5,000 per 24 h with the decision engine bypassed; leak tracing: 20 records identify the source.',
      steps: { signin: S('pass', 'Real device'), engine: S('pass', 'Looks like normal work'), vault: S('cap', 'Daily budget 5,000'), trace: S('watch', 'Each copy marked; bait armed') },
    },
    ransom: {
      verdict: 'Held', headline: '0 of 12 deletions ran',
      detail: 'Mass deletions wait 24 hours. The sixth irreversible request in an hour froze the account and cancelled everything it had queued.',
      evidence: 'ATT&CK T1485: 0 of 12 executed.',
      steps: { signin: S('pass', 'Real device'), engine: S('pass', 'Allowed to request'), gates: S('hold', 'Queued, then frozen'), trace: S('watch', 'Burst alert') },
    },
    money: {
      verdict: 'Held', headline: 'Held 4 hours',
      detail: 'Same undo window: nothing irreversible happens the moment it is asked for.',
      evidence: 'ATT&CK T1657.',
      steps: { signin: S('pass', 'Real device'), engine: S('pass', 'Within rules'), gates: S('hold', 'Undo window 4 h'), trace: S('watch', 'Alerted') },
    },
    agent: {
      verdict: 'Contained', headline: 'Out-of-task actions refused',
      detail: 'A hijacked agent can only do what the person approved: named actions, named recipients, record caps. Three out-of-task attempts end the session.',
      evidence: 'AgentDojo worst case: 1.6% of 609 hijack attempts succeed (0% with input tracking).',
      steps: { signin: S('pass', 'Session approved earlier'), engine: S('stop', 'Not in the approved task'), vault: S('cap', 'Session record cap'), trace: S('watch', 'Person alerted') },
    },
    script: {
      verdict: 'Blocked', headline: 'Skimmer never served',
      detail: 'The gate checks the file itself, wherever the change came from.',
      evidence: 'ATT&CK T1195.002.',
      steps: { signin: S('pass', 'Real device'), engine: S('stop', 'Integrity block'), gates: S('stop', 'Gate refuses'), trace: S('watch', 'Alert') },
    },
  },
  engine: {
    data: {
      verdict: 'Capped', headline: '≤ 5,000 records a day',
      detail: 'The vault does not trust the decision engine: budgets, bait and device checks are enforced where the keys are. A fully hacked engine gains nothing above the ceiling.',
      evidence: 'Damage-ceiling attack tests: an adaptive attacker signing its own permissions never beat the computed ceiling.',
      steps: { signin: S('pass', 'Attacker has a device'), engine: S('pass', 'Hacked: signs anything'), vault: S('cap', 'Budget enforced in the vault'), trace: S('watch', 'Marks and bait still apply') },
    },
    ransom: {
      verdict: 'Held', headline: 'Nothing irreversible ran',
      detail: 'Gates sit next to storage, Git, the CDN and backups, and keep their own rules, locks and journals.',
      evidence: 'ATT&CK T1485, T1486, T1490 with the engine bypassed.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Hacked'), gates: S('hold', 'Locks and budgets at the gate'), trace: S('watch', 'Alert') },
    },
    money: {
      verdict: 'Held', headline: 'Held 4 hours',
      detail: 'The undo gate trusts nobody’s word that a payment is urgent; only two approvers can release one early.',
      evidence: 'Undo windows: Rust and reference implementations agree on 1,500 random operations.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Hacked'), gates: S('hold', 'Undo window 4 h'), trace: S('watch', 'Alerted') },
    },
    agent: {
      verdict: 'Capped', headline: 'Session record cap holds',
      detail: 'The number of records an agent session may receive is written into its permission and enforced again by the vault.',
      evidence: 'Agent tests: the vault refuses records beyond the approved session cap.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Hacked'), vault: S('cap', 'Session cap enforced'), trace: S('watch', 'Alert') },
    },
    script: {
      verdict: 'Blocked', headline: 'Skimmer never served',
      detail: 'The CDN gate re-runs the script check itself.',
      evidence: 'ATT&CK T1195.002 with the engine bypassed: refused.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Hacked'), gates: S('stop', 'Gate refuses'), trace: S('watch', 'Alert') },
    },
  },
  insiders: {
    data: {
      verdict: 'Capped', headline: '≤ 30,000 records a day',
      detail: 'Approvers can approve extra records, but only up to a fixed overrun cap. The worst combination of any three accounts is computed in advance and proven by attack tests.',
      evidence: 'Damage ceiling, 3 accounts with their devices: 30,000 customer records per 24 h.',
      steps: { signin: S('pass', 'Three real devices'), engine: S('pass', 'Approvals signed'), vault: S('cap', 'Overrun cap'), trace: S('watch', 'Each copy marked') },
    },
    ransom: {
      verdict: 'Held', headline: '72-hour lock, anyone can cancel',
      detail: 'Two compromised approvers can approve a backup deletion, but it still waits 72 hours and any other approver or security can cancel it.',
      evidence: 'Change gates: quorum plus time lock.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Approved by 2'), gates: S('hold', '72 h lock'), trace: S('watch', 'Alert to everyone') },
    },
    money: {
      verdict: 'Contained', headline: 'Can be released early',
      detail: 'Honest limit: two compromised approvers can release a held payment early. Separating payment approvers from data approvers closes this.',
      evidence: 'Undo windows: early release needs 2 approvers who are not the requester.',
      steps: { signin: S('pass', ''), engine: S('pass', ''), gates: S('pass', 'Released by 2 approvers'), trace: S('watch', 'Logged and alerted') },
    },
    agent: {
      verdict: 'Contained', headline: 'Limited to approved tasks',
      detail: 'Agents never get more rights than the person who approves them, and approvals must name exact recipients.',
      evidence: 'AgentDojo: loose approvals raised attack success to 13.6%, so they are refused.',
      steps: { signin: S('pass', ''), engine: S('stop', 'Exact task only'), vault: S('cap', 'Session cap'), trace: S('watch', 'Alert') },
    },
    script: {
      verdict: 'Blocked', headline: 'Skimmer never served',
      detail: 'A “block” from the script check cannot be approved by anyone.',
      evidence: 'Script firewall: blocks cannot be overridden.',
      steps: { signin: S('pass', ''), engine: S('pass', 'Approved'), gates: S('stop', 'Block cannot be approved'), trace: S('watch', 'Alert') },
    },
  },
};
