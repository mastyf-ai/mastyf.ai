/**
 * Propose a human-gated block rule from a VulnFinding via Threat Lab discovery.
 */
import { createHash } from 'node:crypto';
import { discoverFromVulnFinding } from '../ai/threat-lab.js';
import { upsertThreatLabCandidate, type ThreatLabCandidateRecord } from '../utils/swarm-artifacts.js';
import { getFinding } from './store.js';
import { loadReport } from './vuln-analyst.js';
import type { VulnFinding } from './types.js';

export interface ProposeBlockResult {
  ok: boolean;
  reason?: string;
  candidateId?: string;
  fingerprint?: string;
  candidate?: ThreatLabCandidateRecord;
}

function findingToDiscoveryInput(finding: VulnFinding) {
  const report = loadReport(finding.id);
  return {
    id: finding.id,
    class: finding.class,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    target: finding.target,
    evidence: {
      reproSteps: finding.evidence.reproSteps,
      scanner: finding.evidence.scanner,
    },
    analysisExecutiveSummary: report?.sections?.executiveSummary,
    exploitScenario: report?.sections?.exploitScenario,
  };
}

/** Create / upsert a pending Threat Lab candidate for operator Accept (applies YAML). */
export async function proposeBlockFromFinding(
  findingId: string,
  opts?: { tenantId?: string; llm?: boolean },
): Promise<ProposeBlockResult> {
  const finding = getFinding(findingId);
  if (!finding) return { ok: false, reason: 'Finding not found' };
  if (finding.status === 'rejected') {
    return { ok: false, reason: 'Finding is rejected' };
  }

  let discovery = null as Awaited<ReturnType<typeof discoverFromVulnFinding>>;
  if (opts?.llm !== false) {
    discovery = await discoverFromVulnFinding(findingToDiscoveryInput(finding));
  }

  const toolName = finding.target.name.includes(':')
    ? finding.target.name.split(':').pop()!
    : finding.target.name;
  const fingerprint =
    finding.fingerprint
    || createHash('sha256').update(`vuln-block:${finding.id}`).digest('hex').slice(0, 24);
  const candidateId = `vuln-block-${finding.id}`;

  const policyRule =
    (discovery?.policyRule as Record<string, unknown> | undefined)
    || {
      name: `vuln-block-${finding.id.slice(0, 12)}`,
      description: `Human-gated block proposed from VulnFinding ${finding.id}: ${finding.title}`,
      action: 'block',
      tools: { deny: [toolName] },
      match: {
        toolName,
        argsContains: finding.evidence.reproSteps[0]?.slice(0, 80) || finding.title.slice(0, 80),
      },
    };

  const candidate: ThreatLabCandidateRecord = {
    id: candidateId,
    fingerprint,
    attackClass: finding.class,
    hypothesis: discovery?.hypothesis || finding.description.slice(0, 400),
    confidence: discovery?.confidence ?? (finding.severity === 'CRITICAL' || finding.severity === 'HIGH' ? 0.85 : 0.65),
    toolName,
    category: finding.class,
    reviewStatus: 'pending',
    policyRule,
    corpusCandidate: discovery?.corpusCandidate as Record<string, unknown> | undefined,
    provenance: {
      source: 'vuln-discovery',
      llmUsed: !!discovery,
      inputFingerprint: finding.id,
    },
  };

  const saved = upsertThreatLabCandidate(opts?.tenantId, candidate);
  return {
    ok: true,
    candidateId: saved.id,
    fingerprint: saved.fingerprint,
    candidate: saved,
  };
}
