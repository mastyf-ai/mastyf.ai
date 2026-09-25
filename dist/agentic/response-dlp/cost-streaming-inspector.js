import { getTokensPerMinCap } from './cost-streaming-config.js';
function estimateTokensFromBytes(bytes) {
    return Math.max(1, Math.ceil(bytes / 4));
}
export function inspectCostStreamingChunk(state, chunk, tenantId) {
    const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.length;
    state.totalBytes += bytes;
    const tokens = estimateTokensFromBytes(state.totalBytes);
    const cap = getTokensPerMinCap(tenantId);
    if (cap > 0 && tokens >= cap) {
        return {
            terminateStream: true,
            reason: `Streaming token budget exceeded (${tokens} >= ${cap})`,
        };
    }
    return { terminateStream: false };
}
//# sourceMappingURL=cost-streaming-inspector.js.map