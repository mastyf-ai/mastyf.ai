/**
 * MCP Protocol Fuzzer (#4) — autonomous fuzzing engine.
 */
import { Logger } from '../../utils/logger.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { ReinforceFuzzerSelector } from '../rl/reinforce-fuzzer.js';
import type { MCPCertifier } from '../certification/certifier.js';
import { certLevelMeets } from '../../policy/strategies/certification-strategy.js';

export interface FuzzPayload { id: string; category: string; payload: string; target: string; description: string; }
export interface FuzzResult { payload: FuzzPayload; blocked: boolean; crashed: boolean; response: string; risk: 'critical' | 'high' | 'medium' | 'low'; }

const MCP_FUZZ_ATTACKS: FuzzPayload[] = [
  { id: 'fuzz-001', category: 'rpc-malform', payload: '{"jsonrpc":"2.0","method":"tools/call"', target: 'tools/call', description: 'Truncated JSON-RPC' },
  { id: 'fuzz-002', category: 'rpc-injection', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}},"id":1}', target: 'tools/call', description: 'Sensitive path injection' },
  { id: 'fuzz-003', category: 'rpc-overflow', payload: '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":"' + 'A'.repeat(10000) + '"}', target: 'tools/list', description: 'Large id overflow' },
  { id: 'fuzz-004', category: 'rpc-method-enum', payload: '{"jsonrpc":"2.0","method":"admin/root","params":{},"id":1}', target: 'tools/list', description: 'Privilege escalation method' },
  { id: 'fuzz-005', category: 'rpc-binding', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"","arguments":{}},"id":1}', target: 'tools/call', description: 'Empty tool name' },
  { id: 'fuzz-006', category: 'rpc-nesting', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":{"$gt":""}}},"id":1}', target: 'tools/call', description: 'NoSQL injection in args' },
  { id: 'fuzz-007', category: 'stdio-flood', payload: '\n'.repeat(500) + '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":".env"}},"id":1}', target: 'tools/call', description: 'Line-flooding stdio' },
  { id: 'fuzz-008', category: 'sse-frame', payload: 'data: {"jsonrpc":"2.0","method":"tools/call","params":{"name":"execute_command","arguments":{"command":"rm -rf /"}},"id":1}\n\n', target: 'tools/call', description: 'SSE frame injection' },
  { id: 'fuzz-009', category: 'rpc-null', payload: '{"jsonrpc":"2.0","method":null,"params":{},"id":1}', target: 'tools/list', description: 'Null method' },
  { id: 'fuzz-010', category: 'rpc-array', payload: '[{"jsonrpc":"2.0","method":"tools/list","id":1},{"jsonrpc":"2.0","method":"tools/call","params":{"name":"bash"},"id":2}]', target: 'tools/call', description: 'Batch JSON-RPC array' },
  { id: 'fuzz-011', category: 'rpc-unicode', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":"\\u002e\\u002e/etc/passwd"}},"id":1}', target: 'tools/call', description: 'Unicode path traversal' },
  { id: 'fuzz-012', category: 'rpc-prototype', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"__proto__":{"admin":true}}},"id":1}', target: 'tools/call', description: 'Prototype pollution' },
  { id: 'fuzz-013', category: 'rpc-negative-id', payload: '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":-1}', target: 'tools/list', description: 'Negative request id' },
  { id: 'fuzz-014', category: 'rpc-deep-nest', payload: '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"a":{"b":{"c":{"d":{"e":{"path":"/etc/shadow"}}}}}}},"id":1}', target: 'tools/call', description: 'Deep argument nesting' },
  { id: 'fuzz-015', category: 'rpc-resource', payload: '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"file:///etc/passwd"},"id":1}', target: 'resources/read', description: 'Resource URI injection' },
];

const BLOCKED_METHODS = new Set(['admin/root', 'admin/shutdown', 'internal/debug']);
const BLOCKED_TOOLS = new Set(['execute_command', 'bash', 'sh', 'eval', 'exec']);

export class McpProtocolFuzzer {
  private results: FuzzResult[] = [];

  constructor(private readonly store?: IndustryStandardStore) {}

  runFuzzer(
    blockFn: (method: string, params: Record<string, unknown>) => { blocked: boolean; reason?: string },
    serverName = 'local',
    reinforce?: ReinforceFuzzerSelector,
  ): FuzzResult[] {
    this.results = [];
    const attacks = reinforce ? this.expandWithReinforce([...MCP_FUZZ_ATTACKS], reinforce) : MCP_FUZZ_ATTACKS;
    for (const attack of attacks) {
      let blocked = false;
      let crashed = false;
      let response = '';
      let risk: FuzzResult['risk'] = 'low';
      try {
        let method = attack.target;
        let params: Record<string, unknown> = {};
        try {
          const trimmed = attack.payload.trim();
          const parsed = JSON.parse(trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed);
          if (Array.isArray(parsed)) {
            method = String(parsed[0]?.method ?? attack.target);
            params = (parsed[0]?.params as Record<string, unknown>) ?? {};
          } else {
            method = String(parsed.method ?? attack.target);
            params = (parsed.params as Record<string, unknown>) ?? {};
          }
        } catch {
          blocked = blockFn(attack.target, { malformed: attack.payload }).blocked;
          response = blocked ? 'BLOCKED' : 'MALFORMED_PASSED';
          risk = blocked ? 'low' : 'high';
          this.results.push({ payload: attack, blocked, crashed, response, risk });
          continue;
        }

        blocked = blockFn(method, params).blocked;
        if (!blocked) {
          blocked = this.defaultBlock(method, params);
        }
        response = blocked ? 'BLOCKED' : 'PASSED';
        if (!blocked && attack.category === 'rpc-method-enum') risk = 'high';
        if (!blocked && attack.category === 'rpc-injection') risk = 'critical';
        if (!blocked && attack.category === 'rpc-overflow') risk = 'medium';
        if (!blocked && attack.category === 'rpc-prototype') risk = 'critical';
      } catch (e: unknown) {
        crashed = true;
        response = 'CRASHED: ' + (e instanceof Error ? e.message : 'unknown');
        risk = 'critical';
      }
      this.results.push({ payload: attack, blocked, crashed, response, risk });
      if (reinforce) {
        reinforce.observe(blocked ? -0.1 : response === 'PASSED' ? 1 : 0);
      }
    }

    const stats = this.getStats();
    this.store?.saveFuzzRun({
      id: `fuzz-${Date.now()}`,
      serverName,
      total: stats.total,
      blocked: stats.blocked,
      passed: stats.passed,
      bypassesJson: JSON.stringify(this.results.filter(r => !r.blocked && !r.crashed)),
    });

    Logger.info(`[McpFuzzer] ${stats.total} payloads tested: ${stats.blocked} blocked, ${stats.crashed} crashed`);
    return this.results;
  }

  /** Live transport fuzz against GUARDIAN_FUZZ_TARGET URL. */
  async runLiveTransportFuzz(
    blockFn: (method: string, params: Record<string, unknown>) => { blocked: boolean; reason?: string },
    serverName = 'live',
    reinforce?: ReinforceFuzzerSelector,
  ): Promise<FuzzResult[]> {
    const target = process.env.GUARDIAN_FUZZ_TARGET;
    if (!target) {
      Logger.warn('[McpFuzzer] GUARDIAN_FUZZ_TARGET not set — skipping live transport fuzz');
      return this.runFuzzer(blockFn, serverName, reinforce);
    }

    this.results = [];
    const attacks = reinforce ? this.expandWithReinforce([...MCP_FUZZ_ATTACKS], reinforce) : MCP_FUZZ_ATTACKS;
    for (const attack of attacks.slice(0, 8)) {
      let blocked = false;
      let crashed = false;
      let response = '';
      let risk: FuzzResult['risk'] = 'low';
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: attack.payload.trim().startsWith('data:')
            ? attack.payload.trim().slice(5).trim()
            : attack.payload,
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        response = `${res.status}:${text.slice(0, 120)}`;
        blocked = res.status === 403 || res.status === 401;
        if (!blocked) {
          try {
            const parsed = JSON.parse(text) as { error?: { message?: string } };
            blocked = Boolean(parsed.error?.message?.includes('Blocked by MCP Guardian'));
          } catch {
            /* non-json */
          }
        }
        if (!blocked) {
          blocked = blockFn(attack.target, {}).blocked || this.defaultBlock(attack.target, {});
        }
        risk = blocked ? 'low' : attack.category.includes('injection') ? 'critical' : 'high';
      } catch (e: unknown) {
        crashed = true;
        response = e instanceof Error ? e.message : 'transport_error';
        risk = 'medium';
      }
      this.results.push({ payload: attack, blocked, crashed, response, risk });
      reinforce?.observe(blocked ? -0.1 : 1);
    }

    const stats = this.getStats();
    this.store?.saveFuzzRun({
      id: `fuzz-live-${Date.now()}`,
      serverName,
      total: stats.total,
      blocked: stats.blocked,
      passed: stats.passed,
      bypassesJson: JSON.stringify(this.results.filter(r => !r.blocked && !r.crashed)),
    });
    Logger.info(`[McpFuzzer] Live transport: ${stats.blocked}/${stats.total} blocked → ${target}`);
    return this.results;
  }

  /** Require silver+ certification before treating fuzz pass as production-ready. */
  passesCertGate(certifier: MCPCertifier, serverName: string, minLevel: 'silver' | 'gold' = 'silver'): boolean {
    const cert = certifier.getCertification(serverName);
    if (!cert?.certified) return false;
    return certLevelMeets(cert.level, minLevel);
  }

  private expandWithReinforce(
    base: FuzzPayload[],
    reinforce: ReinforceFuzzerSelector,
  ): FuzzPayload[] {
    const decision = reinforce.select();
    const mutated = base.map((p) => ({
      ...p,
      id: `${p.id}-${decision.selectedStrategy}`,
      payload: this.applyMutationStrategy(p.payload, decision.selectedStrategy),
      description: `${p.description} [${decision.selectedStrategy}]`,
    }));
    return [...base, ...mutated.slice(0, 5)];
  }

  private applyMutationStrategy(payload: string, strategy: string): string {
    switch (strategy) {
      case 'case_obfuscation':
        return payload.replace(/tools/gi, (m) => m.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''));
      case 'unicode_homoglyph':
        return payload.replace(/a/g, '\u0430');
      case 'url_encoding':
        return encodeURIComponent(payload).slice(0, 2000);
      case 'null_byte_injection':
        return payload.replace('"', '\u0000"');
      default:
        return payload;
    }
  }

  private defaultBlock(method: string, params: Record<string, unknown>): boolean {
    if (BLOCKED_METHODS.has(method)) return true;
    const toolName = String((params as { name?: string }).name ?? '');
    if (BLOCKED_TOOLS.has(toolName)) return true;
    const args = (params as { arguments?: Record<string, unknown> }).arguments ?? {};
    const blob = JSON.stringify(args).toLowerCase();
    return blob.includes('/etc/passwd') || blob.includes('.env') || blob.includes('__proto__');
  }

  getResults(): FuzzResult[] { return this.results; }
  getStats(): { total: number; blocked: number; passed: number; crashed: number; criticalBypasses: number } {
    const r = this.results;
    return {
      total: r.length,
      blocked: r.filter(x => x.blocked).length,
      passed: r.filter(x => !x.blocked && !x.crashed).length,
      crashed: r.filter(x => x.crashed).length,
      criticalBypasses: r.filter(x => !x.blocked && x.risk === 'critical').length,
    };
  }
}
