import { context, propagation } from '@opentelemetry/api';
import { injectTraceHeaders, withToolCallSpan } from '../utils/tracing.js';
function headersToCarrier(headers) {
    const carrier = {};
    for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string')
            carrier[k.toLowerCase()] = v;
        else if (Array.isArray(v) && v[0])
            carrier[k.toLowerCase()] = v[0];
    }
    return carrier;
}
/** Run fn with W3C trace context extracted from inbound HTTP headers. */
export function runWithExtractedTrace(headers, fn) {
    const carrier = headersToCarrier((headers ?? {}));
    const ctx = propagation.extract(context.active(), carrier);
    return context.with(ctx, fn);
}
/** Async variant of {@link runWithExtractedTrace}. */
export async function runWithExtractedTraceAsync(headers, fn) {
    return runWithExtractedTrace(headers, fn);
}
/** Merge traceparent (and related) headers into outbound upstream request headers. */
export function injectIntoUpstreamHeaders(headers, overrides = {}) {
    const base = {};
    for (const [k, v] of Object.entries(headers)) {
        if (typeof v === 'string')
            base[k.toLowerCase()] = v;
        else if (Array.isArray(v) && v[0])
            base[k.toLowerCase()] = v[0];
    }
    const injected = injectTraceHeaders({ ...base, ...overrides });
    return { ...headers, ...injected };
}
/** Active span for MCP tools/call handling (policy + upstream relay). */
export function withMcpToolCallSpan(attrs, fn) {
    return withToolCallSpan('mcp.tools/call', {
        server_name: attrs.serverName,
        tool_name: attrs.toolName,
        tenant_id: attrs.tenantId ?? 'default',
        transport: attrs.transport,
        ...(attrs.decision ? { decision: attrs.decision } : {}),
    }, fn);
}
//# sourceMappingURL=trace-context.js.map