import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('semantic transport parity', () => {
  it('all proxy transports route tool calls through evaluateToolCallDefense', () => {
    for (const file of [
      'src/proxy/http-proxy-server.ts',
      'src/proxy/sse-proxy-server.ts',
      'src/proxy/streamable-http-proxy-server.ts',
      'src/proxy/websocket-proxy-server.ts',
      'src/proxy/proxy-server.ts',
    ]) {
      const src = readFileSync(file, 'utf-8');
      expect(src).toContain('evaluateToolCallDefense');
    }
    const orchestrator = readFileSync('src/proxy/tool-call-defense-orchestrator.ts', 'utf-8');
    expect(orchestrator).toContain('runPostPolicyAllowGates');
  });
});
