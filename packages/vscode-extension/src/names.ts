/**
 * Display names for Shield's layers and rules, copied verbatim from Shield's request panel
 * (deploy/dashboard-spa/app/components/shield-ui/requestDetail.ts) so the editor and Shield read the same.
 * A test in the Shield repository fails if the two drift apart.
 */
export const LAYER_NAMES: Record<string, string> = {
  'injection-scan': 'Injection scan',
  policy: 'Policy',
  'data-flow': 'Data flow (DIFC)',
  'secret-scan': 'Secret scan',
  'protocol-x': 'Protocol X',
  'ai-review': 'AI review',
  'causal-gate': 'Causal gate',
  'answer-check': 'Answer check',
  sandbox: 'Sandbox',
  behaviour: 'Agent behaviour',
  'attack-chain': 'Attack chain',
  session: 'Session',
  hooks: 'Tool-call hook',
  spend: 'Spend limit',
  'size-limit': 'Size limit',
  lifecycle: 'Tool integrity',
};

export const RULE_NAMES: Record<string, string> = {
  'semantic-path-guard': 'Sensitive file paths',
  'semantic-url-guard': 'Blocked web addresses',
  'semantic-sql-guard': 'Database injection',
  'semantic-dns-exfil': 'Data sent to a suspicious host',
  'semantic-shell-guard': 'Dangerous shell commands',
  'semantic-github-guard': 'GitHub repository limits',
  'semantic-powershell-guard': 'PowerShell commands',
  'semantic-ssti-guard': 'Template injection',
  'semantic-privilege-escalation': 'Privilege escalation',
  'semantic-log-injection': 'Log tampering',
  'semantic-prompt-injection': 'Prompt injection',
  'request-prompt-injection': 'Prompt injection',
  'semantic-rate-limit-evasion': 'Rate-limit evasion',
  'semantic-token-budget-abuse': 'Token budget abuse',
  'difc-exfiltration-prevented': 'Secret leaving through another tool',
  'protocol-x-result': "Attack in a tool's answer",
  'response-gate': "Answer failed Shield's checks",
  'secret-scan': 'Secrets in the arguments',
  'arg-entropy': 'Encoded data in the arguments',
  'tool-fingerprint-mismatch': 'Tool definitions changed',
  'payload-expanded-limit': 'Request too large',
  'unified-spend-pool': 'Spend cap reached',
};
