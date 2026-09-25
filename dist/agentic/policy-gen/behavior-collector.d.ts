/**
 * Behavior Collector — hooks into the proxy to observe tool call patterns.
 *
 * Collects (in a privacy-preserving manner):
 *   - Tool names called
 *   - Argument names and value types/ranges (not raw values)
 *   - Call frequency per tool
 *   - Tool co-occurrence (which tools are called together in sequence)
 *   - Response latency and error rates
 *
 * This data feeds the Policy Synthesizer to generate minimal-privilege YAML policies.
 */
export interface ToolCallObservation {
    /** Tool name (e.g., "read_file", "execute_command") */
    toolName: string;
    /** Server name the tool belongs to */
    serverName: string;
    /** Argument keys observed */
    argumentKeys: string[];
    /** Argument value types (e.g., "string", "number", "boolean", "object", "array") */
    argumentTypes: Record<string, string>;
    /** Arg value length stats (min, max for strings; min, max for numbers) */
    argumentRanges: Record<string, {
        min?: number;
        max?: number;
        avg?: number;
    }>;
    /** Unix timestamp of the call */
    timestamp: number;
    /** Response latency in ms */
    latencyMs: number;
    /** Whether the call succeeded */
    success: boolean;
    /** A short hash of the session/context for co-occurrence analysis */
    sessionHash: string;
    /** Agent id for biometric vector correlation (A3) */
    agentId?: string;
    /** Credential identity for mismatch detection */
    credentialIdentity?: string;
}
export interface ObservationWindow {
    /** Unique window id */
    windowId: string;
    /** When collection started */
    startedAt: string;
    /** Whether collection is complete */
    complete: boolean;
    /** Total calls observed */
    totalCalls: number;
    /** Unique tools observed */
    uniqueTools: number;
    /** Observations grouped by tool */
    byTool: Record<string, ToolCallObservation[]>;
    /** Co-occurrence matrix: toolA -> toolB -> count */
    coOccurrences: Record<string, Record<string, number>>;
    /** Session sequences (ordered tool calls per session) */
    sessionSequences: Record<string, string[]>;
    /** Aggregate statistics */
    stats: WindowStatistics;
}
export interface WindowStatistics {
    totalObservations: number;
    uniqueTools: string[];
    toolCallCounts: Record<string, number>;
    toolLatencyP50: Record<string, number>;
    toolLatencyP95: Record<string, number>;
    toolErrorRate: Record<string, number>;
    argumentKeysByTool: Record<string, string[]>;
    argumentTypesByTool: Record<string, Record<string, string>>;
    /** Most common tool sequences (length-2 and length-3) */
    commonSequences: {
        sequence: string[];
        count: number;
    }[];
}
export declare class BehaviorCollector {
    private active;
    private currentWindow;
    private windowHistory;
    private fingerprintEngine;
    /** Wire A3 biometric fingerprint engine for vector correlation. */
    setFingerprintEngine(engine: import('../biometrics/behavior-fingerprint.js').BehaviorFingerprintEngine): void;
    /**
     * Start a new observation window. If a window is already active,
     * it is finalized first.
     */
    startWindow(windowId?: string): ObservationWindow;
    /**
     * Record a tool call observation. Called by the proxy on every tools/call.
     */
    record(observation: ToolCallObservation): void;
    /**
     * Finalize the current window, computing aggregate statistics.
     */
    finalizeWindow(): ObservationWindow | null;
    /** Stop the current window without finalizing (discard data). */
    abortWindow(): void;
    /** Get the current (in-progress) window. */
    getCurrentWindow(): ObservationWindow | null;
    /** Get all finalized windows. */
    getHistory(): ObservationWindow[];
    /** Check if currently observing. */
    isActive(): boolean;
    /** Get a summary of observations so far. */
    getSummary(): {
        totalCalls: number;
        uniqueTools: number;
        toolCounts: Record<string, number>;
        uptimeMin: number;
    } | null;
}
//# sourceMappingURL=behavior-collector.d.ts.map