import type { PolicyRule } from '../../policy/policy-types.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface ReplayHarnessResult {
    serverName: string;
    attacksTotal: number;
    attacksBlocked: number;
    workflowsTotal: number;
    workflowsPreserved: number;
    capturedReplayed: number;
    capturedPassRate?: number;
    sampleResults: Array<{
        id: string;
        toolName: string;
        expected: string;
        actual: string;
        ok: boolean;
    }>;
}
/** Replay adversarial corpus + captured twin traffic against a draft rule. */
export declare function runDigitalTwinReplayHarness(params: {
    serverName: string;
    draftRule?: PolicyRule;
    policyPath?: string;
    maxSamples?: number;
    useCapturedTraffic?: boolean;
    /** When true, replay only live-captured twin traffic (skip adversarial corpus). */
    capturedTrafficOnly?: boolean;
    store?: IndustryStandardStore;
}): Promise<ReplayHarnessResult>;
//# sourceMappingURL=replay-harness.d.ts.map