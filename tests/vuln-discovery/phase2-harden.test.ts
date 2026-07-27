import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findingFromFuzzResult,
} from '../../src/vuln-discovery/mcp-tool-fuzzer.js';
import {
  sortToolsByLiveHotness,
  recordMaliciousShaped,
  recordLiveAllow,
  resetLiveTrafficStatsForTests,
  getLiveTrafficStats,
} from '../../src/vuln-discovery/live-traffic-stats.js';
import {
  novelPrecisionSummary,
  resetPrecisionMetricsForTests,
  getPrecisionMetrics,
} from '../../src/vuln-discovery/precision-metrics.js';
import {
  coverageAgent,
  prioritizerAgent,
  differentialAgent,
} from '../../src/vuln-discovery/specialized-agents.js';
import type { McpFuzzTransport } from '../../src/vuln-discovery/mcp-fuzz-runner.js';
import {
  upsertFinding,
  createFindingId,
  fingerprintFinding,
} from '../../src/vuln-discovery/store.js';

describe('phase2 coverage + precision + proxy-block', () => {
  let dir: string;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phase2-'));
    for (const k of ['MASTYF_AI_HOME', 'MASTYF_AI_VULN_STORE_DIR', 'MASTYF_AI_VULN_DISCOVERY_FORCE']) {
      prev[k] = process.env[k];
    }
    process.env.MASTYF_AI_HOME = dir;
    process.env.MASTYF_AI_VULN_STORE_DIR = join(dir, 'store');
    process.env.MASTYF_AI_VULN_DISCOVERY_FORCE = 'true';
    resetLiveTrafficStatsForTests();
    resetPrecisionMetricsForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('sorts tools by live hotness', () => {
    recordLiveAllow('fs', 'cold_tool');
    recordMaliciousShaped('fs', 'read_file');
    recordMaliciousShaped('fs', 'read_file');
    const sorted = sortToolsByLiveHotness('fs', [
      { name: 'cold_tool' },
      { name: 'read_file' },
      { name: 'unknown' },
    ]);
    expect(sorted[0].name).toBe('read_file');
    expect(getLiveTrafficStats()[0].toolName).toBe('read_file');
  });

  it('records soft_deny_skip precision for soft-deny fuzz', () => {
    const f = findingFromFuzzResult('fs', {
      toolName: 'read_file',
      args: { path: '../../../etc/passwd' },
      ok: true,
      blockedByProxy: false,
      durationMs: 1,
      responseExcerpt: 'Access denied - path outside allowed',
    });
    expect(f).toBeNull();
    const m = novelPrecisionSummary();
    expect(m.softDenySkip).toBeGreaterThan(0);
  });

  it('does not emit finding when proxy blocked', () => {
    const f = findingFromFuzzResult('fs', {
      toolName: 'read_file',
      args: { path: '../../../etc/passwd' },
      ok: false,
      blockedByProxy: true,
      durationMs: 1,
      responseExcerpt: 'Blocked by Mastyf AI',
      upstreamError: 'Blocked by Mastyf AI',
    });
    expect(f).toBeNull();
  });

  it('coverageAgent returns hot keys', () => {
    recordMaliciousShaped('svc', 'search');
    const plan = coverageAgent(5);
    expect(plan.serverToolKeys.some((k) => k.includes('search'))).toBe(true);
  });

  it('differentialAgent promotes only on malicious effect delta', async () => {
    const transport: McpFuzzTransport = {
      async listTools() {
        return [];
      },
      async callTool(_name, args) {
        const path = String((args as { path?: string }).path || '');
        if (path.includes('..')) {
          return {
            ok: true,
            blockedByProxy: false,
            result: { content: [{ type: 'text', text: 'root:x:0:0:root:/root:/bin/bash' }] },
          };
        }
        return { ok: true, blockedByProxy: false, result: { content: [{ type: 'text', text: 'ok' }] } };
      },
    };
    const r = await differentialAgent({
      serverName: 'fs',
      tool: { name: 'read_file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
      transport,
      maliciousArgs: { path: '../../../etc/passwd' },
      benignArgs: { path: 'sample.txt' },
    });
    expect(r.promote).toBe(true);
    expect(getPrecisionMetrics().some((b) => b.findingEmit > 0 || b.scanner === 'mcp-tool-fuzzer')).toBe(true);
  });

  it('prioritizerAgent ranks novel candidates', () => {
    const fp = fingerprintFinding({
      class: 'implementation',
      target: { kind: 'tool_handler', name: 'fs:x' },
      title: 't',
      evidence: { scanner: 'live-traffic-tap', reproSteps: ['a', 'b'] },
    });
    upsertFinding({
      id: createFindingId(fp),
      fingerprint: fp,
      class: 'implementation',
      severity: 'HIGH',
      status: 'candidate',
      title: 'Live allow test',
      description: 'd',
      target: { kind: 'tool_handler', name: 'fs:x' },
      evidence: {
        scanner: 'live-traffic-tap',
        rule: 'exploit-effect',
        proxyDecision: 'allow-exploit',
        reproSteps: ['a', 'b'],
        payloads: [{ path: '../x' }],
        response: 'root:x:0:0:',
      },
      exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
      discoveredAt: new Date().toISOString(),
    });
    const ranked = prioritizerAgent(5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].evidence.scanner).toBe('live-traffic-tap');
  });
});
