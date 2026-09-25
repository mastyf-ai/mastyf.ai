/**
 * Prompt Injection Detector — scans MCP tool call arguments for
 * prompt injection payloads targeting downstream AI agents.
 *
 * Detection pipeline:
 *   1. Heuristic pattern matching (fast, no LLM required)
 *   2. Semantic LLM classification (if LLM configured, for novel patterns)
 *   3. Combined confidence scoring
 */
import { AgenticResult } from '../core.js';
import { AgenticModelProvider } from '../model-provider.js';
export interface InjectionDetectionResult {
    /** Whether prompt injection was detected */
    detected: boolean;
    /** Confidence 0-1 */
    confidence: number;
    /** Which detection method(s) triggered */
    detectionMethods: ('heuristic' | 'semantic')[];
    /** The suspicious argument key(s) */
    suspiciousArgs: string[];
    /** The detected payload category */
    category: string;
    /** Human-readable explanation */
    explanation: string;
    /** Sanitized arguments (injection payloads neutralized) */
    sanitizedArgs?: Record<string, unknown>;
}
export declare class PromptInjectionDetector {
    private modelProvider;
    private totalScans;
    private totalDetections;
    constructor(modelProvider: AgenticModelProvider);
    /**
     * Scan a tool call's arguments for prompt injection.
     */
    scan(toolName: string, serverName: string, args: Record<string, unknown>): Promise<AgenticResult<InjectionDetectionResult>>;
    /**
     * Fast heuristic pattern matching against known injection payloads.
     */
    private heuristicScan;
    /**
     * Semantic LLM-based classification for novel/unseen injection patterns.
     */
    private semanticScan;
    /** Get detection statistics. */
    getStats(): {
        totalScans: number;
        totalDetections: number;
        detectionRate: number;
    };
}
//# sourceMappingURL=detector.d.ts.map