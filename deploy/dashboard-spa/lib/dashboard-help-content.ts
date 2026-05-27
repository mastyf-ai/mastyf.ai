export type HelpTopic = {
  id: string;
  title: string;
  category: string;
  what: string;
  trigger: string[];
  dataSources: string[];
  outputs: string[];
  apis: string[];
  rbac?: string;
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'analysis-pipeline',
    title: 'Security analysis pipeline',
    category: 'Activity',
    what: 'End-to-end security swarm: preflight, build, live MCP probes, your servers, traffic summary, calibration, swarm gates, visuals, plain-English report, and technical appendix.',
    trigger: [
      'Activity → Analysis → Run analysis (or Run full nightly)',
      'CLI: pnpm security-swarm:analyze',
    ],
    dataSources: ['history.db', 'tenant swarm artifacts', 'WebSocket swarm:progress'],
    outputs: ['report.json', 'analysis.txt', 'visuals-data.json', 'traffic-summary.json', 'job.log'],
    apis: ['POST /api/security-swarm/run', 'GET /api/security-swarm/status', 'GET /api/security-swarm/job-log'],
    rbac: 'policy_test to run',
  },
  {
    id: 'threat-lab',
    title: 'Threat Lab',
    category: 'Threats',
    what: 'LLM proposes adversarial fixtures and policy rules from real bypasses and semantic TPs. Human accept applies rule to live policy; reject discards.',
    trigger: ['Threats → Threat Lab → Run Threat Lab', 'Env: SWARM_THREAT_LAB=true, GUARDIAN_LLM_ENABLED'],
    dataSources: ['bypasses.json', 'semantic audit store', 'ThreatIntel poll — no synthetic fallback'],
    outputs: ['threat-lab-candidates.json'],
    apis: [
      'POST /api/threat-discovery/threat-lab/run',
      'GET /api/security-swarm/threat-lab-candidates',
      'POST .../accept',
      'POST .../reject',
    ],
    rbac: 'policy_mutate to accept',
  },
  {
    id: 'auto-research',
    title: 'Auto Threat Research',
    category: 'Threats',
    what: 'Automated corpus fixture writes when confidence ≥ GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE (default 0.85). Policy is never auto-applied.',
    trigger: ['Threats → Auto Research → Run', 'Env: GUARDIAN_THREAT_RESEARCH_AUTO=true'],
    dataSources: ['Same authentic inputs as Threat Lab'],
    outputs: ['auto-corpus-manifest.json', 'adv-*.json fixtures'],
    apis: ['POST /api/threat-discovery/auto-research/run', 'GET /api/security-swarm/auto-corpus'],
  },
  {
    id: 'investigate',
    title: 'Incident investigation',
    category: 'Security',
    what: 'LLM kill-chain narrative and agent intent graph for a semantic audit or threat trigger.',
    trigger: ['Investigate on AI copilot row or Threat Lab candidate', 'POST with triggerId'],
    dataSources: ['history.db', 'semantic-audit-store'],
    outputs: ['Investigation JSON in drawer'],
    apis: ['POST /api/incidents/investigate'],
  },
  {
    id: 'infra-charts',
    title: 'Live infrastructure charts',
    category: 'Operations',
    what: 'Traffic, AI learning, semantic buckets, and session regression charts from live proxy data.',
    trigger: ['Operations → Overview (or embedded in analysis results)'],
    dataSources: ['GET /api/visuals/live → history.db + session swarm'],
    outputs: ['Chart bundle only — no bundled demo JSON'],
    apis: ['GET /api/visuals/live'],
  },
  {
    id: 'health-report',
    title: 'MCP health report',
    category: 'Home',
    what: 'Downloadable Markdown briefing per MCP server: latency, blocks, tools, recommendations.',
    trigger: ['Home → Download health report', 'Optional Ollama narrative'],
    dataSources: ['history.db', 'policy snapshot', 'swarm artifacts'],
    outputs: ['guardian-mcp-health-YYYY-MM-DD.md'],
    apis: ['GET /api/reports/mcp-health', 'GET /api/reports/mcp-health/download'],
  },
  {
    id: 'policy-copilot',
    title: 'Policy copilot',
    category: 'Security',
    what: 'Generate YAML rules or run counterfactual replay against recent blocks.',
    trigger: ['Security → Policy → Copilot tab'],
    dataSources: ['Live policy file', 'recent audit'],
    outputs: ['Suggested rules', 'replay summary'],
    apis: ['POST /api/policy/copilot'],
    rbac: 'policy_mutate to apply',
  },
  {
    id: 'live-analytics',
    title: 'MCP Guardian Analytics',
    category: 'Operations',
    what: 'Live traffic, cost, model usage, and provider spend in one dashboard with WebSocket refresh.',
    trigger: ['Operations → Analytics', 'Time window: 1h / 24h / 7d / 30d'],
    dataSources: ['history.db call_records', 'GET /api/analytics/summary'],
    outputs: ['KPIs', 'traffic series', 'cost breakdown', 'model donut', 'provider list'],
    apis: ['GET /api/analytics/summary'],
  },
  {
    id: 'security-dashboard',
    title: 'Always-on threat protection',
    category: 'Security',
    what: 'Security score, layer status, threat monitor table (per-row and bulk quarantine), semantic engine status, and RBAC view. Monitor quarantine applies or confirms hardening policy and archives records under Security → Quarantined.',
    trigger: ['Security → Dashboard'],
    dataSources: ['history.db blocks', 'semantic-audit-store', 'manifest scans'],
    outputs: ['Threat CSV export', 'quarantine enforcement status', 'optional rule removal on restore'],
    apis: ['GET /api/security/dashboard', 'POST /api/security/threats/quarantine', 'POST /api/security/threats/restore'],
  },
  {
    id: 'threat-intel-quarantine',
    title: 'Threat intel quarantine and remove',
    category: 'Security',
    what: 'AI Copilot threat-intel actions: Quarantine auto-applies blocking policy and archives details; Remove dismisses from active catalog. Policy column opens triggered block context and applied YAML rule.',
    trigger: ['Security → AI copilot', 'Security → Quarantined'],
    dataSources: ['~/.mcp-guardian/.threat-state.json', '~/.mcp-guardian/threat-intel-actions.jsonl'],
    outputs: ['Policy rule applied', 'quarantine archive (30 days)', 'restore to catalog'],
    apis: [
      'GET /api/ai/threats',
      'POST /api/ai/threats/quarantine',
      'POST /api/ai/threats/dismiss',
      'POST /api/ai/threats/restore',
      'GET /api/ai/threats/quarantined',
      'GET /api/ai/threats/quarantine/policy',
      'GET /api/security/threats/quarantine/policy',
    ],
  },
  {
    id: 'swarm-tribunal',
    title: 'Swarm debate tribunal',
    category: 'Enterprise AI',
    what: 'Automatic multi-agent debate (block vs allow vs auditor) for uncertain semantic audit flags. Processes up to 10 per run; Run next batch debates the next unlabeled uncertain items after prior labels.',
    trigger: [
      'Enterprise AI tab load or Refresh',
      'Run tribunal / Run next batch button',
      'GET /api/learning/semantic/tribunal?limit=10',
    ],
    dataSources: [
      'semantic-audit-outcomes store',
      'uncertainty-ranked queue (confidence near GUARDIAN_SEMANTIC_MIN_CONFIDENCE)',
    ],
    outputs: [
      'debate verdicts',
      'eligibleTotal and remainingEligible counts',
      'optional auto-label when GUARDIAN_TRIBUNAL_AUTO_LABEL=true',
    ],
    apis: ['GET /api/learning/semantic/tribunal'],
    rbac: 'ai feature tier',
  },
  {
    id: 'guided-setup',
    title: 'Guided setup & cloud control plane',
    category: 'Settings',
    what: 'Checklist for Guardian config, database health, proxy traffic, and optional cloud control plane link.',
    trigger: ['Settings → Setup → Connect to Cloud'],
    dataSources: ['~/.mcp-guardian/setup.json', 'onboarding status', 'DATABASE_URL / history.db'],
    outputs: ['Saved proxy settings', 'cloud launch URL'],
    apis: [
      'GET /api/setup/status',
      'POST /api/setup/guardian-config',
      'GET /api/setup/cloud-status',
      'POST /api/setup/cloud/connect',
    ],
  },
];

export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}
