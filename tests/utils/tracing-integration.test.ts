import { beforeAll, describe, it, expect } from 'vitest';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { withMcpToolCallSpan } from '../../src/proxy/trace-context.js';

describe('tracing integration (M-015)', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  it('creates mcp.tools/call span with bounded attributes', async () => {
    exporter.reset();
    await withMcpToolCallSpan(
      { serverName: 'test-srv', toolName: 'read_file', tenantId: 'default', transport: 'stdio' },
      async () => 'ok',
    );
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const span = spans[0]!;
    expect(span.name).toBe('mcp.tools/call');
    for (const val of Object.values(span.attributes)) {
      if (typeof val === 'string') {
        expect(val.length).toBeLessThanOrEqual(256);
      }
    }
  });
});
