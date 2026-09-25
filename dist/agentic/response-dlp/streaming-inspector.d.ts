export type StreamAction = 'pass' | 'redact' | 'block';
export interface StreamChunkResult {
    action: StreamAction;
    /** Redacted chunk text (if action is 'redact') */
    redactedChunk?: string;
    /** Reason for block/redact */
    reason?: string;
    /** Whether to close the stream entirely */
    terminateStream: boolean;
    /** Accumulated violations */
    violations: string[];
}
export declare class StreamingResponseDlpInspector {
    private scanner;
    private readonly windowSize;
    private readonly accumulateWindow;
    constructor(windowSize?: number);
    /**
     * Inspect a single chunk of streaming response text.
     * Maintains an internal buffer to scan across chunk boundaries.
     */
    private buffer;
    private bytesProcessed;
    inspectChunk(toolName: string, serverName: string, chunk: string, isLastChunk?: boolean): StreamChunkResult;
    /** Reset the internal buffer (e.g., on new stream). */
    reset(): void;
    /** Get statistics. */
    getStats(): {
        bytesProcessed: number;
        currentBufferSize: number;
    };
}
//# sourceMappingURL=streaming-inspector.d.ts.map