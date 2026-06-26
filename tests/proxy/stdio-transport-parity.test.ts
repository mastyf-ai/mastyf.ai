import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('stdio transport parity', () => {
  it('proxy-server.ts wires vault, pre-pipeline, and pre-forward guard', () => {
    const src = readFileSync(resolve(ROOT, 'src/proxy/proxy-server.ts'), 'utf-8');
    expect(src).toContain('withProxyRequestVault');
    expect(src).toContain('runMcpPrePipeline');
    expect(src).toContain('runToolCallPreForwardGuard');
    expect(src).toContain('applyMcpResponsePipeline');
    expect(src).toContain('runWithExtractedTraceAsync');
    expect(src).not.toContain('agenticPreForwardToolCall');
  });
});
