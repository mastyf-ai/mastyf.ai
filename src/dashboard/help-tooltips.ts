/**
 * Centralized Help Tooltip Registry
 *
 * Provides structured, educational explanations for all dashboard features
 * when the user hovers over the '?' icon beside any element.
 */

export interface HelpTooltipItem {
  id: string;
  title: string;
  short: string;
  detailed: string;
  learnMorePath?: string;
  category: 'protection' | 'activity' | 'policy' | 'servers' | 'threat-lab' | 'cost' | 'security' | 'general';
}

export const HELP_TOOLTIPS: Record<string, HelpTooltipItem> = {
  // ── Protection Workspace ──
  'protection.block-rate': {
    id: 'protection.block-rate',
    title: 'Block Rate',
    short: 'Percentage of AI tool calls stopped before execution by mastyf.ai.',
    detailed:
      'The block rate indicates how many autonomous tool requests violated your active security policies. ' +
      'A normal operational rate is 1-5%. If this exceeds 30%, review your policy rules to avoid over-blocking benign tasks, ' +
      'or inspect the Live Threat Feed for active automated probing.',
    learnMorePath: '/docs/protection#block-rate',
    category: 'protection',
  },
  'protection.threat-feed': {
    id: 'protection.threat-feed',
    title: 'Live Threat Feed',
    short: 'Real-time telemetry stream of blocked and flagged security events.',
    detailed:
      'Displays intercepted actions in real time, identifying the targeted MCP server, the specific tool called, ' +
      'the triggered security policy rule, and the raw payload parameters that triggered the defense monitor.',
    learnMorePath: '/docs/protection#threat-feed',
    category: 'protection',
  },
  'protection.top-rules': {
    id: 'protection.top-rules',
    title: 'Top Triggered Rules',
    short: 'Ranking of policy rules causing the highest frequency of blocks.',
    detailed:
      'Shows which specific security constraints (e.g. path traversal, SQL exfiltration, shell injection) ' +
      'are most frequently matched. Use this ranking to identify primary attack vectors against your environment.',
    learnMorePath: '/docs/policy#top-rules',
    category: 'protection',
  },

  // ── Servers Workspace (Per-Server Observability) ──
  'servers.fleet-overview': {
    id: 'servers.fleet-overview',
    title: 'MCP Server Fleet',
    short: 'Individual safety and observability breakdown for all active MCP daemons.',
    detailed:
      'Each card represents an isolated MCP daemon (e.g., filesystem, github, postgres) connected to your AI agents. ' +
      'Instead of conglomerating all traffic, mastyf.ai scores each server independently so you immediately know ' +
      'which server is safe (green), degraded (yellow), or experiencing active exploits (red).',
    learnMorePath: '/docs/servers#overview',
    category: 'servers',
  },
  'servers.threat-score': {
    id: 'servers.threat-score',
    title: 'Server Threat Score',
    short: 'A composite 0-100 score measuring this specific server\'s security posture.',
    detailed:
      'Calculated continuously from: block frequency (40%), critical exploit severity (30%), ' +
      'risk level of exposed tools (20%), and threat recency in the past hour (10%). ' +
      'Scores below 50 indicate dangerous tools or active attack patterns.',
    learnMorePath: '/docs/servers#threat-score',
    category: 'servers',
  },
  'servers.tool-risk-tier': {
    id: 'servers.tool-risk-tier',
    title: 'Tool Risk Classification',
    short: 'Categorization of tools into Safe, Low, Medium, High, and Critical risk tiers.',
    detailed:
      'Tools with read-only side effects (e.g. search, list, get) are classified as Safe/Low. ' +
      'Tools capable of mutating data, modifying code repositories, or executing system commands are classified ' +
      'as High or Critical and are subjected to strict perimeter inspection.',
    learnMorePath: '/docs/servers#tool-risk',
    category: 'servers',
  },

  // ── Policy Workspace ──
  'policy.enforcement-mode': {
    id: 'policy.enforcement-mode',
    title: 'Enforcement Mode',
    short: 'Controls how security violations are handled across your infrastructure.',
    detailed:
      '• AUDIT: Logs all actions without blocking anything (recommended for Week 1 exploration).\n' +
      '• WARN: Flags suspicious actions and notifies admins, but still forwards to tools.\n' +
      '• BLOCK: Active fail-closed perimeter defense — halts unauthorized calls before execution.',
    learnMorePath: '/docs/policy#modes',
    category: 'policy',
  },
  'policy.hot-reload': {
    id: 'policy.hot-reload',
    title: 'Hot-Reload Policy Engine',
    short: 'Instant policy updates from default-policy.yaml without restarting servers.',
    detailed:
      'Edit your YAML policy rules either in the UI editor or via source control. ' +
      'mastyf.ai automatically detects changes, verifies regex safety against ReDoS vulnerabilities, ' +
      'and applies the new rules atomically with zero downtime.',
    learnMorePath: '/docs/policy#hot-reload',
    category: 'policy',
  },

  // ── Threat Lab Workspace ──
  'threat-lab.ai-discoveries': {
    id: 'threat-lab.ai-discoveries',
    title: 'Threat Lab AI Discoveries',
    short: 'Autonomous attack hypotheses generated by LLMs analyzing live traffic.',
    detailed:
      'Threat Lab continuously monitors borderline traffic and proposes novel test cases ' +
      'for zero-day evasions. Nothing is enforced automatically — administrators review and approve ' +
      'suggestions in the dashboard before they are converted into active policy rules.',
    learnMorePath: '/docs/threat-lab#discoveries',
    category: 'threat-lab',
  },

  // ── Cost & Budget Workspace ──
  'cost.token-budgets': {
    id: 'cost.token-budgets',
    title: 'Token & Dollar Budgets',
    short: 'Hard caps preventing runaway autonomous agent execution loops.',
    detailed:
      'Set strict token limits per call, per hour, or per tenant. ' +
      'Prevents autonomous agents from entering infinite looping states that burn API credits.',
    learnMorePath: '/docs/cost#budgets',
    category: 'cost',
  },

  // ── Security & Eval Playground ──
  'security.eval-playground': {
    id: 'security.eval-playground',
    title: 'Security Eval Playground',
    short: 'Adversarial benchmark testing suite with 34+ exploit vectors.',
    detailed:
      'Executes verified attack payloads against your live policy engine to measure detection accuracy ' +
      'and false-positive rates before deploying changes into production environments.',
    learnMorePath: '/docs/security#eval',
    category: 'security',
  },
};

/**
 * Returns the tooltip item for a given ID, or a fallback item if not found.
 */
export function getHelpTooltip(id: string): HelpTooltipItem {
  return (
    HELP_TOOLTIPS[id] || {
      id,
      title: id.replace(/[-_.]/g, ' ').toUpperCase(),
      short: 'Hover over features to view comprehensive security and operational guidance.',
      detailed: 'Detailed documentation is available in the mastyf.ai Help & Documentation center.',
      category: 'general',
    }
  );
}
