/**
 * Live traffic tap — emit novel/runtime candidates from allowed MCP tool calls
 * when malicious args produce a proven exploit effect (not soft-deny).
 *
 * Opt-in: MASTYF_AI_VULN_LIVE_TAP=true (also requires VDE enabled or FORCE).
 */
import { Logger } from '../utils/logger.js';
import { isVulnDiscoveryEnabled, auditProbe, checkProbeRateLimit } from './auth.js';
import {
  createFindingId,
  fingerprintFinding,
  getFinding,
  upsertFinding,
} from './store.js';
import {
  EXPLOIT_EFFECT_DECISION,
  EXPLOIT_EFFECT_RULE,
  hasProvenExploitEffect,
  isMaliciousArgs,
  stringifyResult,
  classifyExploitEffect,
} from './effect-classifier.js';
import {
  recordLiveAllow,
  recordMaliciousShaped,
  recordSoftDenySeen,
} from './live-traffic-stats.js';
import { recordPrecisionEvent } from './precision-metrics.js';
import type { VulnFinding } from './types.js';

export function isLiveTrafficTapEnabled(): boolean {
  if (process.env.MASTYF_AI_VULN_LIVE_TAP === 'false') return false;
  if (process.env.MASTYF_AI_VULN_LIVE_TAP === 'true') return true;
  // Default off — opt-in only (privacy + noise)
  return false;
}

export interface LiveTapInput {
  serverName: string;
  toolName: string;
  args?: Record<string, unknown>;
  result: unknown;
  /** Always false for allowed (post-proxy) traffic. */
  blockedByProxy?: boolean;
  durationMs?: number;
  tenantId?: string;
}

/**
 * Inspect an allowed tools/call. Returns finding if malicious args + exploit effect.
 */
export function tapAllowedToolCall(input: LiveTapInput): VulnFinding | null {
  if (!isLiveTrafficTapEnabled()) return null;
  if (!isVulnDiscoveryEnabled() && process.env.MASTYF_AI_VULN_DISCOVERY_FORCE !== 'true') {
    return null;
  }
  if (input.blockedByProxy) return null;

  const args = input.args && typeof input.args === 'object' ? input.args : {};
  recordLiveAllow(input.serverName, input.toolName);

  if (!isMaliciousArgs(args)) return null;
  recordMaliciousShaped(input.serverName, input.toolName);

  const responseText = stringifyResult(input.result);
  const effect = classifyExploitEffect({
    args,
    result: input.result,
    responseText,
  });
  if (!hasProvenExploitEffect({ args, result: input.result, responseText })) {
    if (effect.kind === 'soft_deny') {
      recordSoftDenySeen(input.serverName, input.toolName);
      recordPrecisionEvent('live-traffic-tap', 'soft_deny_skip');
    }
    Logger.debug(
      `[live-tap] skip ${input.serverName}/${input.toolName}: ${effect.reason}`,
    );
    return null;
  }

  const rate = checkProbeRateLimit();
  if (!rate.ok) return null;

  auditProbe({
    action: 'live-traffic-tap',
    target: `${input.serverName}:${input.toolName}`,
    authorized: true,
    detail: effect.reason,
  });

  const partial: Omit<VulnFinding, 'id' | 'discoveredAt' | 'fingerprint'> = {
    class: 'implementation',
    severity: effect.kind === 'secret_or_injection' ? 'CRITICAL' : 'HIGH',
    status: 'candidate',
    title: `Live allow: malicious ${input.toolName} produced exploit effect on ${input.serverName}`,
    description:
      `Incoming traffic allowed malicious args and upstream returned exploit effect (${effect.reason}). `
      + 'Not a package advisory — runtime novel candidate.',
    target: { kind: 'tool_handler', name: `${input.serverName}:${input.toolName}` },
    evidence: {
      scanner: 'live-traffic-tap',
      rule: EXPLOIT_EFFECT_RULE,
      proxyDecision: EXPLOIT_EFFECT_DECISION,
      reproSteps: [
        `Observed tools/call ${input.toolName} allowed by proxy`,
        `Malicious args present; effect=${effect.kind} (${effect.reason})`,
        `Response excerpt: ${responseText.slice(0, 240)}`,
      ],
      payloads: [args],
      response: responseText.slice(0, 2000),
      request: { toolName: input.toolName, durationMs: input.durationMs },
    },
    exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
    tenantId: input.tenantId,
  };

  const fp = fingerprintFinding({
    class: partial.class,
    target: partial.target,
    title: partial.title,
    evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
  });
  const id = createFindingId(fp);
  const existing = getFinding(id);
  const saved = upsertFinding({
    ...partial,
    id,
    fingerprint: fp,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    status: existing?.status === 'validated' ? existing.status : partial.status,
    validatedAt: existing?.validatedAt,
    analysisReportId: existing?.analysisReportId,
  });
  recordPrecisionEvent('live-traffic-tap', 'finding_emit');
  return saved;
}
