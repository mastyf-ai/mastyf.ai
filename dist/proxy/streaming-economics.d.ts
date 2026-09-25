/**
 * Unified mid-stream spend cutoff (Defense Fabric phase 4).
 */
import { type StreamingInspectorState } from '../utils/streaming-inspector.js';
export interface StreamingEconomicsState {
    costState: StreamingInspectorState;
    tenantId: string;
    spendReservationId?: string;
    aborted: boolean;
}
export declare function createStreamingEconomicsState(tenantId: string, spendReservationId?: string): StreamingEconomicsState;
export interface StreamingEconomicsChunkResult {
    abort: boolean;
    reason?: string;
}
/** Inspect one upstream chunk; abort stream when tenant spend cap exceeded. */
export declare function inspectStreamingEconomicsChunk(state: StreamingEconomicsState, chunk: string): StreamingEconomicsChunkResult;
//# sourceMappingURL=streaming-economics.d.ts.map