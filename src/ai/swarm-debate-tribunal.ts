/**
 * Swarm Debate Tribunal — multi-agent resolution for uncertain semantic audit records.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import { rankSemanticReviewQueue, type UncertaintyRankedRecord } from './semantic-active-learning.js';
import { getQuorumConfig } from './learning-quorum.js';
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';

export type DebatePersona = 'block_advocate' | 'allow_advocate' | 'auditor';

export type DebateArgument = {
  persona: DebatePersona;
  stance: 'block' | 'allow' | 'neutral';
  reasoning: string;
  confidence: number;
  citedFields: string[];
};

export type TribunalVerdict = {
  recommendedLabel: 'true_positive' | 'false_positive' | 'needs_review';
  unanimous: boolean;
  confidence: number;
  dissent?: string;
};

export type TribunalDebate = {
  recordId: string;
  toolName: string;
  serverName: string;
  uncertaintyScore: number;
  arguments: DebateArgument[];
  verdict: TribunalVerdict;
  transcript: string;
  generatedAt: string;
  autoLabelEligible: boolean;
};

const PERSONA_JSON_PROMPT = `Respond ONLY with JSON: {"stance":"block|allow|neutral","confidence":0.0-1.0,"reasoning":"...","citedFields":["field"]}`;

function parsePersonaJson(text: string, persona: DebatePersona): DebateArgument | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      stance?: string;
      confidence?: number;
      reasoning?: string;
      citedFields?: string[];
    };
    const stance =
      parsed.stance === 'block' ? 'block' : parsed.stance === 'allow' ? 'allow' : ('neutral' as const);
    return {
      persona,
      stance,
      reasoning: String(parsed.reasoning || '').slice(0, 500),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      citedFields: Array.isArray(parsed.citedFields) ? parsed.citedFields.map(String) : ['semanticAudit'],
    };
  } catch {
    return null;
  }
}

const PERSONA_PROMPTS: Record<DebatePersona, string> = {
  block_advocate:
    'You argue this MCP tool call should be BLOCKED. Cite semantic categories, sync decision, and confidence.',
  allow_advocate:
    'You argue this MCP tool call is BENIGN. Cite low confidence, missing attack indicators, or false-positive patterns.',
  auditor:
    'You synthesize both advocates. State recommended label (true_positive, false_positive, or needs_review) and dissent if any.',
};

export async function applyTribunalAutoLabels(
  debates: TribunalDebate[],
  opts?: { userId?: string; tenantId?: string },
): Promise<number> {
  if (process.env.MASTYF_AI_TRIBUNAL_AUTO_LABEL !== 'true') return 0;
  const { labelSemanticAuditRecord } = await import('./semantic-audit-store.js');
  let applied = 0;
  for (const d of debates) {
    if (!d.autoLabelEligible) continue;
    const label = d.verdict.recommendedLabel;
    if (label !== 'true_positive' && label !== 'false_positive') continue;
    const ok = await labelSemanticAuditRecord(d.recordId, label, opts?.userId || 'swarm-tribunal', opts?.tenantId);
    if (ok) applied += 1;
  }
  return applied;
}

function recordContext(rec: StoredSemanticAudit): string {
  return JSON.stringify(
    {
      id: rec.id,
      toolName: rec.toolName,
      serverName: rec.serverName,
      syncAction: rec.syncDecision?.action,
      syncRule: rec.syncDecision?.rule,
      suspicious: rec.semanticAudit?.suspicious,
      confidence: rec.semanticAudit?.confidence,
      categories: rec.semanticAudit?.categories,
      reasoning: rec.semanticAudit?.reasoning?.slice(0, 300),
      labeled: rec.labeled,
      label: rec.label,
    },
    null,
    2,
  );
}

function heuristicArgument(rec: StoredSemanticAudit, persona: DebatePersona): DebateArgument {
  const conf = rec.semanticAudit?.confidence ?? 0.5;
  const suspicious = rec.semanticAudit?.suspicious ?? false;
  const syncBlock = rec.syncDecision?.action === 'block';

  if (persona === 'block_advocate') {
    return {
      persona,
      stance: 'block',
      reasoning: suspicious
        ? `Semantic flag (${(conf * 100).toFixed(0)}%): ${rec.semanticAudit?.categories?.[0] || 'unknown'}`
        : `Sync block on rule ${rec.syncDecision?.rule}`,
      confidence: Math.max(conf, syncBlock ? 0.7 : 0.4),
      citedFields: ['semanticAudit.suspicious', 'syncDecision.action'],
    };
  }
  if (persona === 'allow_advocate') {
    return {
      persona,
      stance: 'allow',
      reasoning:
        conf < 0.65
          ? `Confidence ${conf.toFixed(2)} below strong threshold — likely benign workflow`
          : 'No sync block; semantic alone may be noisy for this tool',
      confidence: 1 - conf,
      citedFields: ['semanticAudit.confidence', 'toolName'],
    };
  }
  const blockScore = (suspicious ? conf : 0) + (syncBlock ? 0.3 : 0);
  const allowScore = 1 - conf;
  const recommendBlock = blockScore > allowScore + 0.15;
  return {
    persona,
    stance: 'neutral',
    reasoning: recommendBlock
      ? 'Block advocate stronger — recommend true_positive pending human confirm'
      : allowScore >= blockScore
        ? 'Allow advocate stronger — recommend false_positive or needs_review'
        : 'Split decision — needs_review',
    confidence: Math.abs(blockScore - allowScore),
    citedFields: ['semanticAudit', 'syncDecision'],
  };
}

function buildVerdict(args: DebateArgument[]): TribunalVerdict {
  const block = args.find((a) => a.persona === 'block_advocate')!;
  const allow = args.find((a) => a.persona === 'allow_advocate')!;
  const auditor = args.find((a) => a.persona === 'auditor')!;

  const blockWins = block.confidence > allow.confidence + 0.1;
  const allowWins = allow.confidence > block.confidence + 0.1;
  const unanimous = (blockWins && allow.confidence < 0.35) || (allowWins && block.confidence < 0.35);

  let recommendedLabel: TribunalVerdict['recommendedLabel'] = 'needs_review';
  if (/true_positive/i.test(auditor.reasoning) || (blockWins && block.confidence >= 0.75)) {
    recommendedLabel = 'true_positive';
  } else if (/false_positive/i.test(auditor.reasoning) || (allowWins && allow.confidence >= 0.65)) {
    recommendedLabel = 'false_positive';
  }

  const dissent =
    blockWins && allow.confidence >= 0.5
      ? `Allow advocate dissent (${Math.round(allow.confidence * 100)}%): ${allow.reasoning}`
      : allowWins && block.confidence >= 0.5
        ? `Block advocate dissent (${Math.round(block.confidence * 100)}%): ${block.reasoning}`
        : undefined;

  return {
    recommendedLabel,
    unanimous,
    confidence: Math.max(block.confidence, allow.confidence, auditor.confidence),
    dissent,
  };
}

export async function runTribunalDebate(
  rec: StoredSemanticAudit,
  opts?: { useLlm?: boolean },
): Promise<TribunalDebate> {
  const useLlm = opts?.useLlm ?? process.env.MASTYF_AI_TRIBUNAL_LLM !== 'false';
  const args: DebateArgument[] = [];
  const ctx = recordContext(rec);

  if (useLlm) {
    const llm = new LlmAssistant({ hotPath: false });
    if (llm.isAvailable()) {
      for (const persona of ['block_advocate', 'allow_advocate', 'auditor'] as DebatePersona[]) {
        const result = await llm.generate(`${PERSONA_PROMPTS[persona]}\n${PERSONA_JSON_PROMPT}`, ctx);
        if (result?.text) {
          const parsed = parsePersonaJson(result.text, persona);
          if (parsed) {
            args.push(parsed);
            continue;
          }
          const stance =
            persona === 'block_advocate' ? 'block' : persona === 'allow_advocate' ? 'allow' : 'neutral';
          args.push({
            persona,
            stance,
            reasoning: result.text.slice(0, 500),
            confidence: persona === 'auditor' ? 0.7 : 0.65,
            citedFields: ['semanticAudit', 'syncDecision'],
          });
        }
      }
    }
  }

  if (args.length < 3) {
    for (const persona of ['block_advocate', 'allow_advocate', 'auditor'] as DebatePersona[]) {
      args.push(heuristicArgument(rec, persona));
    }
  }

  const verdict = buildVerdict(args);
  const transcript = args
    .map((a) => `[${a.persona}] (${a.stance}, ${Math.round(a.confidence * 100)}%): ${a.reasoning}`)
    .join('\n\n');

  const cfg = getQuorumConfig();
  const autoLabelEligible = verdict.unanimous && verdict.confidence >= 0.8 && cfg.minTotalLabels >= 1;

  Logger.info(`[SwarmTribunal] Debate ${rec.id} → ${verdict.recommendedLabel} (unanimous=${verdict.unanimous})`);

  return {
    recordId: rec.id,
    toolName: rec.toolName,
    serverName: rec.serverName,
    uncertaintyScore: 0,
    arguments: args,
    verdict,
    transcript,
    generatedAt: new Date().toISOString(),
    autoLabelEligible,
  };
}

export const DEFAULT_TRIBUNAL_BATCH = 10;

export async function peekTribunalQueue(opts?: {
  tenantId?: string;
  limit?: number;
  uncertaintyMin?: number;
}): Promise<{
  batchLimit: number;
  eligibleTotal: number;
  nextBatchSize: number;
  remainingEligible: number;
  pendingTribunalCount: number;
}> {
  const { countPendingTribunalRecords } = await import('../utils/tribunal-sla.js');
  const pendingTribunalCount = await countPendingTribunalRecords();
  const { loadSemanticAuditRecordsAsync } = await import('./semantic-audit-store.js');
  const batchLimit = opts?.limit ?? DEFAULT_TRIBUNAL_BATCH;
  const records = await loadSemanticAuditRecordsAsync({
    tenantId: opts?.tenantId,
    sinceMs: 365 * 24 * 60 * 60 * 1000, // Load all records up to 1 year
    limit: 500,
  });
  const ranked = rankSemanticReviewQueue(records, { limit: 500 });
  const minScore = opts?.uncertaintyMin ?? 0.2;
  const eligible = ranked.filter((r) => r.uncertaintyScore >= minScore && !r.labeled);
  const nextBatchSize = Math.min(eligible.length, batchLimit);
  const remainingEligible = Math.max(0, eligible.length - nextBatchSize);
  return {
    batchLimit,
    eligibleTotal: eligible.length,
    nextBatchSize,
    remainingEligible,
    pendingTribunalCount,
  };
}

export async function runTribunalForQueue(opts?: {
  tenantId?: string;
  limit?: number;
  uncertaintyMin?: number;
  useLlm?: boolean;
}): Promise<{
  debates: TribunalDebate[];
  queueSize: number;
  batchLimit: number;
  eligibleTotal: number;
  remainingEligible: number;
}> {
  const { loadSemanticAuditRecordsAsync } = await import('./semantic-audit-store.js');
  const batchLimit = opts?.limit ?? DEFAULT_TRIBUNAL_BATCH;
  const records = await loadSemanticAuditRecordsAsync({
    tenantId: opts?.tenantId,
    sinceMs: 365 * 24 * 60 * 60 * 1000, // Load all records up to 1 year
    limit: 500,
  });
  const ranked = rankSemanticReviewQueue(records, { limit: 500 });
  const minScore = opts?.uncertaintyMin ?? 0.2;
  const eligible = ranked.filter((r) => r.uncertaintyScore >= minScore && !r.labeled);
  const batch = eligible.slice(0, batchLimit);

  const debates: TribunalDebate[] = [];
  for (const rec of batch) {
    const debate = await runTribunalDebate(rec, { useLlm: opts?.useLlm });
    debate.uncertaintyScore = rec.uncertaintyScore;
    debates.push(debate);
  }

  const eligibleTotal = eligible.length;
  const remainingEligible = Math.max(0, eligibleTotal - debates.length);

  return {
    debates,
    queueSize: batch.length,
    batchLimit,
    eligibleTotal,
    remainingEligible,
  };
}

export type TribunalReport = {
  generatedAt: string;
  queueSize: number;
  debatedCount: number;
  batchLimit: number;
  eligibleTotal: number;
  remainingEligible: number;
  debates: TribunalDebate[];
  quorumMet: boolean;
  autoLabelsApplied: number;
};

export async function buildTribunalReport(opts?: {
  tenantId?: string;
  limit?: number;
  useLlm?: boolean;
}): Promise<TribunalReport> {
  const { debates, queueSize, batchLimit, eligibleTotal, remainingEligible } =
    await runTribunalForQueue(opts);
  const cfg = getQuorumConfig();
  const autoLabelsApplied = await applyTribunalAutoLabels(debates, { tenantId: opts?.tenantId });
  const quorumMet = debates.some((d) => d.autoLabelEligible) || cfg.minTotalLabels <= 1;

  Logger.info(
    `[SwarmTribunal] Report: ${debates.length} debate(s), eligible=${eligibleTotal}, remaining=${remainingEligible}, autoLabels=${autoLabelsApplied}`,
  );

  return {
    generatedAt: new Date().toISOString(),
    queueSize,
    debatedCount: debates.length,
    batchLimit,
    eligibleTotal,
    remainingEligible,
    debates,
    quorumMet,
    autoLabelsApplied,
  };
}
