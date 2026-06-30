import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { createHash } from 'crypto';
import { Logger } from './logger.js';
import { onShutdown } from './shutdown.js';

let sdkInstance: { shutdown(): Promise<void> } | null = null;
let tracingInitAttempted = false;

export function isTracingEnabled(): boolean {
  const endpoint =
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim()
    || process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  if (!endpoint) return false;
  const flag = process.env['OTEL_ENABLED'];
  if (flag === 'false' || flag === '0') return false;
  return true;
}

/** Resolved OTLP HTTP traces URL (`…/v1/traces`). */
export function resolveOtlpTracesEndpoint(): string | null {
  const dedicated = process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim();
  const base = dedicated || process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  if (!base) return null;
  return base.endsWith('/v1/traces') ? base : `${base.replace(/\/$/, '')}/v1/traces`;
}

export function isTracingInitialized(): boolean {
  return sdkInstance !== null;
}

/** Hex trace_id / span_id for structured log correlation. */
export function getTraceLogFields(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  if (!traceId || traceId === '00000000000000000000000000000000') return {};
  return { trace_id: traceId, span_id: spanId };
}

/**
 * OpenTelemetry tracing for distributed request tracking across proxy → upstream.
 * Enable with: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 */
export async function initTracing(): Promise<void> {
  if (tracingInitAttempted && sdkInstance) return;
  tracingInitAttempted = true;

  if (!isTracingEnabled()) {
    Logger.debug('[tracing] OpenTelemetry not configured (set OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_ENABLED!=false)');
    return;
  }

  const url = resolveOtlpTracesEndpoint();
  if (!url) return;

  try {
    try {
      // @ts-ignore — optional peer dep
      const { W3CTraceContextPropagator } = await import('@opentelemetry/core');
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    } catch {
      // @opentelemetry/core not installed — skip W3C propagator setup
    }

    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

    const serviceName = process.env['OTEL_SERVICE_NAME'] || 'mastyf-ai';
    const exporter = new OTLPTraceExporter({ url }) as any;

    const instruments = getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }) as any;

    const sdk = new NodeSDK({
      serviceName,
      traceExporter: exporter,
      instrumentations: [instruments],
    });

    await sdk.start();
    sdkInstance = sdk;
    onShutdown(() => shutdownTracing());

    Logger.info(`[tracing] OpenTelemetry tracing initialized (service=${serviceName}, endpoint=${url})`);
  } catch (err: unknown) {
    Logger.warn(`[tracing] OpenTelemetry initialization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!sdkInstance) return;
  const sdk = sdkInstance;
  sdkInstance = null;
  try {
    await sdk.shutdown();
    Logger.info('[tracing] OpenTelemetry shut down');
  } catch (err: unknown) {
    Logger.warn(`[tracing] OpenTelemetry shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const carrier: Record<string, string> = { ...headers };
  propagation.inject(context.active(), carrier);
  if (!carrier.traceparent && headers.traceparent) {
    carrier.traceparent = headers.traceparent;
  }
  return carrier;
}

/** @deprecated Prefer runWithExtractedTrace from proxy/trace-context.js */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): void {
  const carrier: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') carrier[k.toLowerCase()] = v;
    else if (Array.isArray(v) && v[0]) carrier[k.toLowerCase()] = v[0];
  }
  propagation.extract(context.active(), carrier);
}

export async function withToolCallSpan<T>(
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('mastyf-ai-proxy');
  const { tool_name: toolName, ...lowCardinality } = attrs;
  const spanAttrs: Record<string, string | number> = { ...lowCardinality };
  if (typeof toolName === 'string' && toolName.length > 0) {
    spanAttrs.tool_name_hash = createHash('sha256').update(toolName).digest('hex').slice(0, 12);
  }
  return tracer.startActiveSpan(name, { attributes: spanAttrs }, async (span) => {
    try {
      if (typeof toolName === 'string' && toolName.length > 0) {
        span.addEvent('tool.call', { 'tool.name': toolName.slice(0, 128) });
      }
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
