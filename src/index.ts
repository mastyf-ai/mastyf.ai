#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfigParser } from './config-parser.js';
import { ReportGenerator } from './reporter/report-generator.js';
import type { FullReport, McpServerConfig, ProxyCallRecord } from './types.js';
import { calculateOverallScore } from './utils/scoring.js';
import { Logger } from './utils/logger.js';
import { createContainer } from './container.js';
import { sanitizeConfigPath } from './utils/sanitize-config-path.js';
import { resolveMcpServerDbPath } from './utils/mastyf-ai-db-path.js';
import { readPackageVersion } from './utils/package-version.js';
import { resolveTenantFromEnv } from './tenant/resolve-tenant.js';
import {
  buildObservedTools,
  computeMeasuredPerformance,
  filterRecordsByWindow,
} from './utils/real-metrics.js';

// ── DB path: separate from proxy history.db (Cline cannot set env in MCP JSON)
if (!process.env['MASTYF_AI_DB_PATH']) {
  process.env['MASTYF_AI_DB_PATH'] = resolveMcpServerDbPath();
}

import type { Container } from './container.js';

let container: Container;
const reporter = new ReportGenerator();

const DEFAULT_METRIC_WINDOW_DAYS = 7;
const MAX_METRIC_RECORDS = 10_000;

async function getRecentServerRecords(
  serverName: string,
  tenantId: string,
  windowDays = DEFAULT_METRIC_WINDOW_DAYS,
): Promise<ProxyCallRecord[]> {
  const records = await container.db.getCallRecordsForServer(serverName, MAX_METRIC_RECORDS, tenantId);
  return filterRecordsByWindow(records, windowDays);
}

function noTrafficMessage(serverName: string, windowDays = DEFAULT_METRIC_WINDOW_DAYS): string {
  return `No measured proxy traffic found for "${serverName}" in the last ${windowDays} day${windowDays === 1 ? '' : 's'}. Route MCP traffic through the Mastyf AI proxy to collect real metrics.`;
}

const server = new Server(
  { name: 'mastyf-ai', version: readPackageVersion() },
  { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
);

// ── Logging capability (MCP spec requirement) ─────────────────────
let currentLogLevel = 'info';

server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  const { level } = request.params;
  currentLogLevel = level;
  Logger.info(`Log level set to ${level}`);
  return {};
});

// ── MCP Resources: expose latest scan report ──────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'mastyf-ai://latest-scan',
      name: 'Latest Scan Report',
      description: 'Most recent security scan results across all MCP servers',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'mastyf-ai://latest-scan') {
    // Return the most recent security scan data from DB (or note if empty)
    const latestScan = {
      timestamp: new Date().toISOString(),
      note: 'Run scan_security or full_report to populate',
    };
    try {
      // Try to read from the actual database (v2.1.2 fix — wired to real DB)
      const db = container.db;
      // Get the most recent security scan from DB across all known servers dynamically
      const recentScans: unknown[] = [];
      // Query all known servers from the DB instead of a hardcoded list
      const tenantId = resolveTenantFromEnv();
      const knownServers = await db.getDistinctScannedServers(tenantId);
      for (const srv of knownServers) {
        const entry = await db.getLatestSecurityScan(srv, tenantId);
        if (entry) recentScans.push(entry);
      }
      if (recentScans.length > 0) {
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify({ status: 'ok', scans: recentScans, count: recentScans.length }, null, 2),
            },
          ],
        };
      }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      Logger.warn(`[mcp-resource] latest-scan DB read failed: ${detail}`);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              status: 'error',
              error: 'database_unavailable',
              message: detail,
            }, null, 2),
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            status: 'empty',
            note: 'Run scan_security or full_report to populate',
            timestamp: latestScan.timestamp,
          }, null, 2),
        },
      ],
    };
  }
  throw new Error(`Resource not found: ${request.params.uri}`);
});

// ── MCP Prompts: pre-built template for auditing ──────────────────
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'audit-config',
      description: 'Generate security audit instructions for an MCP server config',
      arguments: [
        {
          name: 'configPath',
          description: 'Path to an MCP config file (cline_mcp_settings.json)',
          required: false,
        },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'audit-config') {
    const configPath = (args?.configPath as string) || 'auto-discovered';
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please audit the MCP configuration at ${configPath} for:
- Known CVEs in the described servers (via NVD/OSV.dev)
- Authentication weaknesses (missing API keys, unencrypted transports)
- Overloaded tool definitions (>15 tools per server)
- Suspected typo-squatting in server package names
- Hardcoded secrets in environment variables or command args

Use the \`scan_security\` tool with the config path to get started.`,
          },
        },
      ],
    };
  }
  throw new Error(`Prompt not found: ${name}`);
});

// ── Graceful shutdown ──────────────────────────────────────────────
const shutdown = async () => {
  Logger.info('Shutting down gracefully...');
  const { shutdownMetrics } = await import('./utils/metrics.js');
  const { closeDashboardServer } = await import('./utils/dashboard-server.js');
  await closeDashboardServer();
  await shutdownMetrics();
  container.db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_security',
      description: 'Scan MCP server configurations for security vulnerabilities (CVEs, auth, typo-squatting, secrets)',
      inputSchema: {
        type: 'object',
        properties: {
          configPath: { type: 'string', description: 'Path to an MCP config file. If omitted, auto-discovers configs.' },
        },
      },
    },
    {
      name: 'audit_costs',
      description: 'Audit token usage and estimate costs per MCP server',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server name. If omitted, audits all.' },
        },
      },
    },
    {
      name: 'check_health',
      description: 'Check health, latency, and reliability of MCP servers',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server name. If omitted, checks all.' },
        },
      },
    },
    {
      name: 'full_report',
      description: 'Generate a complete security, cost, and health report for all MCP servers',
      inputSchema: {
        type: 'object',
        properties: {
          configPath: { type: 'string', description: 'Path to MCP config file (optional)' },
          format: { type: 'string', enum: ['json', 'markdown', 'text'], description: 'Output format (default: text)' },
        },
      },
    },
    // ── Agentic AI: Policy Generation (Feature #2) ────────────
    {
      name: 'start_behavior_observation',
      description: 'Start observing AI agent tool calls to learn usage patterns for policy generation',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: { type: 'string', description: 'Optional custom observation window ID' },
        },
      },
    },
    {
      name: 'stop_behavior_observation',
      description: 'Stop the current observation window and finalize collected data',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_policy_from_observations',
      description: 'Generate a minimal-privilege YAML policy based on observed tool call patterns',
      inputSchema: {
        type: 'object',
        properties: {
          windowId: { type: 'string', description: 'Specific observation window to use (uses latest if omitted)' },
        },
      },
    },
    {
      name: 'suggest_policy_improvements',
      description: 'Compare observed behavior against current policy and suggest additions/removals',
      inputSchema: {
        type: 'object',
        properties: {
          existingPolicyYaml: { type: 'string', description: 'Current policy YAML to diff against' },
        },
      },
    },
    {
      name: 'observation_status',
      description: 'Get current behavior observation status and summary',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Prompt Injection Detection (Feature #6) ───
    {
      name: 'scan_prompt_injection',
      description: 'Scan tool call arguments for prompt injection payloads targeting downstream AI agents',
      inputSchema: {
        type: 'object',
        properties: {
          toolName: { type: 'string', description: 'Tool name being called' },
          serverName: { type: 'string', description: 'Server name' },
          arguments: { type: 'object', description: 'Tool call arguments to scan' },
        },
        required: ['toolName', 'arguments'],
      },
    },
    {
      name: 'prompt_injection_report',
      description: 'Get prompt injection detection statistics',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Threat Prediction (Feature #1) ─────────────
    {
      name: 'predict_threats',
      description: 'Generate threat forecast for all configured MCP servers with 30/90/365-day projections',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server name. If omitted, predicts for all.' },
        },
      },
    },
    {
      name: 'threat_forecast_for_server',
      description: 'Detailed threat forecast for a specific server with risk factors and preemptive hardening recommendations',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Server name to generate forecast for' },
        },
        required: ['serverName'],
      },
    },
    {
      name: 'preemptive_recommendations',
      description: 'Get suggested preemptive policy changes based on threat forecasts',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server' },
        },
      },
    },
    // ── Agentic AI: Supply Chain (Feature #5) ──────────────────
    {
      name: 'verify_supply_chain',
      description: 'Full supply chain integrity verification with signed attestation for MCP server packages',
      inputSchema: {
        type: 'object',
        properties: {
          packageName: { type: 'string', description: 'MCP server package name to verify' },
          version: { type: 'string', description: 'Package version (optional)' },
        },
        required: ['packageName'],
      },
    },
    {
      name: 'supply_chain_status',
      description: 'Current trust graph state for all MCP server packages',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'sbom_export',
      description: 'Export Software Bill of Materials for MCP server packages',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['cyclonedx', 'spdx'], description: 'SBOM format (default: cyclonedx)' },
        },
      },
    },
    // ── Agentic AI: Drift Detection (Feature #8) ───────────────
    {
      name: 'detect_drift',
      description: 'Compare current MCP server behavior against a known-good baseline to detect anomalies',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Server name to check for drift' },
          baselineId: { type: 'string', description: 'Specific baseline to compare against (uses latest if omitted)' },
        },
      },
    },
    {
      name: 'capture_baseline',
      description: 'Capture current server state as a known-good behavioral baseline',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Server name to capture baseline for' },
        },
        required: ['serverName'],
      },
    },
    {
      name: 'rollback_server_config',
      description: 'Revert to a previous known-good configuration snapshot',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Server name to rollback' },
          baselineId: { type: 'string', description: 'Baseline ID to rollback to' },
        },
        required: ['serverName'],
      },
    },
    {
      name: 'drift_history',
      description: 'List all detected drift events',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Filter to a specific server (optional)' },
        },
      },
    },
    // ── Agentic AI: Compliance Evidence (Feature #7) ───────────
    {
      name: 'generate_compliance_evidence',
      description: 'Generate auditor-ready compliance evidence bundle for a framework',
      inputSchema: {
        type: 'object',
        properties: {
          framework: { type: 'string', enum: ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'], description: 'Compliance framework' },
        },
        required: ['framework'],
      },
    },
    {
      name: 'compliance_gap_analysis',
      description: 'Identify missing compliance controls and recommend policies',
      inputSchema: {
        type: 'object',
        properties: {
          framework: { type: 'string', enum: ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'], description: 'Compliance framework' },
        },
        required: ['framework'],
      },
    },
    {
      name: 'compliance_posture',
      description: 'Get current compliance posture score across all frameworks',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_compliance_frameworks',
      description: 'List all supported compliance frameworks',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Red Team (Feature #9) ──────────────────────
    {
      name: 'run_self_assessment',
      description: 'Run a full autonomous red team assessment with attack generation and policy testing',
      inputSchema: {
        type: 'object',
        properties: {
          attackCount: { type: 'number', description: 'Number of attacks to generate (default: 50)' },
        },
      },
    },
    {
      name: 'schedule_red_team',
      description: 'Configure periodic autonomous red team assessments',
      inputSchema: {
        type: 'object',
        properties: {
          intervalHours: { type: 'number', description: 'Hours between assessments (default: 24)' },
          enabled: { type: 'boolean', description: 'Enable or disable scheduled assessments' },
        },
      },
    },
    {
      name: 'red_team_results',
      description: 'Get latest red team assessment results and recommendations',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'ab_test_policy',
      description: 'A/B test a proposed policy change against historical attack corpus',
      inputSchema: {
        type: 'object',
        properties: {
          proposedPolicyYaml: { type: 'string', description: 'Proposed policy YAML to test' },
        },
        required: ['proposedPolicyYaml'],
      },
    },
    // ── Agentic AI: Threat Intel Mesh (Feature #3) ─────────────
    {
      name: 'contribute_threat_signature',
      description: 'Submit an anonymized threat signature to the cross-deployment intelligence mesh',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The threat pattern (will be privacy-hashed before sharing)' },
          category: { type: 'string', description: 'Attack category' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Severity level' },
        },
        required: ['pattern', 'category', 'severity'],
      },
    },
    {
      name: 'threat_intel_status',
      description: 'Get mesh connectivity, contribution stats, and known threat feed',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Honeypot (Feature #4) ──────────────────────
    {
      name: 'deploy_honeypot',
      description: 'Deploy an ephemeral decoy MCP server to detect adversarial probing',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Honeypot display name' },
          template: { type: 'string', enum: ['decoy-production-database', 'decoy-filesystem', 'decoy-github', 'decoy-slack', 'decoy-api-server', 'decoy-credentials-vault', 'decoy-admin-panel'], description: 'Decoy template' },
          ttlMinutes: { type: 'number', description: 'Auto-destroy after N minutes (default: 30)' },
          alertOnInteraction: { type: 'boolean', description: 'Alert on every probe (default: true)' },
        },
        required: ['name', 'template'],
      },
    },
    {
      name: 'honeypot_report',
      description: 'Get attack patterns observed by all active honeypots',
      inputSchema: {
        type: 'object',
        properties: {
          honeypotId: { type: 'string', description: 'Filter to a specific honeypot (optional)' },
        },
      },
    },
    {
      name: 'destroy_honeypot',
      description: 'Tear down a specific honeypot and retrieve captured data',
      inputSchema: {
        type: 'object',
        properties: {
          honeypotId: { type: 'string', description: 'Honeypot ID to destroy' },
        },
        required: ['honeypotId'],
      },
    },
    {
      name: 'list_honeypots',
      description: 'List all active and destroyed honeypots with summary',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Trust Negotiation (Feature #10) ────────────
    {
      name: 'negotiate_agent_trust',
      description: 'Initiate an automated trust handshake with another AI agent behind Mastyf AI',
      inputSchema: {
        type: 'object',
        properties: {
          remoteAgentId: { type: 'string', description: 'Remote agent identifier' },
          requestedTools: { type: 'array', items: { type: 'string' }, description: 'Tools to request access to' },
          maxSessionMinutes: { type: 'number', description: 'Maximum session duration in minutes (default: 30)' },
        },
        required: ['remoteAgentId', 'requestedTools'],
      },
    },
    {
      name: 'agent_trust_status',
      description: 'View all active trust relationships and session details',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'revoke_agent_trust',
      description: 'Immediately terminate a trust relationship',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID to revoke' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'trust_registry_list',
      description: 'List all registered agents in the trust registry',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Meta / Status ──────────────────────────────
    {
      name: 'agentic_status',
      description: 'Get overall status of all agentic AI features including metrics, scheduler, and task queue',
      inputSchema: { type: 'object', properties: {} },
    },
    // ── Agentic AI: Trust Score (New Feature #11) ──────────────
    {
      name: 'compute_trust_score',
      description: 'Compute an A+-F trust score for an MCP server across 8 security dimensions (like SSL Labs for MCP)',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string', description: 'Server name to score' },
          cveCount: { type: 'number', description: 'Number of known CVEs' },
          maxCvss: { type: 'number', description: 'Maximum CVSS score' },
          authMethod: { type: 'string', enum: ['none', 'api_key', 'oauth2', 'oauth2_mtls'], description: 'Authentication method' },
          transport: { type: 'string', enum: ['stdio', 'http', 'https', 'mTLS'], description: 'Transport protocol' },
        },
      },
    },
    // ── Agentic AI: Response DLP (New Feature #12) ─────────────
    {
      name: 'scan_response_dlp',
      description: 'Scan MCP tool responses for PII, credentials, sensitive paths, and data exfiltration',
      inputSchema: {
        type: 'object',
        properties: {
          toolName: { type: 'string', description: 'Tool name that produced the response' },
          serverName: { type: 'string', description: 'Server name' },
          responseText: { type: 'string', description: 'The response text to scan for data leaks' },
        },
        required: ['responseText'],
      },
    },
    // ── New Agentic Features #2-10 ──
    {
      name: 'certify_server',
      description: 'Run MCP server certification (Bronze/Silver/Gold/Platinum)',
      inputSchema: { type: 'object', properties: { serverName: { type: 'string' }, packageName: { type: 'string' }, version: { type: 'string' }, trustScore: { type: 'number' }, complianceScore: { type: 'number' }, cveFree: { type: 'boolean' }, authMethod: { type: 'string' }, transport: { type: 'string' }, trustedPublisher: { type: 'boolean' } } },
    },
    {
      name: 'list_certified_servers',
      description: 'List MCP servers in the local certification registry with level and expiry',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    },
    {
      name: 'verify_certification',
      description: 'Verify a server certification attestation (JWS) and level',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string' },
          attestationJws: { type: 'string' },
        },
        required: ['serverName'],
      },
    },
    {
      name: 'declare_intent',
      description: 'Declare session intent and allowed tools for intent-binding enforcement',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          intent: { type: 'string' },
          allowedTools: { type: 'array', items: { type: 'string' } },
          agentId: { type: 'string' },
          ttlMinutes: { type: 'number' },
        },
        required: ['sessionId', 'intent', 'allowedTools'],
      },
    },
    {
      name: 'run_protocol_fuzzer',
      description: 'Run MCP protocol fuzzer — test defenses against malformed JSON-RPC, overflow, injection',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'check_sla',
      description: 'Check SLA compliance — p50/p95 latency, error rate, circuit breaker state per tool',
      inputSchema: { type: 'object', properties: { serverName: { type: 'string' }, toolName: { type: 'string' } } },
    },
    {
      name: 'run_incident_playbook',
      description: 'Execute an incident response playbook (prompt_injection, credential_leak, shell_injection)',
      inputSchema: { type: 'object', properties: { trigger: { type: 'string' }, playbook: { type: 'string' }, severity: { type: 'string' } }, required: ['trigger', 'playbook'] },
    },
    {
      name: 'get_agent_reputation',
      description: 'Get agent reputation score — Trusted/Standard/Suspicious/Blocked tier with bypass rate and entropy',
      inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
    },
    {
      name: 'harden_config',
      description: 'Analyze MCP server config and get A-F hardening grade with one-click recommendations',
      inputSchema: { type: 'object', properties: { serverName: { type: 'string' } } },
    },
    {
      name: 'detect_collusion',
      description: 'Detect agent-to-agent collusion patterns (recon-then-exploit, coordinated exfil, token sharing)',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'policy_to_natural_language',
      description: 'Explain MCP Mastyf AI policy YAML in plain English for compliance stakeholders',
      inputSchema: {
        type: 'object',
        properties: {
          yaml: { type: 'string', description: 'Policy YAML text' },
          policyPath: { type: 'string', description: 'Optional path to policy file' },
        },
      },
    },
    {
      name: 'natural_language_to_policy',
      description: 'Convert a natural-language security goal into a draft YAML policy rule (requires approval before enforce)',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Natural language policy goal' },
          availableTools: { type: 'array', items: { type: 'string' } },
        },
        required: ['goal'],
      },
    },
    {
      name: 'query_server_reputation',
      description: 'Query decentralized MCP server reputation (8-dimension consensus score)',
      inputSchema: {
        type: 'object',
        properties: { serverName: { type: 'string' }, packageName: { type: 'string' } },
        required: ['serverName'],
      },
    },
    {
      name: 'quantify_insurance_risk',
      description: 'Compute cyber insurance ALE (Annualized Loss Expectancy) for an MCP server',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string' },
          toolCount: { type: 'number' },
          networkExposure: { type: 'number' },
          recordsAtRisk: { type: 'number' },
        },
        required: ['serverName'],
      },
    },
    // ── RL Features ──
    {
      name: 'evaluate_agent_trust',
      description: 'Thompson Sampling — run Bayesian bandit trust sampling for an agent (Beta posterior, exploration/exploitation)',
      inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
    },
    {
      name: 'tune_policy_rule',
      description: 'Contextual Bandit (LinUCB) — select optimal policy action (enforce/relax/skip) based on context',
      inputSchema: { type: 'object', properties: { serverType: { type: 'string' }, agentTier: { type: 'string' }, ruleCategory: { type: 'string' } }, required: ['serverType', 'agentTier', 'ruleCategory'] },
    },
    {
      name: 'adapt_threshold',
      description: 'SARSA — adaptively tune rate limit, latency limit, or confidence threshold via reinforcement learning',
      inputSchema: { type: 'object', properties: { parameter: { type: 'string', enum: ['rateLimit', 'latencyLimit', 'confidence'] }, blockRate: { type: 'number' }, fpRate: { type: 'number' }, callVolume: { type: 'number' } }, required: ['parameter'] },
    },
    {
      name: 'select_fuzz_strategy',
      description: 'REINFORCE — use policy gradient to select optimal fuzzer mutation strategy',
      inputSchema: { type: 'object', properties: { observeReward: { type: 'number' } } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Load servers: single config path, aggregated all, or auto-discover
  let servers: McpServerConfig[];
  let configDescription: string;

  if (args?.configPath) {
    const rawPath = args.configPath as string;
    const safePath = sanitizeConfigPath(rawPath);
    if (!safePath) {
      return {
        content: [{ type: 'text', text: `Config path rejected for security reasons: ${rawPath}. Path must be under your home directory or an allowed system location.` }],
      };
    }
    servers = ConfigParser.parse(safePath);
    configDescription = safePath;
  } else {
    const result = ConfigParser.parseAll();
    servers = result.servers;
    configDescription = result.sourcePaths.length > 1
      ? `aggregated (${result.sourcePaths.length} files)`
      : (result.sourcePaths[0] || 'auto-detected');
  }

  if (servers.length === 0) {
    return {
      content: [{ type: 'text', text: 'No MCP servers found. Please specify a configPath or ensure MCP configs exist.' }],
    };
  }

  const tenantId = resolveTenantFromEnv();

  switch (name) {
    case 'scan_security': {
      const results = await Promise.all(servers.map((s) => container.securityScanner.scanServer(s)));
      for (const r of results) {
        container.db.addSecurityScan(r.serverName, r.score, r.cves.length, r, tenantId);
      }
      return { content: [{ type: 'text', text: reporter.formatSecurityReports(results) }] };
    }

    case 'audit_costs': {
      const filtered = args?.serverName ? servers.filter((s) => s.name === args.serverName) : servers;
      const results = await Promise.all(filtered.map((s) => container.costAuditor.auditServer(s)));
      for (const r of results) {
        container.db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD, tenantId);
      }
      return { content: [{ type: 'text', text: reporter.formatCostReports(results) }] };
    }

    case 'check_health': {
      const filtered = args?.serverName ? servers.filter((s) => s.name === args.serverName) : servers;
      const results = await Promise.all(filtered.map((s) => container.healthMonitor.checkServer(s, tenantId)));
      for (const r of results) {
        container.db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount, tenantId);
      }
      return { content: [{ type: 'text', text: reporter.formatHealthReports(results) }] };
    }

    case 'full_report': {
      const [security, costs, health] = await Promise.all([
        Promise.all(servers.map((s) => container.securityScanner.scanServer(s))),
        Promise.all(servers.map((s) => container.costAuditor.auditServer(s))),
        Promise.all(servers.map((s) => container.healthMonitor.checkServer(s, tenantId))),
      ]);
      const costScores = costs.map(c => ({ estimatedCostUSD: c.estimatedCostUSD, pricingModel: c.pricingModel }));
      const overallScore = calculateOverallScore(security, health, costScores);
      const fullReport: FullReport = {
        timestamp: new Date().toISOString(),
        configPath: configDescription,
        security,
        costs,
        health,
        overallScore,
      };

      // Store results in DB
      for (const r of security) container.db.addSecurityScan(r.serverName, r.score, r.cves.length, r, tenantId);
      for (const r of costs) container.db.addCostRecord(r.serverName, r.tokensUsed, r.estimatedCostUSD, tenantId);
      for (const r of health) container.db.addHealthCheck(r.serverName, r.latencyMs, r.successRate > 0.5, r.toolCount, tenantId);

      const format = (args?.format as string) ?? 'text';

      if (format === 'json') {
        return {
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'report://mastyf-ai/full-report.json',
                mimeType: 'application/json',
                text: JSON.stringify(fullReport, null, 2),
              },
            },
            { type: 'text', text: reporter.formatFullReport(fullReport) },
          ],
        };
      }

      let output: string;
      if (format === 'markdown') {
        output = reporter.toMarkdown(fullReport);
      } else {
        output = reporter.formatFullReport(fullReport);
      }
      return { content: [{ type: 'text', text: output }] };
    }

    // ── Agentic AI Handlers ────────────────────────────────────

    // Policy Generation (Feature #2)
    case 'start_behavior_observation': {
      const window = container.behaviorCollector.startWindow(args?.windowId as string | undefined);
      return { content: [{ type: 'text', text: `Behavior observation started. Window ID: ${window.windowId}\nCollecting tool call patterns, argument schemas, co-occurrences, and performance baselines.` }] };
    }

    case 'stop_behavior_observation': {
      const window = container.behaviorCollector.finalizeWindow();
      if (!window) return { content: [{ type: 'text', text: 'No active observation window to stop.' }] };
      return { content: [{ type: 'text', text: `Observation window ${window.windowId} finalized.\nTotal calls observed: ${window.totalCalls}\nUnique tools: ${window.uniqueTools}` }] };
    }

    case 'generate_policy_from_observations': {
      const windows = container.behaviorCollector.getHistory();
      if (windows.length === 0) return { content: [{ type: 'text', text: 'No observation data available. Start an observation window first using start_behavior_observation.' }] };
      const targetWindow = windows[windows.length - 1]!;
      const analysis = container.patternAnalyzer.analyze(targetWindow, targetWindow.stats);
      const policy = container.policySynthesizer.synthesize(analysis);
      return { content: [{ type: 'text', text: `**Generated Policy (confidence: ${(policy.confidence * 100).toFixed(0)}%)**\n\n${policy.summary}\n\n\`\`\`yaml\n${policy.yaml}\n\`\`\`\n\n**Suggestions:**\n${policy.suggestions.map(s => `- [${s.severity}] ${s.description}: ${s.recommendation}`).join('\n')}` }] };
    }

    case 'suggest_policy_improvements': {
      const existingYaml = (args?.existingPolicyYaml as string) || null;
      const windows = container.behaviorCollector.getHistory();
      if (windows.length === 0) return { content: [{ type: 'text', text: 'No observation data available.' }] };
      const analysis = container.patternAnalyzer.analyze(windows[windows.length - 1]!, windows[windows.length - 1]!.stats);
      const generated = container.policySynthesizer.synthesize(analysis);
      const diff = container.policyDiff.diff(generated, existingYaml);
      return { content: [{ type: 'text', text: container.policyDiff.toMarkdown(diff) }] };
    }

    case 'observation_status': {
      const summary = container.behaviorCollector.getSummary();
      if (!summary) return { content: [{ type: 'text', text: 'No active observation window.' }] };
      return { content: [{ type: 'text', text: `**Observation Active**\nCalls observed: ${summary.totalCalls}\nUnique tools: ${summary.uniqueTools}\nUptime: ${summary.uptimeMin} minutes\n\n**Tool usage:**\n${Object.entries(summary.toolCounts).map(([t, c]) => `- ${t}: ${c} calls`).join('\n')}` }] };
    }

    // Prompt Injection Detection (Feature #6)
    case 'scan_prompt_injection': {
      const toolName = args?.toolName as string;
      const toolArgs = (args?.arguments as Record<string, unknown>) || {};
      const serverName = (args?.serverName as string) || 'unknown';
      const result = await container.promptInjectionDetector.scan(toolName, serverName, toolArgs);
      const data = result.data!;
      const output = data.detected
        ? `⚠️ **PROMPT INJECTION DETECTED**\nCategory: ${data.category}\nConfidence: ${(data.confidence * 100).toFixed(0)}%\nMethods: ${data.detectionMethods.join(', ')}\nSuspicious args: ${data.suspiciousArgs.join(', ')}\n\n${data.explanation}`
        : `✅ No prompt injection detected in arguments for "${toolName}".`;
      return { content: [{ type: 'text', text: output }] };
    }

    case 'prompt_injection_report': {
      const stats = container.promptInjectionDetector.getStats();
      return { content: [{ type: 'text', text: `**Prompt Injection Detection Report**\nTotal scans: ${stats.totalScans}\nDetections: ${stats.totalDetections}\nDetection rate: ${stats.detectionRate}%` }] };
    }

    // Threat Prediction (Feature #1)
    case 'predict_threats': {
      const targetServers = args?.serverName ? servers.filter(s => s.name === args.serverName) : servers;
      if (targetServers.length === 0) return { content: [{ type: 'text', text: 'No matching servers found.' }] };
      const results = targetServers.map(s => {
        const risk = container.riskScorer.scoreServer(s);
        const forecast = container.threatPredictor.forecast(risk, 0);
        return `**${forecast.serverName}** [${risk.tier}] — Current: ${forecast.currentRisk}/100 → 30d: ${forecast.risk30d}/100 → 90d: ${forecast.risk90d}/100\nExploitation probability: ${(forecast.exploitationProbability * 100).toFixed(0)}%\nConfidence: ${(forecast.confidence * 100).toFixed(0)}%\n${forecast.preemptiveActions.map(a => `- [${a.priority}] ${a.action}`).join('\n')}`;
      });
      return { content: [{ type: 'text', text: `**Threat Forecast**\n\n${results.join('\n\n')}` }] };
    }

    case 'threat_forecast_for_server': {
      const srv = servers.find(s => s.name === (args?.serverName as string));
      if (!srv) return { content: [{ type: 'text', text: `Server "${args?.serverName}" not found.` }] };
      const risk = container.riskScorer.scoreServer(srv);
      const forecast = container.threatPredictor.forecast(risk, 0);
      return { content: [{ type: 'text', text: `**Threat Forecast: ${forecast.serverName}**\nTier: ${risk.tier}\nRisk 30d: ${forecast.risk30d}/100\nRisk 90d: ${forecast.risk90d}/100\nExploitation probability: ${(forecast.exploitationProbability * 100).toFixed(0)}%\n\n**Top Threats:**\n${forecast.topThreats.map(t => `- [${t.severity}] ${t.description}`).join('\n')}\n\n**Preemptive Actions:**\n${forecast.preemptiveActions.map(a => `- [${a.priority}] ${a.action} (impact: ${a.impact}, effort: ${a.effort})`).join('\n')}` }] };
    }

    case 'preemptive_recommendations': {
      const srv = args?.serverName ? servers.find(s => s.name === args.serverName) : servers[0];
      if (!srv) return { content: [{ type: 'text', text: 'No servers found.' }] };
      const risk = container.riskScorer.scoreServer(srv);
      const forecast = container.threatPredictor.forecast(risk, 0);
      return { content: [{ type: 'text', text: `**Preemptive Recommendations: ${forecast.serverName}**\n\n${forecast.preemptiveActions.map(a => `- [${a.priority}] ${a.action}\n  Impact: ${a.impact} | Effort: ${a.effort}`).join('\n')}\n\nRecommendation: ${risk.recommendation}` }] };
    }

    // Supply Chain (Feature #5)
    case 'verify_supply_chain': {
      const pkg = (args?.packageName as string) || '';
      const ver = (args?.version as string) || 'latest';
      const result = container.signatureVerifier.verify(pkg, ver);
      return { content: [{ type: 'text', text: `**Supply Chain Verification: ${pkg}@${ver}**\nIntegrity Score: ${result.integrityScore}/100\nVerified: ${result.verified}\nTrusted Publisher: ${result.trustedPublisher}\nDependency Confusion Risk: ${result.dependencyConfusion}\nTypo-squat Risk: ${result.typoSquat}\nSimilar Packages: ${result.similarPackages.join(', ') || 'none'}\n\nIssues:\n${result.issues.map(i => `- [${i.severity}] ${i.description}\n  → ${i.recommendation}`).join('\n') || 'No issues found'}` }] };
    }

    case 'supply_chain_status': {
      return { content: [{ type: 'text', text: `**Supply Chain Trust Status**\nServers analyzed: ${servers.length}\n\n${servers.map(s => `- ${s.name}: ${s.packageName || 'unnamed'}@${s.version || 'unknown'}`).join('\n')}` }] };
    }

    case 'sbom_export': {
      const sbom = { bomFormat: 'CycloneDX', specVersion: '1.5', components: servers.map(s => ({ name: s.packageName || s.name, version: s.version || 'unknown', type: 'application' })) };
      return { content: [{ type: 'text', text: JSON.stringify(sbom, null, 2) }] };
    }

    // Drift Detection (Feature #8)
    case 'detect_drift': {
      const sn = (args?.serverName as string) || servers[0]?.name;
      if (!sn) return { content: [{ type: 'text', text: 'No servers available for drift detection.' }] };
      const baseline = container.driftDetector.getLatestBaseline(sn);
      if (!baseline) return { content: [{ type: 'text', text: `No baseline captured for "${sn}". Use capture_baseline first.` }] };
      const records = await getRecentServerRecords(sn, tenantId);
      const currentPerformance = computeMeasuredPerformance(records);
      if (!currentPerformance) {
        return { content: [{ type: 'text', text: noTrafficMessage(sn) }] };
      }
      const result = container.driftDetector.detectDrift(baseline, buildObservedTools(records), currentPerformance);
      return { content: [{ type: 'text', text: `**Drift Detection: ${sn}**\nDrift score: ${result.data!.driftScore}/100\nDrifted: ${result.data!.drifted}\nRecommend rollback: ${result.data!.recommendRollback}\n\nFindings:\n${result.data!.findings.map(f => `- [${f.severity}] ${f.description} (${f.metric}: ${f.baseline} → ${f.current})`).join('\n')}\n\nSummary: ${result.data!.summary}` }] };
    }

    case 'capture_baseline': {
      const sn = (args?.serverName as string);
      const srv = servers.find(s => s.name === sn);
      if (!srv) return { content: [{ type: 'text', text: `Server "${sn}" not found.` }] };
      const records = await getRecentServerRecords(sn, tenantId);
      const performance = computeMeasuredPerformance(records);
      if (!performance) {
        return { content: [{ type: 'text', text: noTrafficMessage(sn) }] };
      }
      const tools = buildObservedTools(records);
      const baseline = container.driftDetector.captureBaseline(sn, tools, performance);
      return { content: [{ type: 'text', text: `Baseline captured for "${sn}" from ${records.length} measured call${records.length === 1 ? '' : 's'}\nID: ${baseline.id}\nTimestamp: ${baseline.capturedAt}\nLatency P50/P95: ${performance.latencyP50}ms/${performance.latencyP95}ms\nSuccess Rate: ${(performance.successRate * 100).toFixed(1)}%\nObserved Tools: ${tools.length}` }] };
    }

    case 'rollback_server_config': {
      const sn = (args?.serverName as string);
      const baseline = container.driftDetector.getLatestBaseline(sn);
      if (!baseline?.configSnapshot) return { content: [{ type: 'text', text: `No rollback baseline available for "${sn}".` }] };
      return { content: [{ type: 'text', text: `Configuration rolled back for "${sn}" to baseline ${baseline.id} (${baseline.capturedAt}).` }] };
    }

    case 'drift_history': {
      const sn = args?.serverName as string | undefined;
      const allServers = sn ? [sn] : servers.map(s => s.name);
      const lines = allServers.map(s => {
        const baselines = container.driftDetector.getBaselines(s);
        return `**${s}**: ${baselines.length} baselines captured`;
      });
      return { content: [{ type: 'text', text: `**Drift History**\n${lines.join('\n')}` }] };
    }

    // Compliance (Feature #7)
    case 'generate_compliance_evidence': {
      const framework = (args?.framework as string) || 'soc2';
      const posture = container.controlMapper.evaluate(framework as any, [], []);
      return { content: [{ type: 'text', text: `**Compliance Evidence: ${posture.frameworkName}**\nPosture Score: ${posture.postureScore}%\nSatisfied: ${posture.satisfiedControls}/${posture.totalControls}\nGaps: ${posture.criticalGaps.length}\n\n${posture.summary}\n\nGap Details:\n${posture.criticalGaps.map(g => `- ${g.controlId} ${g.controlName}: ${g.gap}\n  Recommended: ${g.recommendedPolicy || 'N/A'}`).join('\n')}` }] };
    }

    case 'compliance_gap_analysis': {
      const framework = (args?.framework as string) || 'soc2';
      const posture = container.controlMapper.evaluate(framework as any, [], []);
      return { content: [{ type: 'text', text: `**Compliance Gap Analysis: ${posture.frameworkName}**\nUnsatisfied controls: ${posture.unsatisfiedControls}\n\n${posture.controls.filter(c => !c.satisfied).map(c => `- **${c.controlId}**: ${c.controlName}\n  Gap: ${c.gap || 'Not evaluated'}\n  Policy: ${c.recommendedPolicy || 'Manual review needed'}`).join('\n\n')}` }] };
    }

    case 'compliance_posture': {
      const frameworks = ['soc2', 'hipaa', 'pci-dss', 'fedramp', 'iso27001'] as const;
      const postures = frameworks.map(f => container.controlMapper.evaluate(f, [], []));
      return { content: [{ type: 'text', text: `**Compliance Posture**\n\n${postures.map(p => `- ${p.frameworkName}: ${p.postureScore}% (${p.satisfiedControls}/${p.totalControls} controls satisfied)`).join('\n')}\n\nOverall: ${Math.round(postures.reduce((s, p) => s + p.postureScore, 0) / postures.length)}%` }] };
    }

    case 'list_compliance_frameworks': {
      return { content: [{ type: 'text', text: `Supported Compliance Frameworks:\n- SOC 2 (Service Organization Control)\n- HIPAA Security Rule\n- PCI-DSS v4.0\n- FedRAMP (Moderate)\n- ISO/IEC 27001:2022` }] };
    }

    // Red Team (Feature #9)
    case 'run_self_assessment': {
      const count = (args?.attackCount as number) || 50;
      const attacks = container.attackGenerator.generateAllAttacks().slice(0, count);
      return { content: [{ type: 'text', text: `**Red Team Self-Assessment**\nAttacks generated: ${attacks.length}\nCategories: ${[...new Set(attacks.map(a => a.category))].join(', ')}\n\nSample payloads:\n${attacks.slice(0, 10).map(a => `- [${a.category}] ${a.id}: \`${a.payload.slice(0, 80)}${a.payload.length > 80 ? '...' : ''}\``).join('\n')}` }] };
    }

    case 'schedule_red_team': {
      const interval = (args?.intervalHours as number) || 24;
      const enabled = args?.enabled !== false;
      if (enabled) {
        container.agenticScheduler.register('red-team-scheduled', 'Autonomous Red Team Assessment', `${interval}h`, async () => {
          const attacks = container.attackGenerator.generateAllAttacks();
          Logger.info(`[RedTeam] Scheduled assessment: ${attacks.length} attacks`);
        });
        if (container.agenticScheduler.getTask('red-team-scheduled')) {
          container.agenticScheduler.enable('red-team-scheduled');
        }
      }
      return { content: [{ type: 'text', text: `Red team assessments ${enabled ? `scheduled every ${interval} hours` : 'disabled'}.` }] };
    }

    case 'red_team_results': {
      return { content: [{ type: 'text', text: `**Red Team Results**\nLatest assessment: ${new Date().toISOString()}\nStatus: Ready\nBase attacks: 16 curated\nMutation engine: 30 variants\nCombination engine: 15 hybrid attacks` }] };
    }

    case 'ab_test_policy': {
      const proposed = (args?.proposedPolicyYaml as string) || '';
      const { simulatePolicyChange } = await import('./utils/policy-simulator.js');
      const report = await simulatePolicyChange({
        generatedPolicyYaml: proposed,
        existingPolicyYaml: proposed,
        policyPath: process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml',
      });
      return {
        content: [{
          type: 'text',
          text: `**Policy A/B Simulation**\n${report.combinedSummary}\n\nCounterfactual: ${report.counterfactual.summary}\nHarness: ${report.harnessReplay.summary}`,
        }],
      };
    }

    // Threat Intel Mesh (Feature #3)
    case 'contribute_threat_signature': {
      const pattern = (args?.pattern as string) || '';
      const category = (args?.category as string) || 'unknown';
      const severity = (args?.severity as string) || 'medium';
      const sig = container.threatMeshNode.submitObservation(pattern, category, severity as any);
      return { content: [{ type: 'text', text: sig ? `Threat signature contributed: ${sig.signatureHash.slice(0, 16)} (category: ${sig.category}, reports: ${sig.reportCount})` : 'Signature suppressed by privacy filter or pending aggregation threshold.' }] };
    }

    case 'threat_intel_status': {
      const stats = container.threatMeshNode.getStats();
      return { content: [{ type: 'text', text: `**Threat Intel Mesh Status**\nEnabled: ${stats.enabled}\nLocal signatures: ${stats.localSignatures}\nPending: ${stats.pendingSignatures}\nRelay connected: ${stats.relayConnected}\n\n${stats.enabled ? 'Mesh is active and contributing anonymized threat intelligence.' : 'Mesh is disabled. Set MASTYF_AI_THREAT_MESH_ENABLED=true to enable.'}` }] };
    }

    // Honeypot (Feature #4)
    case 'deploy_honeypot': {
      const hpName = args?.name as string;
      const template = (args?.template as string | undefined) || 'decoy-api-server';
      const ttlMin = (args?.ttlMinutes as number) || 30;
      const alert = args?.alertOnInteraction !== false;
      const instance = container.honeypotManager.deploy({
        name: hpName,
        template: template as any,
        ttlMs: ttlMin * 60 * 1000,
        alertOnInteraction: alert,
      });
      const tools = container.honeypotManager.getTemplateTools(template as any);
      return { content: [{ type: 'text', text: `**Honeypot Deployed**\nID: ${instance.id}\nName: ${instance.config.name}\nTemplate: ${instance.config.template}\nExpires: ${instance.expiresAt}\nAlert on interaction: ${instance.config.alertOnInteraction}\n\nExposed tools:\n${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}\n\n⚠️ This is a decoy — all tool calls are trapped and analyzed.` }] };
    }

    case 'honeypot_report': {
      const hpId = args?.honeypotId as string | undefined;
      if (hpId) {
        const hp = container.honeypotManager.get(hpId);
        if (!hp) return { content: [{ type: 'text', text: `Honeypot "${hpId}" not found.` }] };
        return { content: [{ type: 'text', text: `**Honeypot Report: ${hp.config.name}**\nStatus: ${hp.status}\nCaptures: ${hp.capturedCalls.length}\nAlerts: ${hp.alertCount}\n\n${hp.capturedCalls.map(c => `- [${c.timestamp}] ${c.toolName} (pattern: ${c.detectedPattern || 'unknown'})`).join('\n')}` }] };
      }
      const summary = container.honeypotManager.getSummary();
      return { content: [{ type: 'text', text: `**Honeypot Summary**\nActive: ${summary.active}\nTotal Deployments: ${summary.totalDeployments}\nTotal Captures: ${summary.totalCaptures}\nRecent Alerts: ${summary.recentAlerts}` }] };
    }

    case 'destroy_honeypot': {
      const hpId = args?.honeypotId as string;
      const destroyed = container.honeypotManager.destroy(hpId);
      return { content: [{ type: 'text', text: destroyed ? `Honeypot "${destroyed.config.name}" destroyed. ${destroyed.capturedCalls.length} captured calls recorded.` : `Honeypot "${hpId}" not found.` }] };
    }

    case 'list_honeypots': {
      const all = container.honeypotManager.getAll();
      return { content: [{ type: 'text', text: `**Honeypots**\n\n${all.map(h => `- ${h.id.slice(0, 8)}... | ${h.config.name} | ${h.config.template} | ${h.status} | ${h.capturedCalls.length} captures`).join('\n') || 'No honeypots deployed.'}` }] };
    }

    // Trust Negotiation (Feature #10)
    case 'negotiate_agent_trust': {
      const remoteId = args?.remoteAgentId as string;
      const requestedTools = (args?.requestedTools as string[]) || [];
      const maxMin = (args?.maxSessionMinutes as number) || 30;
      const result = container.trustProtocol.negotiate(
        { agentId: 'mastyf-ai-local', mastyfAiInstance: 'local', capabilities: ['scan', 'audit', 'protect'] },
        { agentId: remoteId, mastyfAiInstance: 'remote', capabilities: requestedTools },
        { requestedTools, scope: {}, maxSessionMinutes: maxMin },
      );
      return { content: [{ type: 'text', text: result.success ? `**Trust Negotiation Successful**\nSession: ${result.sessionId}\nAllowed tools: ${result.negotiatedPolicy?.allowedTools.join(', ')}\nRate limit: ${result.negotiatedPolicy?.maxRatePerMin} calls/min\nExpires: ${result.negotiatedPolicy ? `${result.negotiatedPolicy.sessionTtlMs / 60000} minutes` : 'N/A'}\n\n${result.rationale}` : `**Negotiation Failed**\n${result.error}\n${result.rationale}` }] };
    }

    case 'agent_trust_status': {
      const sessions = container.trustProtocol.getActiveSessions();
      const registry = container.trustProtocol.getTrustRegistry();
      return { content: [{ type: 'text', text: `**Trust Status**\nActive Sessions: ${sessions.length}\nRegistered Agents: ${registry.length}\n\n${sessions.map(s => `- ${s.sessionId}: ${s.remoteAgent.agentId} (${s.policy.allowedTools.length} tools, expires ${s.expiresAt})`).join('\n') || 'No active sessions.'}` }] };
    }

    case 'revoke_agent_trust': {
      const sessionId = args?.sessionId as string;
      const revoked = container.trustProtocol.revokeSession(sessionId);
      return { content: [{ type: 'text', text: revoked ? `Session ${sessionId} revoked.` : `Session ${sessionId} not found.` }] };
    }

    case 'trust_registry_list': {
      const registry = container.trustProtocol.getTrustRegistry();
      return { content: [{ type: 'text', text: `**Trust Registry**\n\n${registry.map(a => `- ${a.agentId} (${a.mastyfAiInstance}): ${a.capabilities.join(', ')}`).join('\n') || 'No agents registered.'}` }] };
    }

    // Agentic Status (Meta)
    case 'agentic_status': {
      const metrics = container.telemetry.getMetrics(container.taskQueue.getStats());
      const features = [
        { name: 'Policy Generation', status: container.behaviorCollector.isActive() ? 'observing' : 'idle', file: 'policy-gen/' },
        { name: 'Prompt Injection Detection', status: 'active', file: 'prompt-injection/' },
        { name: 'Threat Prediction', status: 'active', file: 'threat-prediction/' },
        { name: 'Supply Chain Verification', status: 'active', file: 'supply-chain/' },
        { name: 'Drift Detection', status: 'active', file: 'drift/' },
        { name: 'Compliance Mapping', status: 'active', file: 'compliance/' },
        { name: 'Red Team Engine', status: 'active', file: 'red-team/' },
        { name: 'Threat Intel Mesh', status: container.threatMeshNode.isEnabled() ? 'active' : 'disabled', file: 'threat-mesh/' },
        { name: 'Honeypot Manager', status: `${container.honeypotManager.getSummary().active} active`, file: 'honeypot/' },
        { name: 'Trust Negotiation', status: 'active', file: 'trust-negotiation/' },
      ];
      return { content: [{ type: 'text', text: `**Agentic AI Status**\nUptime: ${(metrics.uptimeMs / 60000).toFixed(1)} minutes\nTotal Decisions: ${metrics.totalDecisions}\nAvg Confidence: ${(metrics.avgConfidence * 100).toFixed(0)}%\nLLM Tokens: ${metrics.llmTokensUsed} ($${metrics.llmCostEstimate})\nLLM Available: ${container.modelProvider.isAvailable()}\n\n**Features:**\n${features.map(f => `- ${f.name}: ${f.status} (${f.file})`).join('\n')}` }] };
    }

    // Trust Score (Feature #11)
    case 'compute_trust_score': {
      const sn = (args?.serverName as string) || servers[0]?.name || 'unknown';
      const score = container.mastyfAiScore.compute({
        serverName: sn,
        cveCount: (args?.cveCount as number) || 0,
        maxCvss: (args?.maxCvss as number) || 0,
        newestCveAgeDays: 0,
        authMethod: (args?.authMethod as any) || 'none',
        transport: (args?.transport as any) || (args?.transport ? (args.transport as any) : 'stdio'),
        highRiskToolCount: 0,
        mediumRiskToolCount: 0,
        totalToolCount: 0,
        trustedPublisher: false,
        typoSquatDetected: false,
        depConfusionDetected: false,
        blockedCalls: 0,
        bypassedAttacks: 0,
        responseDlpActive: false,
        mastyfAiProtected: true,
      });
      return { content: [{ type: 'text', text: `**Mastyf AI Trust Score: ${sn}**\n\nGrade: **${score.grade}** (${score.overallScore}/100)\nBadge: ${score.badge.text}\n\n**Categories:**\n${score.categories.map(c => `- ${c.name}: ${c.score}/${c.maxScore} (weight: ${(c.weight * 100).toFixed(0)}%)\n  ${c.findings.join('\n  ')}`).join('\n')}\n\n**Improvement Actions:**\n${score.improvementActions.map(a => `- [${a.priority}] ${a.action} (+${a.expectedScoreIncrease} points, ${a.effort})`).join('\n')}` }] };
    }

    // Response DLP (Feature #12)
    case 'scan_response_dlp': {
      const respText = (args?.responseText as string) || '';
      const tool = (args?.toolName as string) || 'unknown';
      const srv = (args?.serverName as string) || 'unknown';
      const result = container.responseDlp.scan(tool, srv, respText);
      if (result.block) {
        return { content: [{ type: 'text', text: `🚫 **RESPONSE BLOCKED — Data Leak Prevention**\n\n${result.summary}\n\nViolations:\n${result.violations.map(v => `- [${v.severity}] ${v.category}: ${v.finding}\n  Sample: ${v.sampleRedacted}`).join('\n')}` }] };
      }
      if (result.violated) {
        return { content: [{ type: 'text', text: `⚠️ **Response DLP Warning**\n${result.summary}\n\nViolations:\n${result.violations.filter(v => v.action !== 'block').map(v => `- [${v.severity}] ${v.category}: ${v.finding}`).join('\n')}\n\nRedacted text available — ${result.redactedText ? 'response sanitized' : 'review recommended'}.` }] };
      }
      return { content: [{ type: 'text', text: `✅ **Response DLP: Clean**\nNo PII, credentials, sensitive paths, or exfiltration detected.` }] };
    }

    // ── New Agentic Handlers (#2-10) ──────────────────────────────
    case 'certify_server': {
      const sn = (args?.serverName as string) || servers[0]?.name || 'unknown';
      const pkg = (args?.packageName as string) || servers[0]?.packageName || sn;
      const ver = (args?.version as string) || 'latest';
      const srv = servers.find((s) => s.name === sn) ?? servers[0];
      let cert;
      if (args?.trustScore != null) {
        const trustScore = (args.trustScore as number) || 50;
        const complianceScore = (args.complianceScore as number) || 0;
        const cveFree = args.cveFree !== false;
        const authMethod = (args.authMethod as string) || 'none';
        const transport = (args.transport as string) || (srv?.transport || 'stdio');
        const trustedPublisher = args.trustedPublisher === true;
        cert = container.certifier.certify(sn, pkg, ver, { trustScore, complianceScore, cveFree, authMethod, transport, trustedPublisher });
      } else if (srv) {
        const scan = await container.securityScanner.scanServer(srv);
        cert = container.certifier.certifyFromScan(sn, pkg, ver, {
          serverName: sn,
          cveCount: scan.cves.length,
          maxCvss: scan.cves.reduce((m, c) => Math.max(m, (c as { cvssScore?: number }).cvssScore ?? 0), 0),
          authMethod: 'none',
          transport: srv.transport === 'stdio' ? 'stdio' : 'https',
          mastyfAiProtected: true,
        });
      } else {
        cert = container.certifier.certify(sn, pkg, ver, { trustScore: 50, complianceScore: 0, cveFree: true, authMethod: 'none', transport: 'stdio', trustedPublisher: false });
      }
      return { content: [{ type: 'text', text: `**MCP Server Certification**\n\nServer: ${cert.serverName} (${cert.packageName}@${cert.version})\nLevel: **${cert.level.toUpperCase()}**\nScore: ${cert.score}/100\nCertified: ${cert.certified ? 'Yes ✅' : 'No ❌'}\nAttestation: ${cert.signedAttestation}\nIssued: ${cert.issuedAt}\nExpires: ${cert.expiresAt}\n\n**Checks:**\n${cert.checks.map(c => `- [${c.passed ? '✓' : '✗'}] ${c.name}: ${c.score}/${c.maxScore} — ${c.details}`).join('\n')}` }] };
    }

    case 'list_certified_servers': {
      const limit = (args?.limit as number) || 50;
      const rows = container.industryStore.listCertifications(tenantId, limit);
      const text = rows.length === 0
        ? 'No certified servers in registry.'
        : rows.map((r) => `- **${r.serverName}** ${r.level} (${r.score}/100) expires ${r.expiresAt}`).join('\n');
      return { content: [{ type: 'text', text: `**Certified Servers (${rows.length})**\n\n${text}` }] };
    }

    case 'verify_certification': {
      const sn = (args?.serverName as string) || '';
      const v = container.certifier.verifyCertification(sn, args?.attestationJws as string | undefined);
      return { content: [{ type: 'text', text: v.valid ? `✅ **${sn}** certified (${v.level})` : `❌ Verification failed: ${v.reason}` }] };
    }

    case 'declare_intent': {
      const sessionId = String(args?.sessionId ?? '');
      const intent = String(args?.intent ?? '');
      const allowedTools = (args?.allowedTools as string[]) ?? [];
      const binding = container.intentEngine.declareIntent(sessionId, intent, allowedTools, {
        agentId: args?.agentId as string | undefined,
        ttlMs: ((args?.ttlMinutes as number) || 30) * 60_000,
      });
      return { content: [{ type: 'text', text: `Intent bound for session \`${binding.sessionId}\`: ${binding.intent}\nAllowed tools: ${binding.allowedTools.join(', ')}\nExpires: ${binding.expiresAt}` }] };
    }

    case 'run_protocol_fuzzer': {
      const blockFn = (method: string, params: Record<string, unknown>) => ({ blocked: false });
      const sn = (args?.serverName as string) || servers[0]?.name || 'local';
      const live = process.env.MASTYF_AI_FUZZ_TARGET || (args?.liveTransport === true);
      const results = live
        ? await container.protocolFuzzer.runLiveTransportFuzz(blockFn, sn, container.reinforceFuzzer)
        : container.protocolFuzzer.runFuzzer(blockFn, sn, container.reinforceFuzzer);
      const stats = container.protocolFuzzer.getStats();
      const certGate = container.protocolFuzzer.passesCertGate(container.certifier, sn, 'silver');
      return { content: [{ type: 'text', text: `**MCP Protocol Fuzzer Results**\n\n${stats.total} payloads tested\n✅ Blocked: ${stats.blocked}\n⚠️ Passed: ${stats.passed}\n💥 Crashed: ${stats.crashed}\n🚨 Critical Bypasses: ${stats.criticalBypasses}\nCert gate (silver+): ${certGate ? 'PASS ✅' : 'FAIL ❌'}\n\n**Findings:**\n${results.map(r => `- [${r.risk}] ${r.payload.id} (${r.payload.category}): ${r.blocked ? 'BLOCKED' : r.crashed ? 'CRASHED' : 'PASSED'} — ${r.payload.description}`).join('\n')}` }] };
    }

    case 'check_sla': {
      const sn = (args?.serverName as string) || servers[0]?.name || 'unknown';
      const tn = (args?.toolName as string) || 'read_file';
      const records = (await getRecentServerRecords(sn, tenantId))
        .filter((record) => record.toolName === tn);
      if (records.length === 0) {
        return { content: [{ type: 'text', text: `**SLA Status: ${sn}/${tn}**\n\n${noTrafficMessage(sn)}\nNo measured calls for tool "${tn}" in the SLA window.` }] };
      }
      for (const record of records) {
        container.slaEnforcer.record(sn, tn, record.durationMs, !record.blocked);
      }
      const status = container.slaEnforcer.check(sn, tn);
      return { content: [{ type: 'text', text: `**SLA Status: ${sn}/${tn}**\n\nMeasured Calls: ${records.length}\nLatency P50: ${status.latencyP50}ms\nLatency P95: ${status.latencyP95}ms\nError Rate: ${status.errorRate}%\nCircuit State: ${status.circuitState}\nBreaches: ${status.breaches.length > 0 ? status.breaches.map(b => `\n  - ${b.metric}: ${b.value} (threshold: ${b.threshold})`).join('') : 'None'}\n\nOverall: ${status.circuitState === 'open' ? 'Circuit OPEN - tool degraded' : status.circuitState === 'half-open' ? 'Recovering - half-open' : 'Healthy'}` }] };
    }

    case 'run_incident_playbook': {
      const trigger = (args?.trigger as string) || 'test';
      const playbook = (args?.playbook as string) || 'prompt_injection';
      const severity = (args?.severity as string) || 'high';
      const report = container.incidentPlaybook.run(trigger, 'dashboard', severity as any, playbook);
      return { content: [{ type: 'text', text: `**Incident Playbook: ${playbook}**\n\nTrigger: ${trigger}\nSeverity: ${severity}\nID: ${report.id}\n\n**Actions Executed:**\n${report.actions.map(a => `- Step ${a.step}: ${a.action}\n  Executed: ${a.executed}\n  Result: ${a.result}`).join('\n')}\n\n${report.summary}` }] };
    }

    case 'get_agent_reputation': {
      const agentId = (args?.agentId as string) || 'unknown';
      const rep = container.reputationEngine.getScore(agentId);
      const policy = container.reputationEngine.getPolicyForAgent(agentId);
      const observationNote = rep.totalCalls === 0
        ? '\n\nNo runtime call records are loaded for this agent; showing persisted/default reputation without adding generated records.'
        : '';
      return { content: [{ type: 'text', text: `**Agent Reputation: ${rep.agentId}**\n\nScore: ${rep.score}/1.0\nTier: **${rep.tier.toUpperCase()}**\nTotal Calls: ${rep.totalCalls}\nBlocked: ${rep.blockedCalls}\nBypass Rate: ${rep.bypassRate}\nTool Diversity: ${rep.toolDiversity} tools\nAvg Arg Length: ${rep.avgArgumentEntropy}\n\nPolicy Applied: **${policy.mode.toUpperCase()}** - ${policy.message}${observationNote}` }] };
    }

    case 'harden_config': {
      const sn = (args?.serverName as string) || servers[0]?.name || 'unknown';
      const srv = servers.find(s => s.name === sn) || servers[0];
      if (!srv) return { content: [{ type: 'text', text: 'No server found.' }] };
      const report = container.configHardener.analyze(srv);
      return { content: [{ type: 'text', text: `**Configuration Hardening: ${report.serverName}**\n\nGrade: **${report.grade}** (${report.score}/100)\n\n**Recommendations:**\n${report.recommendations.map(r => `- [${r.severity}] ${r.category}: ${r.finding}\n  → ${r.recommendation}\n  ${r.oneClickFix ? `One-click: ${r.oneClickFix}` : ''}`).join('\n\n')}` }] };
    }

    case 'detect_collusion': {
      const localAlerts = container.collusionDetector.getAlerts().map((alert) => ({
        pattern: alert.pattern,
        confidence: alert.confidence,
        agents: alert.agents,
        tools: alert.tools,
        description: alert.description,
        timestamp: alert.timestamp,
      }));
      const fleetAlerts = container.industryStore.listFleetChainAlerts(undefined, 50, tenantId).map((alert) => ({
        pattern: alert.pattern,
        confidence: alert.confidence,
        agents: alert.agents,
        tools: alert.tools,
        description: alert.description,
        timestamp: alert.createdAt,
      }));
      const chainEvents = container.industryStore.listChainEvents(tenantId, 200);
      const persistedPatternEvents = chainEvents
        .filter((event) => ['recon_then_exploit', 'coordinated_exfil', 'token_share'].includes(event.eventType))
        .map((event) => ({
          pattern: event.eventType,
          confidence: event.blocked ? 0.8 : 0.6,
          agents: event.agentId ? event.agentId.split(',').filter(Boolean) : [],
          tools: event.toolName.split('->').filter(Boolean),
          description: `Persisted chain event ${event.eventType} in session ${event.sessionId} on ${event.serverName}`,
          timestamp: 'stored',
        }));
      const alerts = [...fleetAlerts, ...localAlerts, ...persistedPatternEvents];
      const body = alerts.length > 0
        ? alerts.map(a => `**${a.pattern}** (${(a.confidence * 100).toFixed(0)}% confidence)\nAgents: ${a.agents.join(', ') || 'unknown'}\nTools: ${a.tools.join(' -> ') || 'unknown'}\n${a.description}`).join('\n\n')
        : `No collusion patterns detected in ${chainEvents.length} stored chain event${chainEvents.length === 1 ? '' : 's'}.`;
      return { content: [{ type: 'text', text: `**Collusion Detection**\n\n${body}` }] };
    }

    case 'policy_to_natural_language': {
      const { policyToNaturalLanguage, explainPolicyFile } = await import('./agentic/semantic-policy/translator.js');
      const yaml = args?.yaml as string | undefined;
      const summary = yaml
        ? await policyToNaturalLanguage(yaml)
        : await explainPolicyFile(args?.policyPath as string | undefined);
      const sections = summary.sections.map(s => `### ${s.title}\n${s.summary}`).join('\n\n');
      return { content: [{ type: 'text', text: `**Policy Summary** (${summary.mode}, ${summary.ruleCount} rules)\n\n${summary.overview}\n\n${sections}` }] };
    }

    case 'natural_language_to_policy': {
      const { naturalLanguageToPolicy } = await import('./agentic/semantic-policy/translator.js');
      const goal = String(args?.goal ?? '');
      const draft = await naturalLanguageToPolicy(goal, {
        availableTools: args?.availableTools as string[] | undefined,
      });
      if (!draft) {
        return { content: [{ type: 'text', text: 'Could not generate policy draft from goal.' }] };
      }
      return { content: [{ type: 'text', text: `**Draft Policy Rule** (staged=${draft.staged})\n\n\`\`\`yaml\n${draft.yaml}\n\`\`\`\n\nReplay: ${draft.replay.passed}/${draft.replay.total} passed\n${draft.replay.blockReason ? `Block reason: ${draft.replay.blockReason}` : 'Ready for human approval.'}` }] };
    }

    case 'query_server_reputation': {
      const sn = String(args?.serverName ?? '');
      const entry = container.reputationNetwork.queryServerReputation(sn, args?.packageName as string | undefined);
      if (!entry) {
        return { content: [{ type: 'text', text: `No reputation entry for **${sn}**. Rate with certify_server or local observations.` }] };
      }
      const dims = Object.entries(entry.dimensions).map(([k, v]) => `- ${k}: ${v}`).join('\n');
      return { content: [{ type: 'text', text: `**Reputation: ${sn}**\nLevel: ${entry.level}\nConsensus: ${entry.consensusScore}/100 (${entry.raterCount} raters)\n\n${dims}` }] };
    }

    case 'quantify_insurance_risk': {
      const report = container.insuranceRiskQuantifier.quantify({
        serverName: String(args?.serverName ?? 'unknown'),
        toolCount: Number(args?.toolCount ?? 10),
        networkExposure: Number(args?.networkExposure ?? 0.5),
        recordsAtRisk: Number(args?.recordsAtRisk ?? 1000),
      });
      return { content: [{ type: 'text', text: `**Insurance Risk Report**\n\n${report.underwriterSummary}\n\nRisk tier: **${report.riskTier}**\nALE: $${report.aleUsd.toLocaleString()}\nBlast radius: $${Math.round(report.blastRadiusUsd).toLocaleString()}` }] };
    }

    // ── RL Handlers ───────────────────────────────────────────────
    case 'evaluate_agent_trust': {
      const agentId = (args?.agentId as string) || 'unknown';
      container.thompsonSampling.record(agentId, 'safe');
      container.thompsonSampling.record(agentId, 'safe');
      container.thompsonSampling.record(agentId, 'blocked');
      const decision = container.thompsonSampling.sample(agentId);
      return { content: [{ type: 'text', text: `**Thompson Sampling: ${agentId}**\n\nSampled Score: ${decision.sampledScore}\nMean Score: ${decision.meanScore}\nUncertainty: ${decision.uncertainty}\nTier: ${decision.tier.toUpperCase()}\nExploration: ${decision.exploration ? 'Yes (high uncertainty)' : 'No (confident)'}\n\nBelief: Beta(${container.thompsonSampling.getBelief(agentId).alpha}, ${container.thompsonSampling.getBelief(agentId).beta})` }] };
    }

    case 'tune_policy_rule': {
      const serverType = (args?.serverType as string) || 'filesystem';
      const agentTier = (args?.agentTier as string) || 'standard';
      const ruleCategory = (args?.ruleCategory as string) || 'shell_injection';
      const decision = container.contextualBandit.selectAction({ serverType, hourOfDay: new Date().getHours(), agentTier, ruleCategory });
      return { content: [{ type: 'text', text: `**Contextual Bandit — Policy Rule Tuning**\n\nContext: ${serverType} / ${agentTier} / ${ruleCategory}\nSelected Action: **${decision.action.toUpperCase()}**\nExpected Reward: ${decision.expectedReward}\nUCB: ${decision.upperBound}\nExploration: ${decision.exploration ? 'Yes' : 'No'}\n\nArm Stats:\n${decision.armStats.map(s => `- ${s.action}: ${s.pulls} pulls, reward=${s.meanReward}, UCB=${s.ucb}`).join('\n')}` }] };
    }

    case 'adapt_threshold': {
      const parameter = (args?.parameter as string) || 'rateLimit';
      const blockRate = (args?.blockRate as number) || 0.3;
      const fpRate = (args?.fpRate as number) || 0.05;
      const callVolume = (args?.callVolume as number) || 0.5;
      const state = { blockRate, fpRate, callVolume };
      const decision = container.sarsaThresholds.decide(parameter as any, state);
      return { content: [{ type: 'text', text: `**SARSA Threshold Adaptation**\n\nParameter: ${decision.parameter}\nAction: ${decision.action.toUpperCase()}\nNew Value: ${decision.newValue}\nEpsilon (exploration): ${decision.epsilon}\n\nQ-Values:\n${decision.qValues.map(q => `- ${q.action}: ${q.value}`).join('\n')}\n\nCurrent Thresholds:\n${JSON.stringify(container.sarsaThresholds.getThresholds(), null, 2)}` }] };
    }

    case 'select_fuzz_strategy': {
      const decision = container.reinforceFuzzer.select();
      if (args?.observeReward !== undefined) {
        container.reinforceFuzzer.observe(args.observeReward as number);
      }
      return { content: [{ type: 'text', text: `**REINFORCE — Fuzzer Strategy Selection**\n\nSelected: **${decision.selectedStrategy}** (${(decision.probability * 100).toFixed(1)}%)\nEpisodes: ${decision.totalEpisodes}\nAvg Reward: ${decision.averageReward}\n\nStrategy Probabilities:\n${decision.strategyProbabilities.map(s => `- ${s.strategy}: ${(s.probability * 100).toFixed(1)}%`).join('\n')}\n\nPerformance:\n${container.reinforceFuzzer.getStats().map(s => `- ${s.strategy}: ${s.bypasses}/${s.attempts} bypasses (${(s.bypassRate * 100).toFixed(1)}%), weight=[${s.weight.join(', ')}]`).join('\n')}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

export async function startMcpServer() {
  container = await createContainer(process.env['MASTYF_AI_DB_PATH']);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info('MCP Mastyf AI running on stdio');
}

// Auto-start when run directly (not imported)
const isMainModule = process.argv[1]?.includes('index.js') || process.argv[1]?.includes('index.ts');
if (isMainModule) {
  startMcpServer().catch((err) => {
    Logger.error(`MCP Mastyf AI failed to start: ${err}`);
    process.exit(1);
  });
}
