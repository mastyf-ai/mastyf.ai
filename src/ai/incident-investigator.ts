/**
 * Agentic Incident Investigator — multi-step analysis with cited audit records and Threat Lab bridge.
 */
import {
  findSemanticAuditRecord,
  loadSemanticAuditRecordsWithTenantFallback,
  SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS,
  type StoredSemanticAudit,
} from './semantic-audit-store.js';
import { getFlowHistory, type FlowEvent } from '../policy/session-flow-store.js';
import { flowSessionKey } from '../policy/session-flow-guard.js';
import type { CallContext } from '../policy/policy-types.js';
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';
import {
  buildAgentIntentGraph,
  buildKillChainNarrative,
  type AgentIntentGraph,
} from './agent-intent-graph.js';

export type IncidentCitation = {
  id: string;
  kind: 'semantic_audit' | 'flow_event' | 'related_call';
  summary: string;
  timestamp?: string;
};

export type IncidentHypothesis = {
  attackClass: string;
  confidence: number;
  reasoning: string;
  citations: string[];
};

export type IncidentRecommendation = {
  action: 'review_policy' | 'open_threat_lab' | 'label_semantic' | 'quarantine_session';
  detail: string;
  threatLabContext?: {
    toolName: string;
    category: string;
    semanticAuditId: string;
  };
};

export type IncidentInvestigation = {
  incidentId: string;
  triggerId: string;
  triggerType: 'semantic_flag' | 'repeat_block' | 'swarm_bypass';
  generatedAt: string;
  citations: IncidentCitation[];
  sessionFlow: FlowEvent[];
  relatedRecords: StoredSemanticAudit[];
  hypotheses: IncidentHypothesis[];
  recommendations: IncidentRecommendation[];
  narrative?: string;
  killChainNarrative?: string;
  intentGraph?: AgentIntentGraph;
  threatLabReady: boolean;
};

function inferAttackClass(rec: StoredSemanticAudit): string {
  const cats = rec.semanticAudit?.categories || [];
  if (cats.length && cats[0] !== 'none') return cats[0];
  const rule = rec.syncDecision?.rule || '';
  if (/chain|exfil|flow/i.test(rule)) return 'cross-tool-chain';
  if (/path|traversal/i.test(rule)) return 'path-traversal';
  if (/semantic|prompt|injection/i.test(rule)) return 'prompt-injection';
  return 'suspicious-activity';
}

function buildSessionKey(rec: StoredSemanticAudit): string {
  const ctx = {
    tenantId: rec.tenantId,
    serverName: rec.serverName,
    agentIdentity: { sub: rec.labelUserId || 'anon' },
  } as CallContext;
  return flowSessionKey(ctx);
}

function findRelatedRecords(
  anchor: StoredSemanticAudit,
  all: StoredSemanticAudit[],
  windowMs = 30 * 60 * 1000,
): StoredSemanticAudit[] {
  const anchorTs = new Date(anchor.timestamp).getTime();
  return all.filter((r) => {
    if (r.id === anchor.id) return false;
    if (r.serverName !== anchor.serverName) return false;
    const ts = new Date(r.timestamp).getTime();
    return Math.abs(ts - anchorTs) <= windowMs;
  });
}

function buildHypotheses(
  anchor: StoredSemanticAudit,
  related: StoredSemanticAudit[],
  flow: FlowEvent[],
): IncidentHypothesis[] {
  const hypotheses: IncidentHypothesis[] = [];
  const attackClass = inferAttackClass(anchor);

  hypotheses.push({
    attackClass,
    confidence: anchor.semanticAudit?.confidence ?? 0.7,
    reasoning: anchor.semanticAudit?.reasoning || anchor.syncDecision?.reason || 'Semantic flag on tool call',
    citations: [anchor.id],
  });

  const exfilChain = flow.some((e) => e.sensitiveRead) && flow.length >= 2;
  if (exfilChain) {
    hypotheses.push({
      attackClass: 'cross-tool-chain',
      confidence: 0.82,
      reasoning: 'Session flow shows sensitive read followed by additional tool calls — possible staged exfil',
      citations: [anchor.id, 'flow:chain'],
    });
  }

  const repeatBlocks = related.filter(
    (r) => r.syncDecision?.action === 'block' || r.semanticAudit?.suspicious,
  );
  if (repeatBlocks.length >= 2) {
    hypotheses.push({
      attackClass: 'repeat-block-cluster',
      confidence: 0.75,
      reasoning: `${repeatBlocks.length + 1} related flags within 30 minutes on ${anchor.serverName}`,
      citations: [anchor.id, ...repeatBlocks.slice(0, 3).map((r) => r.id)],
    });
  }

  return hypotheses.slice(0, 3);
}

function buildRecommendations(
  anchor: StoredSemanticAudit,
  hypotheses: IncidentHypothesis[],
): IncidentRecommendation[] {
  const recs: IncidentRecommendation[] = [];
  const primary = hypotheses[0];

  if (!anchor.labeled) {
    recs.push({
      action: 'label_semantic',
      detail: `Label semantic audit ${anchor.id} as true/false positive`,
    });
  }

  recs.push({
    action: 'open_threat_lab',
    detail: 'Open Threat Lab workbench with pre-loaded context',
    threatLabContext: {
      toolName: anchor.toolName,
      category: primary?.attackClass || 'suspicious-activity',
      semanticAuditId: anchor.id,
    },
  });

  if (primary?.attackClass === 'cross-tool-chain') {
    recs.push({
      action: 'review_policy',
      detail: 'Review session-flow-exfil-chain and cross-tool guard rules',
    });
  }

  if (anchor.semanticAudit?.confidence && anchor.semanticAudit.confidence >= 0.9) {
    recs.push({
      action: 'quarantine_session',
      detail: 'High-confidence flag — consider rate-limiting or blocking client session',
    });
  }

  return recs;
}

function incidentLookupWindowMs(): number {
  const raw = parseInt(process.env.GUARDIAN_INCIDENT_LOOKUP_WINDOW_MS || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return SEMANTIC_AUDIT_DASHBOARD_WINDOW_MS;
}

function mapCandidateTriggerType(
  source?: string,
): IncidentInvestigation['triggerType'] {
  if (source === 'semantic-tp') return 'semantic_flag';
  if (source === 'bypass' || source === 'corpus-proactive') return 'swarm_bypass';
  return 'swarm_bypass';
}

function buildInvestigationFromThreatLabCandidate(
  candidate: import('../utils/swarm-artifacts.js').ThreatLabCandidateRecord,
  triggerId: string,
): IncidentInvestigation {
  const toolName = String(
    (candidate.corpusCandidate as { toolName?: string } | undefined)?.toolName || 'unknown',
  );
  const ruleName = (candidate.policyRule as { name?: string } | undefined)?.name;
  const citations: IncidentCitation[] = [
    {
      id: candidate.id,
      kind: 'related_call',
      summary: `${toolName} — Threat Lab ${candidate.provenance?.source || 'candidate'} (${candidate.attackClass})`,
    },
  ];
  if (candidate.provenance?.inputFingerprint) {
    citations.push({
      id: candidate.provenance.inputFingerprint,
      kind: 'related_call',
      summary: `Source signal: ${candidate.provenance.inputFingerprint}`,
    });
  }
  const hypotheses: IncidentHypothesis[] = [
    {
      attackClass: candidate.attackClass,
      confidence: candidate.confidence,
      reasoning: candidate.hypothesis,
      citations: [candidate.id],
    },
  ];
  const recommendations: IncidentRecommendation[] = [
    {
      action: 'open_threat_lab',
      detail: 'Review and accept or reject this Threat Lab candidate',
      threatLabContext: {
        toolName,
        category: candidate.attackClass,
        semanticAuditId: candidate.provenance?.inputFingerprint || candidate.id,
      },
    },
  ];
  if (ruleName) {
    recommendations.push({
      action: 'review_policy',
      detail: `Review proposed rule: ${ruleName}`,
    });
  }
  const narrative = `${candidate.hypothesis} [${candidate.id}]`;
  return {
    incidentId: `inc-${Date.now()}`,
    triggerId,
    triggerType: mapCandidateTriggerType(candidate.provenance?.source),
    generatedAt: new Date().toISOString(),
    citations,
    sessionFlow: [],
    relatedRecords: [],
    hypotheses,
    recommendations,
    narrative,
    killChainNarrative: narrative,
    threatLabReady: true,
  };
}

async function resolveSemanticAnchor(
  triggerId: string,
  records: StoredSemanticAudit[],
  tenantId?: string,
): Promise<StoredSemanticAudit | undefined> {
  const direct = findSemanticAuditRecord(records, triggerId);
  if (direct) return direct;

  try {
    const { findThreatLabCandidateUngated } = await import('../utils/swarm-artifacts.js');
    const candidate = findThreatLabCandidateUngated(tenantId, triggerId);
    const fp = candidate?.provenance?.inputFingerprint;
    if (fp && (candidate.provenance?.source === 'semantic-tp' || /^\d{10,}-/.test(fp))) {
      return findSemanticAuditRecord(records, fp);
    }
  } catch {
    /* non-fatal */
  }

  return undefined;
}

export async function investigateIncident(opts: {
  triggerId: string;
  triggerType?: IncidentInvestigation['triggerType'];
  tenantId?: string;
  useLlm?: boolean;
}): Promise<IncidentInvestigation | null> {
  const { records } = await loadSemanticAuditRecordsWithTenantFallback({
    tenantId: opts.tenantId,
    sinceMs: incidentLookupWindowMs(),
    limit: 500,
  });

  const { findThreatLabCandidateUngated } = await import('../utils/swarm-artifacts.js');
  const threatLabCandidate = findThreatLabCandidateUngated(opts.tenantId, opts.triggerId);
  const anchor = await resolveSemanticAnchor(opts.triggerId, records, opts.tenantId);
  if (!anchor && threatLabCandidate) {
    Logger.info(
      `[IncidentInvestigator] Threat Lab candidate investigation ${opts.triggerId} (${threatLabCandidate.provenance?.source || 'unknown'})`,
    );
    return buildInvestigationFromThreatLabCandidate(threatLabCandidate, opts.triggerId);
  }
  if (!anchor) return null;

  const related = findRelatedRecords(anchor, records);
  const sessionKey = buildSessionKey(anchor);
  const flow = await getFlowHistory(sessionKey);

  const citations: IncidentCitation[] = [
    {
      id: anchor.id,
      kind: 'semantic_audit',
      summary: `${anchor.toolName} on ${anchor.serverName} — ${anchor.syncDecision?.action || 'unknown'}`,
      timestamp: anchor.timestamp,
    },
  ];

  for (const r of related.slice(0, 5)) {
    citations.push({
      id: r.id,
      kind: 'related_call',
      summary: `${r.toolName} — ${r.syncDecision?.action || 'pass'} (${r.semanticAudit?.suspicious ? 'semantic flag' : 'sync only'})`,
      timestamp: r.timestamp,
    });
  }

  for (let i = 0; i < flow.length; i++) {
    citations.push({
      id: `flow:${i}`,
      kind: 'flow_event',
      summary: `${flow[i].toolName}${flow[i].sensitiveRead ? ' (sensitive read)' : ''}`,
    });
  }

  const hypotheses = buildHypotheses(anchor, related, flow);
  const recommendations = buildRecommendations(anchor, hypotheses);
  const intentGraph = buildAgentIntentGraph(sessionKey, flow);
  const killChainNarrative = buildKillChainNarrative(intentGraph, anchor.toolName, citations);

  let narrative: string | undefined;
  const useLlm = opts.useLlm ?? process.env.GUARDIAN_INCIDENT_LLM !== 'false';
  if (useLlm) {
    const llm = new LlmAssistant({ hotPath: false });
    if (llm.isAvailable()) {
      const citeList = citations.map((c) => `[${c.id}] ${c.summary}`).join('\n');
      const prompt = `Summarize this MCP security incident in 2-3 sentences. Cite record IDs in brackets.\n\nPrimary: ${anchor.toolName} on ${anchor.serverName}\nHypothesis: ${hypotheses[0]?.attackClass}\n\nCitations:\n${citeList}`;
      const result = await llm.generate(
        'You are an MCP security analyst. Be concise. Only cite provided record IDs.',
        prompt,
      );
      if (result?.text) {
        const citedIds = citations.map((c) => c.id);
        const hasValidCite = citedIds.some((id) => result.text.includes(`[${id}]`) || result.text.includes(id));
        narrative = hasValidCite ? result.text : `${result.text} [${anchor.id}]`;
      }
    }
  }

  if (!narrative) {
    narrative = killChainNarrative;
  }

  Logger.info(`[IncidentInvestigator] Investigated ${opts.triggerId} — ${hypotheses.length} hypothesis(es)`);

  return {
    incidentId: `inc-${Date.now()}`,
    triggerId: opts.triggerId,
    triggerType: opts.triggerType || 'semantic_flag',
    generatedAt: new Date().toISOString(),
    citations,
    sessionFlow: flow,
    relatedRecords: related.slice(0, 10),
    hypotheses,
    recommendations,
    narrative,
    killChainNarrative,
    intentGraph,
    threatLabReady: true,
  };
}
