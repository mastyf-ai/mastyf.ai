/**
 * Chunked streaming inspection for large tool responses (SSE/WS/stdio).
 * Scans 64KB windows with overlap so patterns spanning chunk boundaries are caught.
 */
import { evaluateResponseDlp, getResponseDlpMode, shouldBlockResponseDlp, } from '../policy/response-dlp.js';
import { MAX_RESPONSE_DLP_BYTES, utf8ByteLength } from './eval-bounds.js';
export const STREAMING_INSPECTOR_CHUNK_BYTES = 64 * 1024;
export const STREAMING_INSPECTOR_OVERLAP_BYTES = 512;
export const STREAMING_INSPECTOR_MAX_CARRY_CHARS = 128 * 1024;
export function createStreamingInspectorState() {
    return { carry: '', findings: [], totalBytes: 0 };
}
export function isResponseScanSkipped() {
    return process.env['MASTYF_AI_SKIP_RESPONSE_SCAN'] === 'true';
}
function mergeDlpFindings(state, findings) {
    for (const f of findings) {
        const key = `dlp:${f.category}:${f.ruleId}`;
        if (state.findings.some((x) => x.message === key))
            continue;
        state.findings.push({
            source: 'dlp',
            message: key,
            severity: f.severity,
            category: f.category,
        });
    }
}
function runDlpOnWindow(state, toolName, serverName, window) {
    const dlp = evaluateResponseDlp(toolName, serverName, window);
    mergeDlpFindings(state, dlp.findings);
}
/** Feed a chunk of response text; returns incremental findings for this chunk only. */
export function inspectResponseChunk(state, chunk, opts) {
    void opts.scanSecrets;
    if (!chunk)
        return [];
    state.totalBytes += utf8ByteLength(chunk);
    if (state.totalBytes > MAX_RESPONSE_DLP_BYTES) {
        state.backpressure = true;
        return state.findings;
    }
    const combined = state.carry + chunk;
    if (combined.length > STREAMING_INSPECTOR_MAX_CARRY_CHARS) {
        state.backpressure = true;
        state.carry = combined.slice(-STREAMING_INSPECTOR_OVERLAP_BYTES);
        return state.findings;
    }
    const chunkSize = STREAMING_INSPECTOR_CHUNK_BYTES;
    const newFindings = [];
    const before = state.findings.length;
    let offset = 0;
    while (offset < combined.length) {
        const window = combined.slice(offset, offset + chunkSize);
        runDlpOnWindow(state, opts.toolName, opts.serverName, window);
        offset += chunkSize - STREAMING_INSPECTOR_OVERLAP_BYTES;
        if (offset <= 0 || chunkSize <= STREAMING_INSPECTOR_OVERLAP_BYTES)
            break;
    }
    const tailStart = Math.max(0, combined.length - STREAMING_INSPECTOR_OVERLAP_BYTES);
    state.carry = combined.slice(tailStart);
    for (let i = before; i < state.findings.length; i++) {
        newFindings.push(state.findings[i]);
    }
    state.backpressure = state.totalBytes > MAX_RESPONSE_DLP_BYTES * 0.9;
    return newFindings;
}
/** True when upstream should apply backpressure (pause reads) before sending more chunks. */
export function streamingInspectorBackpressure(state) {
    return state.backpressure === true;
}
/** Inspect full response text using chunked windows (for stdio single-line responses). */
export function inspectFullResponse(responseText, opts) {
    if (isResponseScanSkipped()) {
        return { clean: true, findings: [], hasCritical: false, hasHigh: false };
    }
    const state = createStreamingInspectorState();
    const dlp = evaluateResponseDlp(opts.toolName, opts.serverName, responseText);
    mergeDlpFindings(state, dlp.findings);
    // Full-buffer DLP above; chunked walk is for streaming feeds only.
    const out = finalizeStreamingInspect(state);
    return {
        ...out,
        redactedBody: dlp.redactedBody,
        dlpMode: dlp.mode,
        redactionReasons: dlp.redactionReasons,
        decodePasses: dlp.decodePasses,
        hasCritical: dlp.hasCritical || out.hasCritical,
        hasHigh: dlp.hasHigh || out.hasHigh,
        clean: dlp.clean && out.clean,
    };
}
export { shouldBlockResponseDlp, getResponseDlpMode };
export function finalizeStreamingInspect(state) {
    const hasCritical = state.findings.some((f) => f.severity === 'critical');
    const hasHigh = state.findings.some((f) => f.severity === 'high');
    return {
        clean: state.findings.length === 0,
        findings: state.findings,
        hasCritical,
        hasHigh,
        truncated: state.totalBytes > MAX_RESPONSE_DLP_BYTES,
    };
}
export function findingsToMessages(findings) {
    return findings.map((f) => {
        if (f.source === 'dlp' && f.category) {
            return `${f.category}: ${f.message.replace(/^dlp:[^:]+:/, '')}`;
        }
        return f.message;
    });
}
//# sourceMappingURL=streaming-inspector.js.map