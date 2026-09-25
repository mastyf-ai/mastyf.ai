import type { VulnFinding } from './types.js';
export declare function isLiveTrafficTapEnabled(): boolean;
export interface LiveTapInput {
    serverName: string;
    toolName: string;
    args?: Record<string, unknown>;
    result: unknown;
    /** Always false for allowed (post-proxy) traffic. */
    blockedByProxy?: boolean;
    durationMs?: number;
    tenantId?: string;
}
/**
 * Inspect an allowed tools/call. Returns finding if malicious args + exploit effect.
 */
export declare function tapAllowedToolCall(input: LiveTapInput): VulnFinding | null;
//# sourceMappingURL=live-traffic-tap.d.ts.map