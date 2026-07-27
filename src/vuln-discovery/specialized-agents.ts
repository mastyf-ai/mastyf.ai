/**
 * Thin specialized agents on top of the effect-proven harness.
 * Enabled only when MASTYF_AI_VULN_AGENTIC=true — no auto-CVE, no auto-apply.
 */
import { Logger } from '../utils/logger.js';
import { listFindings } from './store.js';
import { getLiveTrafficStats } from './live-traffic-stats.js';
import { generateFuzzPayloads, findingFromFuzzResult, type ToolDef } from './mcp-tool-fuzzer.js';
import { hasProvenExploitEffect, isMaliciousArgs, isSoftDenyText, stringifyResult } from './effect-classifier.js';
import type { McpFuzzTransport } from './mcp-fuzz-runner.js';
import type { VulnFinding } from './types.js';

export interface CoveragePlan {
  serverToolKeys: string[];
  reason: string;
}

/** Rank tools for next fuzz batch from live traffic hotness. */
export function coverageAgent(limit = 8): CoveragePlan {
  const hot = getLiveTrafficStats()
    .filter((s) => s.maliciousShapedCount > 0 || s.allowCount > 0)
    .slice(0, limit);
  return {
    serverToolKeys: hot.map((h) => h.key),
    reason: hot.length
      ? `prioritize ${hot.length} hot tools from live traffic`
      : 'no live traffic stats yet — default tools/list order',
  };
}

export interface DifferentialResult {
  findingId?: string;
  promote: boolean;
  detail: string;
}

/**
 * Compare benign vs malicious twin call; promote only when malicious shows
 * exploit effect and benign does not.
 */
export async function differentialAgent(opts: {
  serverName: string;
  tool: ToolDef;
  transport: McpFuzzTransport;
  maliciousArgs: Record<string, unknown>;
  benignArgs: Record<string, unknown>;
}): Promise<DifferentialResult> {
  if (!isMaliciousArgs(opts.maliciousArgs)) {
    return { promote: false, detail: 'args not malicious-shaped' };
  }
  const benign = await opts.transport.callTool(opts.tool.name, opts.benignArgs);
  const mal = await opts.transport.callTool(opts.tool.name, opts.maliciousArgs);
  const malText = stringifyResult(mal.result) || mal.error || '';
  const benignText = stringifyResult(benign.result) || '';

  if (mal.blockedByProxy) {
    return { promote: false, detail: 'malicious blocked by proxy (correct)' };
  }
  if (isSoftDenyText(malText)) {
    return { promote: false, detail: 'malicious soft-deny (correct)' };
  }
  const malEffect = hasProvenExploitEffect({
    args: opts.maliciousArgs,
    result: mal.result,
    responseText: malText,
    crashed: mal.crashed,
    upstreamError: mal.error,
  });
  const benignEffect = hasProvenExploitEffect({
    args: opts.benignArgs,
    result: benign.result,
    responseText: benignText,
  });
  if (!malEffect || benignEffect) {
    return { promote: false, detail: 'no differential exploit effect' };
  }
  const finding = findingFromFuzzResult(opts.serverName, {
    toolName: opts.tool.name,
    args: opts.maliciousArgs,
    ok: !!mal.ok,
    blockedByProxy: !!mal.blockedByProxy,
    crashed: mal.crashed,
    upstreamError: mal.error,
    durationMs: 0,
    responseExcerpt: malText.slice(0, 400),
  });
  return {
    promote: !!finding,
    findingId: finding?.id,
    detail: finding ? 'differential exploit confirmed' : 'classifier declined',
  };
}

/** Rank novel candidates for Repro/LLM spend (HIGH+ first, then by scanner priority). */
export function prioritizerAgent(limit = 20): VulnFinding[] {
  const order = ['live-traffic-tap', 'mcp-tool-fuzzer', 'response-injection-scanner'];
  const candidates = listFindings({ status: 'candidate', minSeverity: 'HIGH' }).filter(
    (f) =>
      f.evidence.scanner === 'live-traffic-tap'
      || f.evidence.scanner === 'mcp-tool-fuzzer'
      || f.evidence.scanner === 'response-injection-scanner'
      || f.class === 'implementation'
      || f.class === 'injection',
  );
  candidates.sort((a, b) => {
    const ai = order.indexOf(a.evidence.scanner);
    const bi = order.indexOf(b.evidence.scanner);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const out = candidates.slice(0, limit);
  Logger.info(`[vuln-agentic:prioritizer] ranked ${out.length} candidates for repro/LLM`);
  return out;
}

/** Sample benign defaults from schema for differential. */
export function benignArgsFromTool(tool: ToolDef): Record<string, unknown> {
  const payloads = generateFuzzPayloads(tool.inputSchema, 'shallow');
  return payloads[0] || {};
}
