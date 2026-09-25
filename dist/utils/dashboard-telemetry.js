/**
 * Optional OpenTelemetry emission for Mastyf security OS attributes (OS5).
 * Real attribute emission path when OTEL exporter / MASTYF_OTEL_ENABLED is set.
 * No-op only when exporter unset — never invents metrics or Trust scores.
 *
 * Attributes (mastyf.*), aligned with OpenTelemetry MCP/GenAI semconv spirit:
 *   decision | cbac | difc | workflow | guard | arbiter |
 *   execution | bytes_sent | receipt_id | policy_hash
 */
export const MASTYF_OTEL_ATTR_KEYS = [
    'mastyf.decision',
    'mastyf.cbac',
    'mastyf.difc',
    'mastyf.workflow',
    'mastyf.guard',
    'mastyf.arbiter',
    'mastyf.execution',
    'mastyf.bytes_sent',
    'mastyf.receipt_id',
    'mastyf.policy_hash',
];
let tracer;
let started = false;
export function isOtelExporterConfigured() {
    return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        process.env.OTEL_ENABLED === 'true' ||
        process.env.MASTYF_OTEL_ENABLED === 'true');
}
function resolveTracer() {
    if (tracer !== undefined)
        return tracer;
    try {
        // Optional peer — fail soft when not installed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const api = require('@opentelemetry/api');
        if (api?.trace?.getTracer) {
            tracer = api.trace.getTracer('mastyf');
            return tracer;
        }
    }
    catch {
        /* SDK not present */
    }
    tracer = null;
    return null;
}
/** Flatten mastyf.* keys with defined values (required OS5 keys first). */
export function flattenMastyfOtelAttrs(attrs) {
    const flat = {};
    for (const key of MASTYF_OTEL_ATTR_KEYS) {
        const v = attrs[key];
        if (v === undefined || v === null)
            continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            flat[key] = v;
        }
    }
    for (const [k, v] of Object.entries(attrs)) {
        if (!k.startsWith('mastyf.') || k in flat)
            continue;
        if (v === undefined || v === null)
            continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            flat[k] = v;
        }
    }
    return flat;
}
/**
 * Emit a `mastyf.decision` span with security attributes.
 * No-op when exporter unset or tracer unavailable.
 */
export function emitMastyfDecision(attrs) {
    if (!isOtelExporterConfigured())
        return;
    const t = resolveTracer();
    if (!t)
        return;
    try {
        const span = t.startSpan('mastyf.decision');
        const flat = flattenMastyfOtelAttrs(attrs);
        if (span.setAttributes)
            span.setAttributes(flat);
        else {
            for (const [k, v] of Object.entries(flat))
                span.setAttribute?.(k, v);
        }
        span.end?.();
    }
    catch {
        /* never break control plane on telemetry */
    }
}
/** Build attrs from a gateway /v1/decide-shaped payload (best-effort). */
export function mastyfAttrsFromDecide(input) {
    const raw = input.raw || {};
    const bytes = input.bytesSent ??
        (typeof raw.child_stdin_bytes === 'number'
            ? raw.child_stdin_bytes
            : typeof raw.bytes_sent === 'number'
                ? raw.bytes_sent
                : undefined);
    return {
        'mastyf.decision': input.finalDecision || String(raw.final_decision || raw.decision || ''),
        'mastyf.cbac': input.cbacDecision || (raw.cbac_decision != null ? String(raw.cbac_decision) : undefined),
        'mastyf.difc': input.difcDecision || (raw.difc_decision != null ? String(raw.difc_decision) : undefined),
        'mastyf.workflow': input.workflowDecision ||
            (raw.workflow_decision != null ? String(raw.workflow_decision) : undefined),
        'mastyf.guard': input.aiaDecision || (raw.aia_decision != null ? String(raw.aia_decision) : undefined),
        'mastyf.arbiter': input.arbiterDecision ||
            input.finalDecision ||
            (raw.arbiter_decision != null ? String(raw.arbiter_decision) : undefined),
        'mastyf.execution': input.execution ||
            (raw.execution_observation != null ? String(raw.execution_observation) : undefined),
        'mastyf.bytes_sent': bytes,
        'mastyf.receipt_id': input.receiptId ||
            (raw.receipt_id != null
                ? String(raw.receipt_id)
                : raw.request_id != null
                    ? String(raw.request_id)
                    : undefined),
        'mastyf.policy_hash': input.policyHash || (raw.policy_hash != null ? String(raw.policy_hash) : undefined),
    };
}
export async function startDashboardTelemetry() {
    if (started)
        return;
    started = true;
    if (!isOtelExporterConfigured())
        return;
    resolveTracer();
}
export async function stopDashboardTelemetry() {
    started = false;
    tracer = undefined;
}
//# sourceMappingURL=dashboard-telemetry.js.map