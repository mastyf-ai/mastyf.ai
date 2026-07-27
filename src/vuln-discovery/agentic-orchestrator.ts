/**
 * Agentic VDE orchestrator — thin multi-agent loop over existing scanners.
 *
 * Scout → Correlator → Validator → Reporter → BlockProposal
 * Never auto-applies block rules (human Accept in Threat Lab).
 */
import type { McpServerConfig } from '../types.js';
import { Logger } from '../utils/logger.js';
import { PatternRecognizer } from '../ai/pattern-recognizer.js';
import { isVulnDiscoveryEnabled, auditProbe } from './auth.js';
import { runVulnDiscovery, type VulnDiscoveryRunOptions } from './engine.js';
import { validateFinding, autoValidateEligible, rejectFinding, isNoiseFinding } from './validate.js';
import { analyzeFinding, onFindingValidated } from './vuln-analyst.js';
import { proposeBlockFromFinding } from './propose-block.js';
import { listFindings, compactFindingsStore } from './store.js';
import { buildAgentStackGraph } from './stack-graph.js';
import { reproNovelCandidates } from './repro-agent.js';
import { coverageAgent, prioritizerAgent } from './specialized-agents.js';
import type { VulnFinding, VulnSeverity } from './types.js';
import { clearCveCheckerMemoryCache } from '../scanners/cve-checker.js';

export interface AgenticVulnRunOptions {
  servers: McpServerConfig[];
  upstreamUrls?: string[];
  tenantId?: string;
  supplyChainOnly?: boolean;
  mcpFuzz?: boolean;
  viaProxy?: boolean;
  skipValidate?: boolean;
  skipAnalyze?: boolean;
  skipProposeBlock?: boolean;
  minSeverityForLlm?: VulnSeverity;
  useLlmForBlock?: boolean;
}

export interface AgenticVulnRunResult {
  scoutFindings: number;
  validated: number;
  rejected: number;
  reports: number;
  blockProposals: number;
  errors: string[];
  findingIds: string[];
}

function severityRank(s: VulnSeverity): number {
  const order: VulnSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  return order.indexOf(s);
}

function meetsMinSeverity(s: VulnSeverity, min: VulnSeverity): boolean {
  return severityRank(s) <= severityRank(min);
}

/** Scout agent — reuse engine supply-chain / SAST / upstream. */
async function scoutAgent(
  opts: AgenticVulnRunOptions,
): Promise<{ findings: VulnFinding[]; errors: string[] }> {
  const runOpts: VulnDiscoveryRunOptions = {
    servers: opts.servers,
    upstreamUrls: opts.upstreamUrls,
    supplyChainOnly: opts.supplyChainOnly && !opts.mcpFuzz,
    skipSast: !!opts.supplyChainOnly && !opts.mcpFuzz,
    skipUpstream: !!opts.supplyChainOnly && !opts.mcpFuzz,
    mcpFuzz: opts.mcpFuzz,
    viaProxy: opts.viaProxy,
    autoValidate: false,
    autoAnalyze: false,
  };
  // Force discovery when agentic flag set
  if (process.env.MASTYF_AI_VULN_AGENTIC === 'true') {
    process.env.MASTYF_AI_VULN_DISCOVERY_FORCE = 'true';
    if (process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED === undefined) {
      process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED = 'true';
    }
  }
  const result = await runVulnDiscovery(runOpts);
  return { findings: result.findings, errors: result.summary.errors };
}

/** Correlator — stack graph + cross-layer signals (best-effort). */
function correlatorAgent(servers: McpServerConfig[], findings: VulnFinding[]): void {
  try {
    const graph = buildAgentStackGraph(servers);
    const recognizer = new PatternRecognizer();
    const packageCves = findings
      .filter((f) => f.class === 'dependency')
      .map((f) => ({
        packageName: f.target.name,
        cveId: f.relatedCve,
        serverName: f.target.name,
      }));
    const insights = recognizer.correlateVulnStackSignals({
      packageCves,
      upstreamEvents: (graph.nodes || [])
        .filter((n) => n.kind === 'upstream_api')
        .map((n) => ({ url: n.name, errorRate: 0 })),
    });
    if (insights.length) {
      Logger.info(`[vuln-agentic:correlator] ${insights.length} cross-layer insight(s)`);
      auditProbe({
        action: 'correlate',
        target: 'stack-graph',
        authorized: true,
        detail: insights.map((i) => i.type).join(','),
      });
    }
  } catch (err) {
    Logger.debug(
      `[vuln-agentic:correlator] skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** NoiseRejecter — auto-reject numeric targets / ancient NVD spam before validation. */
function noiseRejecterAgent(findings: VulnFinding[]): number {
  let rejected = 0;
  const seen = new Set<string>();
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const check = isNoiseFinding(f);
    if (!check.noise) continue;
    if (rejectFinding(f.id, check.reason || 'noise-rejecter')) {
      rejected++;
    }
  }
  // Also sweep store candidates not in this scout batch
  for (const f of listFindings({ status: 'candidate' })) {
    if (seen.has(f.id)) continue;
    const check = isNoiseFinding(f);
    if (!check.noise) continue;
    if (rejectFinding(f.id, check.reason || 'noise-rejecter')) {
      rejected++;
    }
  }
  if (rejected) {
    clearCveCheckerMemoryCache();
    Logger.info(`[vuln-agentic:noise-rejecter] rejected ${rejected} noisy finding(s)`);
  }
  return rejected;
}

/** Validator — 2-of-3 promotion for HIGH+ candidates. */
function validatorAgent(): { validated: number; rejected: number } {
  const results = autoValidateEligible();
  const validated = results.filter((r) => r.promoted).length;
  const rejected = results.filter((r) => !r.promoted && r.reason.startsWith('noise:')).length;
  return { validated, rejected };
}

/** Reporter — LLM/template analysis for validated MEDIUM+ */
async function reporterAgent(
  minSeverity: VulnSeverity,
): Promise<number> {
  const validated = listFindings({ status: 'validated' });
  let n = 0;
  for (const f of validated) {
    if (!meetsMinSeverity(f.severity, minSeverity)) continue;
    try {
      const report = await analyzeFinding(f.id);
      if (report) n++;
    } catch (err) {
      Logger.warn(
        `[vuln-agentic:reporter] ${f.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return n;
}

/** BlockProposal — enqueue Threat Lab candidates (human Accept). */
async function blockProposalAgent(
  tenantId?: string,
  useLlm = true,
): Promise<number> {
  const validated = listFindings({ status: 'validated', minSeverity: 'MEDIUM' });
  let n = 0;
  for (const f of validated) {
    try {
      const r = await proposeBlockFromFinding(f.id, { tenantId, llm: useLlm });
      if (r.ok) n++;
    } catch (err) {
      Logger.warn(
        `[vuln-agentic:block] ${f.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return n;
}

/**
 * Full agentic loop. Feature flag: MASTYF_AI_VULN_AGENTIC=true (or CLI forces).
 */
export async function runAgenticVulnDiscovery(
  opts: AgenticVulnRunOptions,
): Promise<AgenticVulnRunResult> {
  const errors: string[] = [];
  const minSev = opts.minSeverityForLlm || 'MEDIUM';

  if (
    !isVulnDiscoveryEnabled()
    && process.env.MASTYF_AI_VULN_AGENTIC !== 'true'
    && process.env.MASTYF_AI_VULN_DISCOVERY_FORCE !== 'true'
  ) {
    return {
      scoutFindings: 0,
      validated: 0,
      rejected: 0,
      reports: 0,
      blockProposals: 0,
      errors: ['disabled — set MASTYF_AI_VULN_AGENTIC=true or MASTYF_AI_VULN_DISCOVERY_ENABLED=true'],
      findingIds: [],
    };
  }

  Logger.info('[vuln-agentic] Scout starting…');
  const scout = await scoutAgent(opts);
  errors.push(...scout.errors);
  compactFindingsStore();

  Logger.info('[vuln-agentic] NoiseRejecter starting…');
  let rejected = noiseRejecterAgent(scout.findings);

  correlatorAgent(opts.servers, scout.findings);

  Logger.info('[vuln-agentic] CoverageAgent / Prioritizer…');
  try {
    const plan = coverageAgent(8);
    Logger.info(`[vuln-agentic:coverage] ${plan.reason}`);
    prioritizerAgent(25);
  } catch (err) {
    Logger.debug(
      `[vuln-agentic:coverage] skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  Logger.info('[vuln-agentic] ReproAgent starting…');
  try {
    const repro = await reproNovelCandidates({ limit: 25 });
    const confirmed = repro.filter((r) => r.success).length;
    if (confirmed) {
      Logger.info(`[vuln-agentic:repro] confirmed ${confirmed}/${repro.length}`);
    }
  } catch (err) {
    Logger.warn(
      `[vuln-agentic:repro] skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let validated = 0;
  if (!opts.skipValidate) {
    Logger.info('[vuln-agentic] Validator starting…');
    const v = validatorAgent();
    validated = v.validated;
    rejected += v.rejected;
    // Ensure analysis on newly validated
    for (const f of listFindings({ status: 'validated', minSeverity: 'HIGH' })) {
      try {
        await onFindingValidated(f.id);
      } catch {
        /* non-fatal */
      }
    }
  }

  let reports = 0;
  if (!opts.skipAnalyze) {
    Logger.info('[vuln-agentic] Reporter starting…');
    reports = await reporterAgent(minSev);
  }

  let blockProposals = 0;
  if (!opts.skipProposeBlock) {
    Logger.info('[vuln-agentic] BlockProposal starting…');
    blockProposals = await blockProposalAgent(opts.tenantId, opts.useLlmForBlock !== false);
  }

  const findingIds = listFindings().map((f) => f.id);
  Logger.info(
    `[vuln-agentic] done scout=${scout.findings.length} validated=${validated} rejected=${rejected} reports=${reports} blocks=${blockProposals}`,
  );

  auditProbe({
    action: 'agentic-run',
    target: `servers=${opts.servers.length}`,
    authorized: true,
    detail: JSON.stringify({
      scout: scout.findings.length,
      validated,
      rejected,
      reports,
      blockProposals,
    }),
  });

  return {
    scoutFindings: scout.findings.length,
    validated,
    rejected,
    reports,
    blockProposals,
    errors,
    findingIds,
  };
}

/** Single-finding validate + report + propose (dashboard validate hook helper). */
export async function agenticPromoteFinding(
  findingId: string,
  opts?: { tenantId?: string },
): Promise<{
  validated: boolean;
  reason: string;
  reportId?: string;
  candidateId?: string;
}> {
  const result = validateFinding(findingId, { llmConfirmation: true });
  if (!result) return { validated: false, reason: 'not found' };
  if (!result.promoted) return { validated: false, reason: result.reason };
  const report = await onFindingValidated(findingId);
  const block = await proposeBlockFromFinding(findingId, { tenantId: opts?.tenantId });
  return {
    validated: true,
    reason: result.reason,
    reportId: report?.id,
    candidateId: block.candidateId,
  };
}
