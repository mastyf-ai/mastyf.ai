/**
 * Chunked streaming inspection for large tool responses (SSE/WS/stdio).
 * Scans 64KB windows with overlap so patterns spanning chunk boundaries are caught.
 */
import { getResponseDlpMode, shouldBlockResponseDlp } from '../policy/response-dlp.js';
export declare const STREAMING_INSPECTOR_CHUNK_BYTES: number;
export declare const STREAMING_INSPECTOR_OVERLAP_BYTES = 512;
export interface StreamingInspectFinding {
    source: 'dlp' | 'policy';
    message: string;
    severity?: 'critical' | 'high' | 'medium' | 'low';
    category?: string;
}
export interface StreamingInspectResult {
    clean: boolean;
    findings: StreamingInspectFinding[];
    hasCritical: boolean;
    hasHigh: boolean;
    truncated?: boolean;
    redactedBody?: string;
    dlpMode?: string;
    redactionReasons?: string[];
    decodePasses?: string[];
}
export declare const STREAMING_INSPECTOR_MAX_CARRY_CHARS: number;
export interface StreamingInspectorState {
    carry: string;
    findings: StreamingInspectFinding[];
    totalBytes: number;
    /** Set when callers should pause upstream until buffer drains. */
    backpressure?: boolean;
}
export declare function createStreamingInspectorState(): StreamingInspectorState;
export declare function isResponseScanSkipped(): boolean;
/** Feed a chunk of response text; returns incremental findings for this chunk only. */
export declare function inspectResponseChunk(state: StreamingInspectorState, chunk: string, opts: {
    toolName: string;
    serverName: string;
    policy?: unknown;
    scanSecrets?: boolean;
}): StreamingInspectFinding[];
/** True when upstream should apply backpressure (pause reads) before sending more chunks. */
export declare function streamingInspectorBackpressure(state: StreamingInspectorState): boolean;
/** Inspect full response text using chunked windows (for stdio single-line responses). */
export declare function inspectFullResponse(responseText: string, opts: {
    toolName: string;
    serverName: string;
    policy?: unknown;
    scanSecrets?: boolean;
}): StreamingInspectResult;
export { shouldBlockResponseDlp, getResponseDlpMode };
export declare function finalizeStreamingInspect(state: StreamingInspectorState): StreamingInspectResult;
export declare function findingsToMessages(findings: StreamingInspectFinding[]): string[];
//# sourceMappingURL=streaming-inspector.d.ts.map