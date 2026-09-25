/**
 * Mid-stream spend cutoff — terminates upstream streams when tenant token/min cap is exceeded.
 */
import type { StreamingInspectorState } from '../../utils/streaming-inspector.js';
export interface CostStreamingInspectResult {
    terminateStream: boolean;
    reason?: string;
}
export declare function inspectCostStreamingChunk(state: StreamingInspectorState, chunk: string | Buffer, tenantId?: string): CostStreamingInspectResult;
//# sourceMappingURL=cost-streaming-inspector.d.ts.map