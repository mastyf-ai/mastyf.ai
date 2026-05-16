import { Logger } from './logger.js';

/**
 * OpenTelemetry tracing for distributed request tracking across proxy + MCP servers.
 * Enable with: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 * Uses OTLP HTTP exporter (gRPC exporter deprecated due to critical CVE in protobufjs).
 */
export async function initTracing(): Promise<void> {
  if (!process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
    Logger.debug('[tracing] OpenTelemetry not configured (set OTEL_EXPORTER_OTLP_ENDPOINT)');
    return;
  }

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    // Use OTLP HTTP exporter instead of deprecated gRPC
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

    const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']!;
    const url = endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`;
    const exporter = new OTLPTraceExporter({ url }) as any;

    const instruments = getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
    }) as any;

    const sdk = new NodeSDK({
      traceExporter: exporter,
      instrumentations: [instruments],
    });

    await sdk.start();
    Logger.info('[tracing] OpenTelemetry tracing initialized — exporting to OTLP HTTP endpoint');
  } catch (err: any) {
    Logger.warn(`[tracing] OpenTelemetry initialization failed: ${err?.message}`);
  }
}