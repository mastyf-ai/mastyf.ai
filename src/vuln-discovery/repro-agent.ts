/**
 * ReproAgent — confirm novel-runtime findings need live exploit effect
 * (and optionally re-call via injected transport).
 */
import { Logger } from '../utils/logger.js';
import { getFinding, updateFindingStatus, listFindings } from './store.js';
import { validateFinding, type ValidationResult } from './validate.js';
import {
  EXPLOIT_EFFECT_DECISION,
  EXPLOIT_EFFECT_RULE,
  hasProvenExploitEffect,
  isSoftDenyText,
  stringifyResult,
  classifyExploitEffect,
} from './effect-classifier.js';
import type { VulnFinding } from './types.js';
import type { McpFuzzTransport } from './mcp-fuzz-runner.js';

export interface ReproResult {
  findingId: string;
  success: boolean;
  detail: string;
  validation?: ValidationResult;
}

function evidenceHasExploitEffect(finding: VulnFinding): boolean {
  if (finding.evidence.rule === EXPLOIT_EFFECT_RULE) return true;
  if (finding.evidence.proxyDecision === EXPLOIT_EFFECT_DECISION) return true;
  if (finding.evidence.scanner === 'response-injection-scanner') {
    const text = stringifyResult(finding.evidence.response);
    return hasProvenExploitEffect({
      responseText: text,
      result: finding.evidence.response,
    });
  }
  const text = stringifyResult(finding.evidence.response);
  const args = (finding.evidence.payloads?.[0] as Record<string, unknown> | undefined) || {};
  return hasProvenExploitEffect({
    args,
    responseText: text,
    result: finding.evidence.response,
    crashed: finding.class === 'protocol' && !!finding.evidence.stackTrace,
    upstreamError: finding.evidence.stackTrace,
  });
}

/**
 * Confirm a single finding. If transport provided, re-call tool with stored payload.
 */
export async function reproFinding(
  findingId: string,
  opts?: { transport?: McpFuzzTransport; toolName?: string },
): Promise<ReproResult> {
  const finding = getFinding(findingId);
  if (!finding) {
    return { findingId, success: false, detail: 'finding not found' };
  }

  if (opts?.transport && finding.evidence.payloads?.[0]) {
    const args = finding.evidence.payloads[0] as Record<string, unknown>;
    const toolName =
      opts.toolName
      || finding.target.name.split(':').slice(1).join(':')
      || finding.target.name;
    try {
      const call = await opts.transport.callTool(toolName, args);
      const responseText = stringifyResult(call.result) || call.error || '';
      if (call.blockedByProxy) {
        return { findingId, success: false, detail: 'repro blocked by proxy' };
      }
      if (isSoftDenyText(responseText) || !call.ok) {
        return { findingId, success: false, detail: 'repro soft-deny or not ok' };
      }
      const effect = classifyExploitEffect({
        args,
        result: call.result,
        responseText,
        crashed: call.crashed,
        upstreamError: call.error,
      });
      if (!hasProvenExploitEffect({
        args,
        result: call.result,
        responseText,
        crashed: call.crashed,
        upstreamError: call.error,
      })) {
        return { findingId, success: false, detail: `repro no effect: ${effect.reason}` };
      }
      // Stamp exploit-effect on finding for validate
      updateFindingStatus(findingId, finding.status, {
        evidence: {
          ...finding.evidence,
          rule: EXPLOIT_EFFECT_RULE,
          proxyDecision: EXPLOIT_EFFECT_DECISION,
          response: responseText.slice(0, 2000),
          reproSteps: [
            ...finding.evidence.reproSteps,
            `ReproAgent re-call ${toolName} confirmed effect=${effect.kind}`,
          ],
        },
      });
      const validation = validateFinding(findingId, {
        reproSuccess: true,
        scannerAgreement: true,
      });
      return {
        findingId,
        success: true,
        detail: `live repro confirmed: ${effect.reason}`,
        validation,
      };
    } catch (err) {
      return {
        findingId,
        success: false,
        detail: `repro error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Evidence-only confirmation (no transport)
  if (evidenceHasExploitEffect(finding)) {
    const validation = validateFinding(findingId, {
      reproSuccess: true,
      scannerAgreement: true,
    });
    return {
      findingId,
      success: !!validation?.promoted || evidenceHasExploitEffect(finding),
      detail: 'evidence already has exploit effect',
      validation,
    };
  }

  if (isSoftDenyText(stringifyResult(finding.evidence.response))) {
    return { findingId, success: false, detail: 'evidence is soft-deny' };
  }

  return { findingId, success: false, detail: 'no proven exploit effect in evidence' };
}

/** Run ReproAgent over HIGH+ novel-runtime candidates. */
export async function reproNovelCandidates(opts?: {
  transport?: McpFuzzTransport;
  limit?: number;
}): Promise<ReproResult[]> {
  const limit = opts?.limit ?? 20;
  const candidates = listFindings({ status: 'candidate', minSeverity: 'HIGH' })
    .filter((f) =>
      f.evidence.scanner === 'mcp-tool-fuzzer'
      || f.evidence.scanner === 'live-traffic-tap'
      || f.evidence.scanner === 'response-injection-scanner'
      || f.class === 'implementation'
      || f.class === 'injection'
      || f.class === 'protocol'
    )
    .slice(0, limit);

  const results: ReproResult[] = [];
  for (const f of candidates) {
    const r = await reproFinding(f.id, { transport: opts?.transport });
    results.push(r);
    Logger.info(`[repro-agent] ${f.id}: success=${r.success} ${r.detail}`);
  }
  return results;
}
